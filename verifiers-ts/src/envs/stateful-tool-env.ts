/**
 * StatefulToolEnv for tools that require dynamic state
 */

import type {
  Messages,
  State,
  ChatMessage,
  ModelResponse,
  SamplingArgs,
  MessageType,
} from "../types/index.js";
import { ToolEnv, ToolEnvOptions } from "./tool-env.js";
import type { ToolDefinition, AISDKTool } from "../utils/tool-utils.js";
import { z } from "zod";

export interface StatefulToolEnvOptions extends ToolEnvOptions {}

export abstract class StatefulToolEnv extends ToolEnv {
  protected skippedArgs: Map<string, string[]>;
  protected currentState: State | null = null;

  constructor(options: StatefulToolEnvOptions = {}) {
    super(options);
    this.skippedArgs = new Map();
  }

  addTool(tool: ToolDefinition<any>, argsToSkip: string[] = []): void {
    // Create a modified tool schema without skipped args
    if (argsToSkip.length > 0) {
      const originalShape = tool.inputSchema.shape;
      const filteredShape: Record<string, z.ZodTypeAny> = {};
      
      for (const [key, value] of Object.entries(originalShape)) {
        if (!argsToSkip.includes(key)) {
          filteredShape[key] = value as z.ZodTypeAny;
        }
      }
      
      const filteredSchema = z.object(filteredShape);
      const modifiedTool: ToolDefinition<any> = {
        ...tool,
        inputSchema: filteredSchema,
      };
      
      super.addTool(modifiedTool);
      this.skippedArgs.set(tool.name, argsToSkip);
    } else {
      super.addTool(tool);
    }
  }

  removeTool(toolName: string): void {
    super.removeTool(toolName);
    this.skippedArgs.delete(toolName);
  }

  /**
   * Update tool arguments based on current state
   * Must be implemented by subclasses
   */
  abstract updateToolArgs(
    toolName: string,
    toolArgs: Record<string, unknown>,
    messages: Messages,
    state: State
  ): Record<string, unknown>;

  /**
   * Override getContextMessages to store state before getModelResponse is called
   * This allows us to access state when wrapping tools for state injection
   */
  async getContextMessages(state: State): Promise<Messages> {
    this.currentState = state;
    return super.getContextMessages(state);
  }

  async callTool(
    toolName: string,
    toolArgs: Record<string, unknown>,
    toolCallId: string
  ): Promise<ChatMessage> {
    // This will be called from envResponse after updateToolArgs
    return super.callTool(toolName, toolArgs, toolCallId);
  }

  /**
   * Wrap tools with state injection before passing to parent
   */
  protected wrapToolsForState(
    state: State,
    tools: Record<string, AISDKTool>
  ): Record<string, AISDKTool> {
    if (!this.currentState) {
      return tools;
    }

    const wrapped: Record<string, AISDKTool> = {};
    for (const [name, tool] of Object.entries(tools)) {
      // AI SDK Tool type doesn't expose execute in a type-safe way
      // We need to access it via type assertion
      const toolWithExecute = tool as AISDKTool & { execute?: (args: unknown) => unknown | Promise<unknown> };
      const originalExecute = toolWithExecute.execute;
      
      if (!originalExecute) {
        // If tool doesn't have execute, pass through unchanged
        wrapped[name] = tool;
        continue;
      }
      
      wrapped[name] = {
        ...tool,
        execute: async (args: unknown) => {
          // Type guard to ensure args is a record
          if (typeof args !== "object" || args === null || Array.isArray(args)) {
            throw new Error(`Tool ${name} received invalid arguments: expected object, got ${typeof args}`);
          }
          
          const argsRecord = args as Record<string, unknown>;
          
          // Use stored currentState to update tool args
          const updatedArgs = this.updateToolArgs(
            name,
            argsRecord,
            typeof state.prompt === "string" ? state.prompt : (state.prompt as Messages),
            this.currentState!
          );
          return originalExecute(updatedArgs);
        },
      } as AISDKTool;
    }
    return wrapped;
  }

  /**
   * Override getModelResponse to inject state into tool calls
   * AI SDK will call this through the tool execute functions
   */
  async getModelResponse(
    modelId: string,
    prompt: Messages,
    tools?: Record<string, AISDKTool> | null,
    samplingArgs: SamplingArgs = {},
    messageType?: MessageType | null,
    apiKey?: string,
    baseUrl?: string
  ): Promise<ModelResponse> {
    // Wrap tools with state injection using stored currentState
    if (tools && this.currentState) {
      const wrappedTools = this.wrapToolsForState(this.currentState, tools);
      return super.getModelResponse(
        modelId,
        prompt,
        wrappedTools,
        samplingArgs,
        messageType,
        apiKey,
        baseUrl
      );
    }
    return super.getModelResponse(
      modelId,
      prompt,
      tools,
      samplingArgs,
      messageType,
      apiKey,
      baseUrl
    );
  }
}

