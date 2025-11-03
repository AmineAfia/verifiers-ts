/**
 * GenerateTextAdapter - Uses AI SDK's generateText() directly
 * Allows users to pass generateText configuration objects as "agents"
 */

import { generateText, stepCountIs } from "ai";
import type {
  LanguageModel,
  StopCondition,
  CoreMessage,
} from "ai";
import { openai, createOpenAI } from "@ai-sdk/openai";
// GenerateTextParams extracted from generateText function signature
import { SingleTurnEnv } from "../envs/singleturn-env.js";
import type { EnvironmentOptions } from "../envs/environment.js";
import type {
  Messages,
  ChatMessage,
  State,
  Info,
  SamplingArgs,
} from "../types/index.js";
import { getSandboxClient, type SandboxConfig } from "../utils/sandbox-client.js";

type GenerateTextParams = Parameters<typeof generateText>[0];

export interface GenerateTextAdapterOptions extends EnvironmentOptions {
  /**
   * GenerateText configuration object
   * This is passed directly to generateText() calls
   */
  agent: Omit<GenerateTextParams, "messages" | "prompt">;
  /**
   * Map of tool names to arguments that should be skipped (hidden from model)
   * Used for stateful tools like sandbox tools that need state injection
   */
  argsToSkip?: Map<string, string[]>;
  /**
   * Optional sandbox configuration for sandbox lifecycle management
   */
  sandboxConfig?: {
    name?: string;
    dockerImage?: string;
    startCommand?: string;
    cpuCores?: number;
    memoryGb?: number;
    diskSizeGb?: number;
    gpuCount?: number;
    timeoutMinutes?: number;
    environmentVars?: Record<string, string>;
    teamId?: string;
    advancedConfigs?: Record<string, any>;
  };
}

export class GenerateTextAdapter extends SingleTurnEnv {
  private agentConfig: Omit<GenerateTextParams, "messages" | "prompt">;
  protected argsToSkip: Map<string, string[]>;
  protected sandboxConfig?: GenerateTextAdapterOptions["sandboxConfig"];

  constructor(options: GenerateTextAdapterOptions) {
    super(options);
    this.agentConfig = options.agent;
    this.argsToSkip = options.argsToSkip || new Map();
    this.sandboxConfig = options.sandboxConfig;
    console.warn("[Sandbox] GenerateTextAdapter constructor - sandboxConfig:", !!this.sandboxConfig, JSON.stringify(this.sandboxConfig));
    // Default stopWhen if not provided
    if (!this.agentConfig.stopWhen) {
      this.agentConfig.stopWhen = stepCountIs(10);
    }
  }

  async rollout(
    modelId: string,
    prompt: Messages,
    completion?: Messages,
    answer: string = "",
    state: State = {},
    task: string = "default",
    info: Info | null = null,
    exampleId: number = 0,
    samplingArgs: SamplingArgs = {},
    apiKey?: string,
    baseUrl?: string
  ): Promise<[Messages, State]> {
    // Initialize state if empty
    let resolvedState = state;
    if (Object.keys(state).length === 0) {
      resolvedState = await this.initState(
        prompt,
        completion || (await this.initCompletion()),
        answer,
        task,
        info || {},
        exampleId
      );
    }

    // Call setupState to initialize sandbox (and any other state setup)
    resolvedState = await this.setupState(resolvedState);

    // Convert verifiers Messages to AI SDK CoreMessage format
    const coreMessages = this.convertToCoreMessages(prompt);

    // Merge system prompt if provided in agent config
    let messages: CoreMessage[] = coreMessages;
    if (
      this.agentConfig.system &&
      !coreMessages.some((m) => m.role === "system")
    ) {
      messages = [
        { role: "system", content: this.agentConfig.system },
        ...coreMessages,
      ];
    }

    // Create model instance from modelId (override agentConfig.model if provided)
    // This allows evaluate() to specify a different model than the one in agent config
    // In AI SDK 5, the default openai() function uses Responses API (v2)
    // If apiKey/baseUrl are provided, create a custom provider; otherwise use default
    const openaiProvider = apiKey || baseUrl
      ? createOpenAI({
          apiKey: apiKey || process.env.OPENAI_API_KEY,
          baseURL: baseUrl || process.env.OPENAI_BASE_URL,
          // compatibility: "strict" is default in AI SDK 5
        })
      : openai; // Default export uses strict compatibility by default (v2)
    // Use default openai() function which returns v2-compatible LanguageModel (Responses API)
    // This ensures we get LanguageModel (v2) instead of LanguageModelV1
    // Cast to any to satisfy TypeScript type checking since generateText accepts both
    const model = openaiProvider(modelId) as any;

    // Merge sampling args from rollout call into agent config
    // We explicitly override the model property to ensure v2 compatibility
    // The default openai() returns LanguageModel (v2) which is compatible with generateText
    // Wrap tools for state injection if needed (for stateful tools like sandbox)
    let tools = this.agentConfig.tools;
    if (tools && this.argsToSkip.size > 0) {
      tools = this.wrapToolsForState(resolvedState, tools);
    }

    // Extract model separately to avoid type conflicts when spreading
    const { model: _originalModel, ...agentConfigWithoutModel } = this.agentConfig;
    const generateTextOptions: GenerateTextParams = {
      ...agentConfigWithoutModel,
      model, // Use v2 model created from modelId (LanguageModel)
      messages,
      tools, // Use wrapped tools if stateful tools exist
      // Override with rollout-level sampling args if provided
      temperature:
        samplingArgs.temperature !== undefined
          ? samplingArgs.temperature
          : this.agentConfig.temperature,
      maxOutputTokens:
        samplingArgs.max_tokens !== undefined ||
        samplingArgs.maxTokens !== undefined
          ? samplingArgs.max_tokens || samplingArgs.maxTokens
          : this.agentConfig.maxOutputTokens,
      topP:
        samplingArgs.top_p !== undefined ||
        samplingArgs.topP !== undefined
          ? samplingArgs.top_p || samplingArgs.topP
          : this.agentConfig.topP,
      topK: samplingArgs.top_k || samplingArgs.topK || this.agentConfig.topK,
      presencePenalty:
        samplingArgs.presence_penalty ||
        samplingArgs.presencePenalty ||
        this.agentConfig.presencePenalty,
      frequencyPenalty:
        samplingArgs.frequency_penalty ||
        samplingArgs.frequencyPenalty ||
        this.agentConfig.frequencyPenalty,
      stopSequences:
        samplingArgs.stop || samplingArgs.stopSequences || this.agentConfig.stopSequences,
      seed: samplingArgs.seed || this.agentConfig.seed,
    };

    // Call generateText with automatic tool loop
    const result = await generateText(generateTextOptions);

    // Convert result back to verifiers Messages format
    const completionMessages = this.convertResultToMessages(result);

    // Update state with full interaction history
    resolvedState.completion = completionMessages;
    resolvedState.responses = [result];
    resolvedState.toolCalls = result.toolCalls || [];
    resolvedState.toolResults = result.toolResults || [];
    
    // Update timing
    const timing = resolvedState.timing || {};
    if (result.totalUsage?.totalTokens) {
      // Rough estimate: assume ~0.001ms per token
      timing.generation_ms =
        (result.totalUsage.totalTokens * 0.001) || timing.generation_ms || 0;
    } else {
      timing.generation_ms = timing.generation_ms || 0;
    }
    timing.scoring_ms = timing.scoring_ms || 0;
    timing.total_ms = timing.generation_ms + timing.scoring_ms;
    resolvedState.timing = timing;

    // Check if rollout is completed (for cleanup)
    // isCompleted will handle sandbox cleanup if needed
    await this.isCompleted(completionMessages, resolvedState);

    return [completionMessages, resolvedState];
  }

  /**
   * Convert verifiers Messages to AI SDK CoreMessage format
   * Messages arrays are directly compatible - minimal conversion needed
   */
  protected convertToCoreMessages(messages: Messages): CoreMessage[] {
    if (typeof messages === "string") {
      return [{ role: "user", content: messages }];
    }

    return messages.map((msg) => {
      if (typeof msg === "string") {
        return { role: "user", content: msg };
      }

      // ChatMessage (OpenAI format) is compatible with CoreMessage
      const role =
        msg.role === "assistant"
          ? "assistant"
          : msg.role === "system"
            ? "system"
            : msg.role === "tool"
              ? "tool"
              : "user";

      // Content can be string or array (for multimodal)
      let content: string | Array<any>;
      if (typeof msg.content === "string") {
        content = msg.content;
      } else if (Array.isArray(msg.content)) {
        // Handle multimodal content (images, etc.)
        content = msg.content;
      } else {
        content = String(msg.content || "");
      }

      return { role, content } as CoreMessage;
    });
  }

  /**
   * Convert generateText result to verifiers Messages format
   * Preserves full conversation history including tool calls
   */
  private convertResultToMessages(
    result: Awaited<ReturnType<typeof generateText>>
  ): ChatMessage[] {
    const messages: ChatMessage[] = [];

    // Build full conversation history from steps
    if (result.steps && result.steps.length > 0) {
      for (const step of result.steps) {
        // Add assistant message with tool calls
        if (step.text || (step.toolCalls && step.toolCalls.length > 0)) {
          const assistantMsg: ChatMessage = {
            role: "assistant",
            content: step.text || "",
          };

          // Convert tool calls to OpenAI format
          if (step.toolCalls && step.toolCalls.length > 0) {
            assistantMsg.tool_calls = step.toolCalls.map((tc: any) => ({
              id: tc.toolCallId || tc.id,
              type: "function",
              function: {
                name: tc.toolName || tc.name,
                arguments:
                  typeof tc.args === "string"
                    ? tc.args
                    : typeof tc.input === "string"
                      ? tc.input
                      : JSON.stringify(tc.args || tc.input || {}),
              },
            }));
          }

          messages.push(assistantMsg);
        }

        // Add tool result messages
        if (step.toolResults && step.toolResults.length > 0) {
          for (const tr of step.toolResults) {
            const trAny = tr as any;
            messages.push({
              role: "tool",
              content:
                typeof trAny.result === "string"
                  ? trAny.result
                  : JSON.stringify(trAny.result || trAny),
              tool_call_id: trAny.toolCallId || trAny.id,
            });
          }
        }
      }
    } else {
      // Single step or no steps - just final text
      messages.push({
        role: "assistant",
        content: result.text || "",
      });

      // Also add tool calls if present in final result
      if (result.toolCalls && result.toolCalls.length > 0) {
        const lastMsg = messages[messages.length - 1];
        lastMsg.tool_calls = result.toolCalls.map((tc: any) => ({
          id: tc.toolCallId || tc.id,
          type: "function",
          function: {
            name: tc.toolName || tc.name,
            arguments:
              typeof tc.args === "string"
                ? tc.args
                : typeof tc.input === "string"
                  ? tc.input
                  : JSON.stringify(tc.args || tc.input || {}),
          },
        }));
      }

      // Add tool results if present
      if (result.toolResults && result.toolResults.length > 0) {
        for (const tr of result.toolResults) {
          const trAny = tr as any;
          messages.push({
            role: "tool",
            content:
              typeof trAny.result === "string"
                ? trAny.result
                : JSON.stringify(trAny.result || trAny),
            tool_call_id: trAny.toolCallId || trAny.id,
          });
        }
      }
    }

    return messages;
  }

  /**
   * Wrap tools to inject state for stateful tools (e.g., sandbox tools)
   * Only wraps tools that have args in argsToSkip map
   * Zero overhead when argsToSkip is empty
   */
  protected wrapToolsForState(
    state: State,
    tools: Record<string, any>
  ): Record<string, any> {
    const wrappedTools: Record<string, any> = {};

    for (const [toolName, toolInstance] of Object.entries(tools)) {
      const skippedArgs = this.argsToSkip.get(toolName);
      if (skippedArgs && skippedArgs.length > 0) {
        // Wrap this tool to inject state
        const originalExecute = (toolInstance as any).execute;
        wrappedTools[toolName] = {
          ...toolInstance,
          execute: async (args: any) => {
            // Inject state via updateToolArgs
            const updatedArgs = this.updateToolArgs(toolName, args, state);
            return originalExecute(updatedArgs);
          },
        };
      } else {
        // No state injection needed, pass through as-is
        wrappedTools[toolName] = toolInstance;
      }
    }

    return wrappedTools;
  }

  /**
   * Update tool arguments with state injection
   * For sandbox tools, injects sandbox_id from state
   */
  protected updateToolArgs(
    toolName: string,
    toolArgs: Record<string, unknown>,
    state: State
  ): Record<string, unknown> {
    // For sandbox tools, inject sandbox_id from state
    if (toolName === "bash" && this.sandboxConfig) {
      const sandboxId = state.sandbox_id as string | undefined;
      if (sandboxId) {
        return {
          ...toolArgs,
          sandbox_id: sandboxId,
        };
      }
    }
    return toolArgs;
  }

  /**
   * Setup state - create sandbox if sandbox is enabled
   */
  async setupState(state: State): Promise<State> {
    // Call parent setupState first
    state = await super.setupState(state);

    // Debug: Always log setupState being called
    console.warn("[Sandbox] setupState called, sandboxConfig:", !!this.sandboxConfig, "hasSandboxId:", !!state.sandbox_id);

    // Create sandbox if sandbox config is provided
    if (this.sandboxConfig && !state.sandbox_id) {
      try {
        console.warn("[Sandbox] Creating sandbox (config:", !!this.sandboxConfig, ")");
        const sandboxClient = await getSandboxClient();
        console.warn("[Sandbox] Client type:", sandboxClient.constructor.name);
        const sandbox = await sandboxClient.createSandbox({
          name: this.sandboxConfig.name || "sandbox-env",
          dockerImage: this.sandboxConfig.dockerImage || "python:3.11-slim",
          startCommand: this.sandboxConfig.startCommand || "tail -f /dev/null",
          cpuCores: this.sandboxConfig.cpuCores || 1,
          memoryGb: this.sandboxConfig.memoryGb || 2,
          diskSizeGb: this.sandboxConfig.diskSizeGb || 5,
          gpuCount: this.sandboxConfig.gpuCount || 0,
          timeoutMinutes: this.sandboxConfig.timeoutMinutes || 60,
          environmentVars: this.sandboxConfig.environmentVars || {},
          teamId: this.sandboxConfig.teamId,
          advancedConfigs: this.sandboxConfig.advancedConfigs,
        });
        state.sandbox_id = sandbox.id;
        console.warn(`[Sandbox] Created sandbox ${sandbox.id}`);
      } catch (error) {
        console.error("Failed to create sandbox:", error);
        throw error;
      }
    }

    return state;
  }

  /**
   * Cleanup sandbox when rollout is completed
   */
  async isCompleted(messages: Messages, state: State): Promise<boolean> {
    const completed = await super.isCompleted(messages, state);

    // Cleanup sandbox if rollout is completed
    if (completed && this.sandboxConfig && state.sandbox_id) {
      const sandboxId = state.sandbox_id as string;
      try {
        console.warn(`[Sandbox] Cleaning up sandbox ${sandboxId} (rollout completed)`);
        const sandboxClient = await getSandboxClient();
        await sandboxClient.deleteSandbox(sandboxId);
        console.warn(`[Sandbox] Deleted sandbox ${sandboxId}`);
        state.sandbox_id = undefined;
      } catch (error) {
        console.warn(`[Sandbox] Failed to delete sandbox ${sandboxId}:`, error);
        // Don't throw - cleanup failure shouldn't fail the rollout
      }
    }

    return completed;
  }
}

