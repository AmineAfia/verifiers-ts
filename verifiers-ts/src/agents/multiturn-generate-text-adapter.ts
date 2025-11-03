/**
 * MultiTurnGenerateTextAdapter - Uses AI SDK's generateText() in multi-turn environments
 * Allows users to pass generateText configuration objects as "agents" for multi-turn interactions
 * Extends MultiTurnEnv and overrides getModelResponse() to use agent config
 */

import { generateText, stepCountIs } from "ai";
import type {
  CoreMessage,
} from "ai";
import { openai, createOpenAI } from "@ai-sdk/openai";
import { MultiTurnEnv, MultiTurnEnvOptions } from "../envs/multiturn-env.js";
import type {
  Messages,
  ChatMessage,
  State,
  SamplingArgs,
  MessageType,
} from "../types/index.js";
import type { AISDKTool } from "../utils/tool-utils.js";
import { getSandboxClient, type SandboxConfig } from "../utils/sandbox-client.js";

type GenerateTextParams = Parameters<typeof generateText>[0];

export interface MultiTurnGenerateTextAdapterOptions extends MultiTurnEnvOptions {
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

export abstract class MultiTurnGenerateTextAdapter extends MultiTurnEnv {
  private agentConfig: Omit<GenerateTextParams, "messages" | "prompt">;
  protected argsToSkip: Map<string, string[]>;
  protected sandboxConfig?: MultiTurnGenerateTextAdapterOptions["sandboxConfig"];

  constructor(options: MultiTurnGenerateTextAdapterOptions) {
    super(options);
    this.agentConfig = options.agent;
    this.argsToSkip = options.argsToSkip || new Map();
    this.sandboxConfig = options.sandboxConfig;
    console.warn("[Sandbox] MultiTurnGenerateTextAdapter constructor - sandboxConfig:", !!this.sandboxConfig, JSON.stringify(this.sandboxConfig));
    // Default stopWhen if not provided
    if (!this.agentConfig.stopWhen) {
      this.agentConfig.stopWhen = stepCountIs(10);
    }
  }

  /**
   * envResponse must be implemented by subclasses (e.g., HangmanRLEnv)
   */
  abstract envResponse(
    messages: Messages,
    state: State
  ): Promise<[Messages, State]>;

  /**
   * Override getModelResponse to use agent config with generateText()
   * This is called by MultiTurnEnv.rollout() in each iteration of the loop
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
    
    // Only support chat messages for now (multi-turn is typically chat)
    if (resolvedMessageType !== "chat") {
      throw new Error("MultiTurnGenerateTextAdapter only supports chat message type");
    }

    if (typeof prompt !== "object" || !Array.isArray(prompt)) {
      throw new Error("Chat prompts must be an array of messages");
    }

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

    // Create model instance from agent config (override with modelId if different)
    // If apiKey/baseUrl are provided, create a custom provider; otherwise use default
    const openaiProvider = apiKey || baseUrl
      ? createOpenAI({
          apiKey: apiKey || process.env.OPENAI_API_KEY,
          baseURL: baseUrl || process.env.OPENAI_BASE_URL,
        })
      : openai;
    
    // Use model from agent config, but allow override via modelId parameter
    // This allows evaluate() to specify a different model than the one in agent config
    const model = this.agentConfig.model 
      ? (this.agentConfig.model as any)
      : (openaiProvider(modelId) as any);

    // Merge tools from agent config with tools parameter
    // Agent config tools take precedence
    let mergedTools = this.agentConfig.tools || {};
    if (tools && Object.keys(tools).length > 0) {
      mergedTools = { ...mergedTools, ...tools };
    }

    // Wrap tools for state injection if needed (for stateful tools like sandbox)
    // Note: We need access to state here, but getModelResponse doesn't receive it
    // For now, we'll wrap tools but state injection will happen in updateToolArgs
    // This is a limitation - we may need to pass state through context in the future
    // For sandbox tools, we handle this in updateToolArgs which is called during tool execution

    // Merge sampling args from call into agent config
    const { model: _originalModel, ...agentConfigWithoutModel } = this.agentConfig;
    const generateTextOptions: GenerateTextParams = {
      ...agentConfigWithoutModel,
      model, // Use model from agent config or create from modelId
      messages,
      tools: mergedTools,
      // Override with call-level sampling args if provided
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

    // Convert result back to expected format (same as base Environment.getModelResponse)
    return this.convertFromAISDKResponse(result);
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
   * Convert generateText result to expected getModelResponse format
   * Matches the format returned by base Environment.getModelResponse
   */
  protected convertFromAISDKResponse(
    result: Awaited<ReturnType<typeof generateText>>
  ): {
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

    // Convert tool calls to OpenAI format with correct type
    const oaiToolCalls: Array<{
      id: string;
      type: string;
      function: {
        name: string;
        arguments: string;
      };
    }> = toolCalls.map((tc: any) => ({
      id: tc.toolCallId || tc.id || `tc-${Date.now()}-${Math.random()}`,
      type: "function" as const,
      function: {
        name: tc.toolName || tc.name || "unknown",
        arguments: typeof tc.args === "string" 
          ? tc.args 
          : typeof tc.input === "string"
            ? tc.input
            : JSON.stringify(tc.args || tc.input || {}),
      },
    }));

    // Generate id from result if available, otherwise create one
    const resultId = (result as any).responseId || 
                     (result as any).id || 
                     `ai-sdk-${Date.now()}`;

    return {
      id: resultId,
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
   * Wrap tools to inject state for stateful tools (e.g., sandbox tools)
   * Only wraps tools that have args in argsToSkip map
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
    console.warn("[Sandbox] MultiTurn setupState called, sandboxConfig:", !!this.sandboxConfig, "hasSandboxId:", !!state.sandbox_id);

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

