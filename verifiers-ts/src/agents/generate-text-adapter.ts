import type { CoreMessage, GenerateTextResult } from "ai";
import { SingleTurnEnv } from "../envs/singleturn-env.js";
import type { EnvironmentOptions } from "../envs/environment.js";
import type {
  Messages,
  State,
  Info,
  SamplingArgs,
} from "../types/index.js";
import type { AISDKTool } from "../utils/tool-utils.js";
import { getSandboxClient, type SandboxConfig } from "../utils/sandbox-client.js";
import { extractExperimentalOutput } from "../utils/structured-output.js";

export interface GenerateTextAgent {
  generateText: (
    messages: CoreMessage[],
    options?: Record<string, unknown>
  ) => Promise<GenerateTextResult<any, any>>;
  tools?: Record<string, AISDKTool>;
  defaults?: Record<string, unknown>;
}

export interface GenerateTextAdapterOptions extends EnvironmentOptions {
  agent: GenerateTextAgent;
  sandboxTools?: Record<string, AISDKTool>;
  sandboxArgsToSkip?: Map<string, string[]>;
  sandboxConfig?: SandboxConfig;
}

export class GenerateTextAdapter extends SingleTurnEnv {
  protected agent: GenerateTextAgent;
  protected agentTools: Record<string, AISDKTool>;
  protected agentDefaults: Record<string, unknown>;
  protected sandboxTools: Record<string, AISDKTool> | null;
  protected sandboxArgsToSkip: Map<string, string[]>;
  protected sandboxConfig?: SandboxConfig;

  constructor(options: GenerateTextAdapterOptions) {
    super(options);
    this.agent = options.agent;
    this.agentTools = { ...(options.agent.tools || {}) };
    this.agentDefaults = { ...(options.agent.defaults || {}) };
    this.sandboxTools = options.sandboxTools ? { ...options.sandboxTools } : null;
    this.sandboxArgsToSkip = options.sandboxArgsToSkip || new Map();
    this.sandboxConfig = options.sandboxConfig;
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

    resolvedState = await this.setupState(resolvedState);

    try {
      const coreMessages = this.convertToCoreMessages(prompt);
      const mergedTools = this.mergeTools(resolvedState);
      const callOptions = this.buildCallOptions(mergedTools, samplingArgs, apiKey, baseUrl);

      const result = await this.agent.generateText(coreMessages, callOptions);
      const structuredOutput = extractExperimentalOutput(result);

      const completionMessages = this.convertResultToMessages(result, structuredOutput);
      resolvedState.completion = completionMessages;
      resolvedState.responses = [result];
      if (!Array.isArray(resolvedState.raw_responses)) {
        resolvedState.raw_responses = [];
      }
      resolvedState.raw_responses.push(result);

      if (structuredOutput !== undefined) {
        resolvedState.structured_output = structuredOutput;
        if (!Array.isArray(resolvedState.structured_outputs)) {
          resolvedState.structured_outputs = [];
        }
        resolvedState.structured_outputs.push(structuredOutput);
      }

      resolvedState.toolCalls = result.toolCalls || [];
      resolvedState.toolResults = result.toolResults || [];

      const timing = resolvedState.timing || {};
      timing.generation_ms = timing.generation_ms || 0;
      timing.scoring_ms = timing.scoring_ms || 0;
      timing.total_ms = timing.generation_ms + timing.scoring_ms;
      resolvedState.timing = timing;

      return [completionMessages, resolvedState];
    } finally {
      // Cleanup sandbox after rollout completes
      if (this.sandboxConfig && resolvedState.sandbox_id) {
        try {
          const sandboxClient = await getSandboxClient();
          await sandboxClient.deleteSandbox(resolvedState.sandbox_id as string);
        } catch (error) {
          console.warn("[Sandbox] Failed to delete sandbox:", error);
        } finally {
          resolvedState.sandbox_id = undefined;
        }
      }
    }
  }

  protected mergeTools(
    state: State,
    extras: Record<string, AISDKTool> | null = null
  ): Record<string, AISDKTool> {
    const merged: Record<string, AISDKTool> = { ...(extras || {}) };
    for (const [name, tool] of Object.entries(this.agentTools)) {
      merged[name] = tool;
    }
    if (this.sandboxTools) {
      for (const [name, tool] of Object.entries(this.sandboxTools)) {
        merged[name] = tool;
      }
    }
    return this.wrapToolsForState(state, merged);
  }

  protected buildCallOptions(
    tools: Record<string, AISDKTool>,
    samplingArgs: SamplingArgs,
    apiKey?: string,
    baseUrl?: string
  ): Record<string, unknown> {
    const overrides: Record<string, unknown> = {
      ...this.agentDefaults,
      tools,
    };

    if (samplingArgs.temperature !== undefined) {
      overrides.temperature = samplingArgs.temperature;
    }
    if (samplingArgs.max_tokens !== undefined || samplingArgs.maxTokens !== undefined) {
      overrides.maxOutputTokens = samplingArgs.max_tokens ?? samplingArgs.maxTokens;
    }
    if (samplingArgs.top_p !== undefined || samplingArgs.topP !== undefined) {
      overrides.topP = samplingArgs.top_p ?? samplingArgs.topP;
    }
    if (samplingArgs.top_k !== undefined || samplingArgs.topK !== undefined) {
      overrides.topK = samplingArgs.top_k ?? samplingArgs.topK;
    }
    if (samplingArgs.presence_penalty !== undefined || samplingArgs.presencePenalty !== undefined) {
      overrides.presencePenalty = samplingArgs.presence_penalty ?? samplingArgs.presencePenalty;
    }
    if (samplingArgs.frequency_penalty !== undefined || samplingArgs.frequencyPenalty !== undefined) {
      overrides.frequencyPenalty = samplingArgs.frequency_penalty ?? samplingArgs.frequencyPenalty;
    }
    if (samplingArgs.stop !== undefined || samplingArgs.stopSequences !== undefined) {
      overrides.stopSequences = samplingArgs.stop ?? samplingArgs.stopSequences;
    }
    if (samplingArgs.seed !== undefined) {
      overrides.seed = samplingArgs.seed;
    }

    if (apiKey) {
      overrides.apiKey = apiKey;
    }
    if (baseUrl) {
      overrides.baseUrl = baseUrl;
    }

    return overrides;
  }

  protected wrapToolsForState(
    state: State,
    tools: Record<string, AISDKTool>
  ): Record<string, AISDKTool> {
    if (this.sandboxArgsToSkip.size === 0) {
      return tools;
    }

    const wrapped: Record<string, AISDKTool> = {};
    for (const [name, tool] of Object.entries(tools)) {
      const skippedArgs = this.sandboxArgsToSkip.get(name);
      if (!skippedArgs || skippedArgs.length === 0) {
        wrapped[name] = tool;
        continue;
      }

      const originalExecute = (tool as any).execute;
      wrapped[name] = {
        ...(tool as any),
        execute: async (args: Record<string, unknown>) => {
          const updatedArgs = this.updateToolArgs(name, args, state);
          return originalExecute(updatedArgs);
        },
      } as unknown as AISDKTool;
    }
    return wrapped;
  }

  protected updateToolArgs(
    toolName: string,
    toolArgs: Record<string, unknown>,
    state: State
  ): Record<string, unknown> {
    if (toolName === "bash" && this.sandboxConfig) {
      const sandboxId = state.sandbox_id as string | undefined;
      if (sandboxId) {
        return { ...toolArgs, sandbox_id: sandboxId };
      }
    }
    return toolArgs;
  }

  async setupState(state: State): Promise<State> {
    state = await super.setupState(state);

    if (this.sandboxConfig && !state.sandbox_id) {
      try {
        const sandboxClient = await getSandboxClient();
        const sandbox = await sandboxClient.createSandbox({
          name: this.sandboxConfig.name || "sandbox-env",
          dockerImage: this.sandboxConfig.dockerImage || "python:3.11-slim",
          startCommand: this.sandboxConfig.startCommand,
          cpuCores: this.sandboxConfig.cpuCores,
          memoryGb: this.sandboxConfig.memoryGb,
          diskSizeGb: this.sandboxConfig.diskSizeGb,
          gpuCount: this.sandboxConfig.gpuCount,
          timeoutMinutes: this.sandboxConfig.timeoutMinutes,
          environmentVars: this.sandboxConfig.environmentVars,
          teamId: this.sandboxConfig.teamId,
          advancedConfigs: this.sandboxConfig.advancedConfigs,
        });
        state.sandbox_id = sandbox.id;
        
        // Wait for sandbox to be ready before proceeding with evaluation
        // This ensures the sandbox is provisioned and running before any tool calls
        await sandboxClient.waitForCreation(sandbox.id);
      } catch (error) {
        // Re-throw sandbox errors so they propagate up and cause process to exit
        throw error;
      }
    }

    return state;
  }

  protected convertResultToMessages(
    result: GenerateTextResult<any, any>,
    structuredOutput?: unknown
  ): Messages {
    const converted = this.convertFromAISDKResponse(result);
    const choice = converted.choices[0];
    const message = choice.message;
    const serializedStructured =
      structuredOutput !== undefined ? JSON.stringify(structuredOutput) : undefined;

    // Extract content - prefer structured output, then text content, then empty string
    const assistantContent =
      serializedStructured ?? message?.content ?? "";

    // Check if we have tool calls or tool results - we should always include an assistant message
    // even if content is empty, as long as there are tool calls or tool results
    const hasToolCalls = message?.tool_calls && message.tool_calls.length > 0;
    const hasToolResults = converted.toolResults && converted.toolResults.length > 0;

    // If there's no content and no tool calls/results, return empty array
    if (!assistantContent && !hasToolCalls && !hasToolResults) {
      return [];
    }

    const messagesArray: any[] = [
      {
        role: "assistant",
        content: assistantContent,
        tool_calls: message?.tool_calls as any,
      },
    ];

    // Add tool results as tool messages
    if (converted.toolResults && converted.toolResults.length > 0) {
      for (const toolResult of converted.toolResults as any[]) {
        messagesArray.push({
          role: "tool",
          content:
            typeof toolResult.result === "string"
              ? toolResult.result
              : JSON.stringify(toolResult.result || toolResult),
          tool_call_id: toolResult.toolCallId || toolResult.id,
        });
      }
    }

    return messagesArray as Messages;
  }
}
