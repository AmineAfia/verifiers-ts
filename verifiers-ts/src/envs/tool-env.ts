/**
 * ToolEnv for environments with tool calling capabilities
 * Uses AI SDK's native tool system
 */

import type { Messages, State, ChatMessage } from "../types/index.js";
import { MultiTurnEnv, MultiTurnEnvOptions } from "./multiturn-env.js";
import { maybeAwait } from "../utils/async-utils.js";
import {
  ToolDefinition,
  createAISDKToolsMap,
  type AISDKTool,
} from "../utils/tool-utils.js";

export interface ToolEnvOptions extends MultiTurnEnvOptions {
  tools?: ToolDefinition[];
  maxTurns?: number;
  errorFormatter?: (error: Error) => string;
}

export class ToolEnv extends MultiTurnEnv {
  protected tools: ToolDefinition[];
  protected toolMap: Map<string, ToolDefinition>;
  protected errorFormatter: (error: Error) => string;
  protected aiSdkTools: Record<string, AISDKTool>;

  constructor(options: ToolEnvOptions = {}) {
    const tools = options.tools || [];
    const aiSdkTools = createAISDKToolsMap(tools);

    super({
      ...options,
      maxTurns: options.maxTurns || 10,
      oaiTools: Object.values(aiSdkTools) as any,
    });

    this.tools = tools;
    this.toolMap = new Map(tools.map((tool) => [tool.name, tool]));
    this.errorFormatter =
      options.errorFormatter || ((e: Error) => e.message);
    this.aiSdkTools = aiSdkTools;
  }

  addTool(tool: ToolDefinition): void {
    this.tools.push(tool);
    const aiSdkTool = createAISDKToolsMap([tool]);
    this.aiSdkTools[tool.name] = Object.values(aiSdkTool)[0];
    this.toolMap.set(tool.name, tool);
    // Update parent's oaiTools
    (this as any).oaiTools = Object.values(this.aiSdkTools);
  }

  removeTool(toolName: string): void {
    this.tools = this.tools.filter((t) => t.name !== toolName);
    delete this.aiSdkTools[toolName];
    this.toolMap.delete(toolName);
    (this as any).oaiTools = Object.values(this.aiSdkTools);
  }

  async isCompleted(messages: Messages, state: State): Promise<boolean> {
    const baseCompleted = await super.isCompleted(messages, state);
    if (baseCompleted) {
      return true;
    }

    if (typeof messages === "string") {
      return false;
    }

    if (!Array.isArray(messages) || messages.length === 0) {
      return false;
    }

    const lastMessage = messages[messages.length - 1];
    if (typeof lastMessage !== "object" || lastMessage.role !== "assistant") {
      return false;
    }

    // Check if there are no tool calls
    const noToolCalls =
      !lastMessage.tool_calls || lastMessage.tool_calls.length === 0;
    return noToolCalls;
  }

  /**
   * Get AI SDK tools map for model calls
   */
  getAISDKTools(): Record<string, AISDKTool> {
    return this.aiSdkTools;
  }

  /**
   * Call a tool by name with arguments
   * Used by StatefulToolEnv
   */
  async callTool(
    toolName: string,
    toolArgs: Record<string, unknown>,
    toolCallId: string
  ): Promise<ChatMessage> {
    try {
      const toolDef = this.toolMap.get(toolName);
      if (!toolDef) {
        throw new Error(`Tool ${toolName} not found`);
      }
      const result = await toolDef.execute(toolArgs);
      return {
        role: "tool",
        content: typeof result === "string" ? result : JSON.stringify(result),
        tool_call_id: toolCallId,
      };
    } catch (e: any) {
      return {
        role: "tool",
        content: this.errorFormatter(e),
        tool_call_id: toolCallId,
      };
    }
  }

  /**
   * Environment response for tool calls
   * ToolEnv uses AI SDK's automatic tool calling, so this is typically not called
   * But we must implement it to satisfy the abstract requirement
   */
  async envResponse(messages: Messages, state: State): Promise<[Messages, State]> {
    // For ToolEnv, tools are handled automatically by AI SDK
    // This should rarely be called, but if it is, return empty response
    if (typeof messages === "string") {
      return ["", state];
    }
    return [[], state];
  }
}

// Export ToolDefinition for use in other envs
export type { ToolDefinition } from "../utils/tool-utils.js";
