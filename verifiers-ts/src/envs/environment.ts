/**
 * Base Environment class for all verifiers environments
 * Mirrors the Python Environment class structure
 */

import path from "node:path";

import type {
  Messages,
  State,
  Info,
  GenerateInputs,
  GenerateOutputs,
  GenerateMetadata,
  Dataset,
  MessageType,
  SamplingArgs,
  ChatMessage,
} from "../types/index.js";
import { Parser } from "../parsers/parser.js";
import { Rubric } from "../rubrics/rubric.js";
import { maybeAwait, Semaphore } from "../utils/async-utils.js";
import { generateText, CoreMessage, stepCountIs } from "ai";
import { openai } from "@ai-sdk/openai";
import type { AISDKTool } from "../utils/tool-utils.js";

export interface EnvironmentOptions {
  dataset?: Dataset;
  evalDataset?: Dataset;
  systemPrompt?: string;
  fewShot?: ChatMessage[];
  parser?: Parser;
  rubric?: Rubric;
  samplingArgs?: SamplingArgs;
  messageType?: MessageType;
  oaiTools?: AISDKTool[];
  maxWorkers?: number;
  envId?: string;
  envArgs?: Record<string, unknown>;
}

export abstract class Environment {
  protected messageType: MessageType;
  protected oaiTools: AISDKTool[] | null;
  protected systemPrompt: string | null;
  protected fewShot: ChatMessage[] | null;
  protected parser: Parser;
  protected rubric: Rubric;
  protected dataset: Dataset | null;
  protected evalDataset: Dataset | null;
  protected samplingArgs: SamplingArgs;
  protected envId: string | null;
  protected envArgs: Record<string, unknown> | null;

  constructor(options: EnvironmentOptions = {}) {
    this.messageType = options.messageType || "chat";
    this.oaiTools = options.oaiTools || null;
    this.systemPrompt = options.systemPrompt || null;
    this.fewShot = options.fewShot || null;
    this.parser = options.parser || new Parser();
    this.rubric = options.rubric || new Rubric();
    this.dataset = options.dataset || null;
    this.evalDataset = options.evalDataset || null;
    this.samplingArgs = options.samplingArgs || {};
    this.envId = options.envId || null;
    this.envArgs = options.envArgs || null;

    if (
      this.parser.constructor !== this.rubric.constructor &&
      typeof this.parser.constructor === "function"
    ) {
      console.warn(
        "The parser and rubric parser are different. This may cause unexpected behavior."
      );
    }

    // Format datasets if provided
    if (this.messageType === "chat" && this.dataset) {
      this.dataset = this.formatDataset(
        this.dataset,
        this.systemPrompt,
        this.fewShot
      );
    }

    if (this.messageType === "chat" && this.evalDataset) {
      this.evalDataset = this.formatDataset(
        this.evalDataset,
        this.systemPrompt,
        this.fewShot
      );
    }

    if (this.messageType === "completion") {
      if (this.systemPrompt || this.fewShot) {
        throw new Error(
          'The fields "systemPrompt" and "fewShot" are not supported for completion tasks.'
        );
      }
    }
  }

  /**
   * Format dataset with system prompt and few-shot examples
   */
  protected formatDataset(
    dataset: Dataset,
    systemPrompt: string | null,
    fewShot: ChatMessage[] | null
  ): Dataset {
    // This is a simplified version - in practice, you'd need to properly
    // handle HuggingFace dataset formatting
    const formatted = { ...dataset };
    // Add system prompt and few-shot to each prompt
    // Implementation depends on dataset structure
    return formatted;
  }

  /**
   * Convert verifiers Messages to AI SDK CoreMessage format
   */
  protected convertToCoreMessages(messages: Messages): CoreMessage[] {
    if (typeof messages === "string") {
      return [{ role: "user", content: messages }];
    }
    return messages.map((msg) => {
      if (typeof msg === "string") {
        return { role: "user", content: msg };
      }
      const role = msg.role === "assistant" ? "assistant" : 
                   msg.role === "system" ? "system" : "user";
      return {
        role,
        content: msg.content || "",
      };
    });
  }

  /**
   * Convert AI SDK response to verifiers format
   */
  protected convertFromAISDKResponse(result: any): {
    id: string;
    choices: Array<{
      message?: {
        role: string;
        content: string | null;
        tool_calls?: Array<{
          id: string;
          type: string;
          function: {
            name: string;
            arguments: string;
          };
        }>;
      };
      text?: string;
    }>;
    toolCalls?: unknown[];
    toolResults?: unknown[];
  } {
    // Handle AI SDK 5.0 result structure
    const text = result.text || "";
    const toolCalls: any[] = [];
    const toolResults: any[] = [];

    // Extract tool calls from steps or final result
    if (result.steps) {
      for (const step of result.steps) {
        if (step.toolCalls) {
          toolCalls.push(...step.toolCalls);
        }
        if (step.toolResults) {
          toolResults.push(...step.toolResults);
        }
      }
    } else if (result.toolCalls) {
      toolCalls.push(...result.toolCalls);
    }

    // Convert tool calls to OpenAI format
    const oaiToolCalls = toolCalls.map((tc: any) => ({
      id: tc.toolCallId || tc.id,
      type: "function" as const,
      function: {
        name: tc.toolName || tc.name,
        arguments: typeof tc.args === "string" 
          ? tc.args 
          : typeof tc.input === "string"
            ? tc.input
            : JSON.stringify(tc.args || tc.input || {}),
      },
    }));

    return {
      id: result.id || `ai-sdk-${Date.now()}`,
      choices: [
        {
          message: {
            role: "assistant",
            content: text || null,
            tool_calls: oaiToolCalls.length > 0 ? oaiToolCalls : undefined,
          },
        },
      ],
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      toolResults: toolResults.length > 0 ? toolResults : undefined,
    };
  }

  /**
   * Get dataset examples
   */
  getDataset(n: number = -1, seed?: number): Dataset | null {
    if (!this.dataset) {
      return null;
    }
    // Simplified - in practice would shuffle and select n examples
    return this.dataset;
  }

  /**
   * Get evaluation dataset examples
   */
  getEvalDataset(n: number = -1, seed?: number): Dataset | null {
    if (!this.evalDataset) {
      if (!this.dataset) {
        return null;
      }
      console.info("evalDataset is not set, falling back to train dataset");
      return this.getDataset(n, seed);
    }
    // Simplified - in practice would shuffle and select n examples
    return this.evalDataset;
  }

  /**
   * Get evaluation inputs
   */
  getEvalInputs(
    numExamples: number = -1,
    rolloutsPerExample: number = 1
  ): Dataset | null {
    const inputs = this.getEvalDataset(numExamples);
    if (!inputs) {
      return null;
    }
    // Repeat dataset entries for multiple rollouts per example
    // Simplified implementation
    return inputs;
  }

  /**
   * Generate results path in format: outputs/evals/<env_id>--<model>/<uuid>
   * Matches Python get_results_path function
   */
  protected getResultsPath(modelId: string, basePath: string = "./outputs"): string {
    // Generate UUID (8 characters, similar to Python)
    const uuid = this.generateUUID().substring(0, 8);

    // Create env_model string: <env_id>--<model> (replace / with --)
    const envModelStr = `${this.envId || "unknown"}--${modelId.replace(/\//g, "--")}`;

    // Resolve base path relative to the environment cwd so Python writes to the same location
    const resolvedBasePath = path.resolve(basePath);

    // Construct path: outputs/evals/<env_model>/<uuid>
    return path.join(resolvedBasePath, "evals", envModelStr, uuid);
  }

  /**
   * Generate a UUID v4 string
   */
  private generateUUID(): string {
    // Use crypto.randomUUID() if available (Node.js 14.17+), otherwise fallback
    if (typeof crypto !== "undefined" && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    // Fallback implementation
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  /**
   * Initialize completion based on message type
   */
  async initCompletion(): Promise<Messages> {
    if (this.messageType === "chat") {
      return [];
    } else {
      return "";
    }
  }

  /**
   * Initialize state for a rollout
   */
  async initState(
    prompt: Messages,
    completion: Messages,
    answer: string,
    task: string,
    info: Info,
    exampleId: number
  ): Promise<State> {
    return {
      prompt,
      completion,
      answer,
      task,
      info,
      example_id: exampleId,
      responses: [],
      turn: 0,
      timing: {
        generation_ms: 0.0,
        scoring_ms: 0.0,
        total_ms: 0.0,
      },
    };
  }

  /**
   * Get model response using AI SDK generateText
   */
  async getModelResponse(
    modelId: string,
    prompt: Messages,
    tools?: Record<string, AISDKTool> | null,
    samplingArgs: SamplingArgs = {},
    messageType: MessageType | null = null,
    apiKey?: string,
    baseUrl?: string
  ): Promise<{
    id: string;
    choices: Array<{
      message?: {
        role: string;
        content: string | null;
        tool_calls?: unknown[];
      };
      text?: string;
    }>;
    toolCalls?: unknown[];
    toolResults?: unknown[];
  }> {
    const resolvedMessageType = messageType || this.messageType;
    const resolvedSamplingArgs = { ...this.samplingArgs, ...samplingArgs };

    try {
      if (resolvedMessageType === "chat") {
        if (typeof prompt !== "object" || !Array.isArray(prompt)) {
          throw new Error("Chat prompts must be an array of messages");
        }

        const messages = this.convertToCoreMessages(prompt);
        // Set API key in environment if provided
        if (apiKey && !process.env.OPENAI_API_KEY) {
          process.env.OPENAI_API_KEY = apiKey;
        }
        // Create OpenAI client - baseURL handled via OPENAI_BASE_URL env var if needed
        if (baseUrl) {
          process.env.OPENAI_BASE_URL = baseUrl;
        }
        const model = openai(modelId as any) as any;

        // If tools are provided, use AI SDK's tool calling
        if (tools && Object.keys(tools).length > 0) {
          const generateTextOptions: any = {
            model,
            messages,
            tools,
            temperature: resolvedSamplingArgs.temperature,
            maxOutputTokens: resolvedSamplingArgs.max_tokens || resolvedSamplingArgs.maxTokens,
          };
          // Add stopWhen for tool steps if maxSteps is specified
          if (resolvedSamplingArgs.maxSteps) {
            generateTextOptions.stopWhen = stepCountIs(resolvedSamplingArgs.maxSteps);
          }
          const result = await generateText(generateTextOptions);
          return this.convertFromAISDKResponse(result);
        }

        // No tools - simple generation
        const result = await generateText({
          model,
          messages,
          temperature: resolvedSamplingArgs.temperature,
          maxOutputTokens: resolvedSamplingArgs.max_tokens || resolvedSamplingArgs.maxTokens,
        });
        return this.convertFromAISDKResponse(result);
      } else {
        // Completion format
        if (typeof prompt !== "string") {
          throw new Error("Completion prompts must be a string");
        }

        // Set API key in environment if provided
        if (apiKey && !process.env.OPENAI_API_KEY) {
          process.env.OPENAI_API_KEY = apiKey;
        }
        // Create OpenAI client - baseURL handled via OPENAI_BASE_URL env var if needed
        if (baseUrl) {
          process.env.OPENAI_BASE_URL = baseUrl;
        }
        const model = openai(modelId as any) as any;

        // For completion format, convert string prompt to messages
        const result = await generateText({
          model,
          messages: [{ role: "user", content: prompt }],
          temperature: resolvedSamplingArgs.temperature as number,
          maxOutputTokens: (resolvedSamplingArgs.max_tokens as number) || (resolvedSamplingArgs.maxTokens as number),
        });

        return {
          id: `ai-sdk-${Date.now()}`,
          choices: [
            {
              text: result.text,
            },
          ],
        };
      }
    } catch (error: unknown) {
      // Handle context length errors
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (
        errorMessage.includes("context length") ||
        errorMessage.includes("maximum context length")
      ) {
        console.debug("Caught overlong prompt.");
        return {
          id: "overlong-prompt",
          choices: [],
        };
      }
      console.error("Error getting model response:", error);
      throw error;
    }
  }

  /**
   * Abstract method: run a rollout
   * Must be implemented by subclasses
   */
  abstract rollout(
    modelId: string,
    prompt: Messages,
    completion?: Messages,
    answer?: string,
    state?: State,
    task?: string,
    info?: Info,
    exampleId?: number,
    samplingArgs?: SamplingArgs,
    apiKey?: string,
    baseUrl?: string
  ): Promise<[Messages, State]>;

  /**
   * Run rollout with semaphore control
   */
  async runRollout(
    semaphore: Semaphore | null,
    modelId: string,
    prompt: Messages,
    completion?: Messages,
    answer?: string,
    state?: State,
    task?: string,
    info?: Info,
    exampleId?: number,
    samplingArgs?: SamplingArgs,
    apiKey?: string,
    baseUrl?: string
  ): Promise<[Messages, State]> {
    console.warn("[Environment] runRollout called!");
    const runFn = async () => {
      console.warn("[Environment] runRollout: calling this.rollout()");
      return this.rollout(
        modelId,
        prompt,
        completion,
        answer,
        state,
        task,
        info,
        exampleId,
        samplingArgs,
        apiKey,
        baseUrl
      );
    };

    if (semaphore) {
      return semaphore.withLock(runFn);
    }
    return runFn();
  }

  /**
   * Generate completions for inputs
   */
  async generate(
    inputs: GenerateInputs | Dataset,
    modelId: string,
    samplingArgs: SamplingArgs = {},
    numExamples?: number,
    rolloutsPerExample?: number,
    scoreRollouts: boolean = true,
    maxConcurrent: number = -1,
    maxConcurrentGeneration?: number,
    maxConcurrentScoring?: number,
    apiKey?: string,
    baseUrl?: string
  ): Promise<GenerateOutputs> {
    // Convert inputs to internal format
    let resultsDict: Record<string, unknown> = {};

    if ("prompt" in inputs && Array.isArray(inputs.prompt)) {
      // Already in GenerateInputs format
      resultsDict = {
        prompt: inputs.prompt,
        completion: inputs.completion || [],
        answer: inputs.answer || [],
        task: inputs.task || [],
        info: inputs.info || [],
        example_id: inputs.example_id || [],
      };
    } else {
      // Dataset format - extract columns
      const dataset = inputs as Dataset;
      const n = (dataset.prompt || []).length;
      
      resultsDict = {
        prompt: dataset.prompt || [],
        completion: [],
        answer: dataset.answer || Array(n).fill(""),
        task: dataset.task || Array(n).fill("default"),
        info: dataset.info || Array(n).fill({}),
        example_id: dataset.example_id || dataset.id || Array.from({ length: n }, (_, i) => i),
      };
    }

    const n = (resultsDict.prompt as unknown[]).length;
    if (n === 0) {
      throw new Error("No prompts provided");
    }
    
    // Ensure all arrays have the same length
    const ensureLength = <T>(arr: T[] | undefined, defaultValue: T): T[] => {
      if (!arr || arr.length === 0) {
        return Array(n).fill(defaultValue);
      }
      if (arr.length < n) {
        // Pad with default value if shorter
        return [...arr, ...Array(n - arr.length).fill(defaultValue)];
      }
      if (arr.length > n) {
        // Truncate if longer
        return arr.slice(0, n);
      }
      return arr;
    };
    
    // Normalize all arrays to length n
    resultsDict.prompt = resultsDict.prompt as Messages[];
    resultsDict.completion = [];
    resultsDict.answer = ensureLength(resultsDict.answer as string[], "");
    resultsDict.task = ensureLength(resultsDict.task as string[], "default");
    resultsDict.info = ensureLength(resultsDict.info as Info[], {});
    resultsDict.example_id = ensureLength(
      resultsDict.example_id as number[],
      -1
    ).map((id, i) => (id === -1 ? i : id));

    // Initialize completions and states
    const completions = await Promise.all(
      Array(n)
        .fill(0)
        .map(() => this.initCompletion())
    );

    const states = await Promise.all(
      Array(n)
        .fill(0)
        .map((_, i) =>
          this.initState(
            (resultsDict.prompt as Messages[])[i],
            completions[i],
            ((resultsDict.answer as string[]) || [])[i] || "",
            ((resultsDict.task as string[]) || [])[i] || "default",
            ((resultsDict.info as Info[]) || [])[i] || {},
            ((resultsDict.example_id as number[]) || [])[i] || i
          )
        )
    );

    // Run rollouts with concurrency control
    const genLimit =
      maxConcurrentGeneration !== undefined
        ? maxConcurrentGeneration
        : maxConcurrent;
    const generationSemaphore =
      genLimit > 0 ? new Semaphore(genLimit) : null;

    console.warn(`[Environment] generate: creating ${states.length} rollout tasks`);
    const rolloutTasks = states.map((state, i) => {
      console.warn(`[Environment] generate: creating rollout task ${i}`);
      return this.runRollout(
        generationSemaphore,
        modelId,
        (resultsDict.prompt as Messages[])[i],
        completions[i],
        ((resultsDict.answer as string[]) || [])[i] || "",
        state,
        ((resultsDict.task as string[]) || [])[i] || "default",
        ((resultsDict.info as Info[]) || [])[i] || {},
        ((resultsDict.example_id as number[]) || [])[i] || i,
        samplingArgs,
        apiKey,
        baseUrl
      );
    });

    const rolloutResults = await Promise.all(rolloutTasks);
    const finalCompletions = rolloutResults.map(([completion]) => completion);
    const finalStates = rolloutResults.map(([, state]) => state);

    // Score rollouts if requested
    let rewards: number[] = [];
    let metrics: Record<string, number[]> = {};

    if (scoreRollouts) {
      const scoreLimit =
        maxConcurrentScoring !== undefined
          ? maxConcurrentScoring
          : maxConcurrent;
      const scores = await this.rubric.scoreRollouts(
        resultsDict.prompt as Messages[],
        finalCompletions,
        resultsDict.answer as string[],
        finalStates,
        resultsDict.task as string[],
        resultsDict.info as Info[],
        resultsDict.example_id as number[],
        scoreLimit
      );
      rewards = scores.reward;
      metrics = scores.metrics;
    } else {
      rewards = Array(n).fill(0);
      const rewardFuncNames = this.rubric.getRewardFuncNames();
      metrics = Object.fromEntries(
        rewardFuncNames.map((name: string) => [name, Array(n).fill(0)])
      );
    }

    // Build metadata
    const numExamplesResolved = numExamples || n;
    const rolloutsPerExampleResolved = rolloutsPerExample || 1;

    // Generate path_to_save using same format as Python get_results_path
    // Format: outputs/evals/<env_id>--<model>/<uuid>
    const pathToSave = this.getResultsPath(modelId);

    const metadata: GenerateMetadata = {
      env_id: this.envId || "unknown",
      env_args: this.envArgs || {},
      model: modelId,
      base_url: baseUrl || "https://api.openai.com/v1",
      num_examples: numExamplesResolved,
      rollouts_per_example: rolloutsPerExampleResolved,
      sampling_args: { ...this.samplingArgs, ...samplingArgs },
      date: new Date().toISOString(),
      time_ms: 0,
      avg_reward:
        rewards.length > 0
          ? rewards.reduce((a, b) => a + b, 0) / rewards.length
          : 0,
      avg_metrics: Object.fromEntries(
        Object.entries(metrics).map(([k, v]) => [
          k,
          v.length > 0 ? v.reduce((a, b) => a + b, 0) / v.length : 0,
        ])
      ),
      state_columns: [],
      path_to_save: pathToSave,
    };

    return {
      prompt: resultsDict.prompt as Messages[],
      completion: finalCompletions,
      answer: resultsDict.answer as string[],
      state: finalStates,
      task: resultsDict.task as string[],
      info: resultsDict.info as Info[],
      example_id: resultsDict.example_id as number[],
      reward: rewards,
      metrics,
      metadata,
    };
  }

  /**
   * Evaluate model on evaluation dataset
   */
  async evaluate(
    modelId: string,
    samplingArgs: SamplingArgs = {},
    numExamples: number = -1,
    rolloutsPerExample: number = 1,
    scoreRollouts: boolean = true,
    maxConcurrent: number = -1,
    maxConcurrentGeneration?: number,
    maxConcurrentScoring?: number,
    apiKey?: string,
    baseUrl?: string
  ): Promise<GenerateOutputs> {
    const inputs = this.getEvalInputs(numExamples, rolloutsPerExample);
    if (!inputs) {
      throw new Error("No evaluation dataset available");
    }
    return this.generate(
      inputs,
      modelId,
      samplingArgs,
      numExamples,
      rolloutsPerExample,
      scoreRollouts,
      maxConcurrent,
      maxConcurrentGeneration,
      maxConcurrentScoring,
      apiKey,
      baseUrl
    );
  }
}
