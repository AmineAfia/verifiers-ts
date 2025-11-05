import type { CoreMessage } from "ai";
import { MultiTurnEnv, type MultiTurnEnvOptions } from "../envs/multiturn-env.js";
import type {
  Messages,
  State,
  SamplingArgs,
  MessageType,
  ModelResponse,
} from "../types/index.js";
import type { AISDKTool } from "../utils/tool-utils.js";
import { getSandboxClient, type SandboxConfig } from "../utils/sandbox-client.js";
import { extractExperimentalOutput } from "../utils/structured-output.js";
import type { GenerateTextAgent } from "./generate-text-adapter.js";

export interface MultiTurnGenerateTextAdapterOptions extends MultiTurnEnvOptions {
  agent: GenerateTextAgent;
  sandboxTools?: Record<string, AISDKTool>;
  sandboxArgsToSkip?: Map<string, string[]>;
  sandboxConfig?: SandboxConfig;
}

export abstract class MultiTurnGenerateTextAdapter extends MultiTurnEnv {
  protected agent: GenerateTextAgent;
  protected agentTools: Record<string, AISDKTool>;
  protected agentDefaults: Record<string, unknown>;
  protected sandboxTools: Record<string, AISDKTool> | null;
  protected sandboxArgsToSkip: Map<string, string[]>;
  protected sandboxConfig?: SandboxConfig;
  private currentState: State | null = null;

  constructor(options: MultiTurnGenerateTextAdapterOptions) {
    super(options);
    this.agent = options.agent;
    this.agentTools = { ...(options.agent.tools || {}) };
    this.agentDefaults = { ...(options.agent.defaults || {}) };
    this.sandboxTools = options.sandboxTools ? { ...options.sandboxTools } : null;
    this.sandboxArgsToSkip = options.sandboxArgsToSkip || new Map();
    this.sandboxConfig = options.sandboxConfig;
  }

  abstract envResponse(
    messages: Messages,
    state: State
  ): Promise<[Messages, State]>;

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

  async getContextMessages(state: State): Promise<Messages> {
    this.currentState = state;
    return super.getContextMessages(state);
  }

  async getModelResponse(
    modelId: string,
    prompt: Messages,
    tools?: Record<string, AISDKTool> | null,
    samplingArgs: SamplingArgs = {},
    messageType: MessageType | null = null,
    apiKey?: string,
    baseUrl?: string
  ): Promise<ModelResponse> {
    const resolvedMessageType = messageType || this.messageType;
    if (resolvedMessageType !== "chat") {
      throw new Error("MultiTurnGenerateTextAdapter only supports chat message type");
    }
    if (!Array.isArray(prompt)) {
      throw new Error("Chat prompts must be arrays");
    }

    const coreMessages = this.convertToCoreMessages(prompt);
    const mergedTools = this.mergeTools(this.currentState || {}, tools ?? null);
    const callOptions = this.buildCallOptions(mergedTools, samplingArgs, apiKey, baseUrl);

    const result = await this.agent.generateText(coreMessages, callOptions);
    const structuredOutput = extractExperimentalOutput(result);

    if (this.currentState) {
      if (!Array.isArray(this.currentState.raw_responses)) {
        this.currentState.raw_responses = [];
      }
      this.currentState.raw_responses.push(result);

      if (structuredOutput !== undefined) {
        this.currentState.structured_output = structuredOutput;
        if (!Array.isArray(this.currentState.structured_outputs)) {
          this.currentState.structured_outputs = [];
        }
        this.currentState.structured_outputs.push(structuredOutput);
      }
    }

    return this.convertFromAISDKResponse(result);
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
}
