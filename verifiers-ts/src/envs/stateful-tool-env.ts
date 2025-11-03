/**
 * StatefulToolEnv for tools that require dynamic state
 */

import type {
  Messages,
  State,
  ChatMessage,
} from "../types/index.js";
import { ToolEnv, ToolEnvOptions } from "./tool-env.js";
import type { ToolDefinition } from "../utils/tool-utils.js";
import { z } from "zod";

export interface StatefulToolEnvOptions extends ToolEnvOptions {}

export abstract class StatefulToolEnv extends ToolEnv {
  protected skippedArgs: Map<string, string[]>;

  constructor(options: StatefulToolEnvOptions = {}) {
    super(options);
    this.skippedArgs = new Map();
  }

  addTool(tool: ToolDefinition, argsToSkip: string[] = []): void {
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
      const modifiedTool: ToolDefinition = {
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

  async callTool(
    toolName: string,
    toolArgs: Record<string, unknown>,
    toolCallId: string
  ): Promise<ChatMessage> {
    // This will be called from envResponse after updateToolArgs
    return super.callTool(toolName, toolArgs, toolCallId);
  }

  /**
   * Override getModelResponse to inject state into tool calls
   * AI SDK will call this through the tool execute functions
   */
  async getModelResponse(
    modelId: string,
    prompt: Messages,
    tools?: Record<string, any> | null,
    samplingArgs: any = {},
    messageType?: any,
    apiKey?: string,
    baseUrl?: string
  ): Promise<any> {
    // Wrap tools with state injection
    if (tools) {
      const wrappedTools: Record<string, any> = {};
      for (const [name, toolInstance] of Object.entries(tools)) {
        const originalExecute = (toolInstance as any).execute;
        wrappedTools[name] = {
          ...toolInstance,
          execute: async (args: any) => {
            // Get current state from context (passed through state parameter)
            // This is a simplified approach - in practice, state would be passed differently
            const updatedArgs = this.updateToolArgs(
              name,
              args,
              prompt,
              {} as State // State would need to be passed through context
            );
            return originalExecute(updatedArgs);
          },
        };
      }
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

