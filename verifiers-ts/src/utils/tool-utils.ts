/**
 * Tool utilities for creating AI SDK tools
 * Uses AI SDK's native tool() function
 */

import { tool } from "ai";
import { z } from "zod";

export type AISDKTool = ReturnType<typeof tool>;

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: z.ZodObject<any>;
  execute: (args: z.infer<z.ZodObject<any>>) => any | Promise<any>;
}

/**
 * Create an AI SDK tool from a tool definition
 */
export function createAISDKTool(def: ToolDefinition): AISDKTool {
  // AI SDK 5.0 uses inputSchema instead of parameters
  // The tool() function accepts Zod schemas directly
  return tool({
    description: def.description,
    inputSchema: def.inputSchema, // Changed from 'parameters' to 'inputSchema' in AI SDK 5
    execute: def.execute as any,
  } as any) as any;
}

/**
 * Helper to create a tool definition that can be converted to AI SDK tool
 */
export function defineTool<T extends z.ZodObject<any>>(
  name: string,
  description: string,
  inputSchema: T,
  execute: (args: z.infer<T>) => any | Promise<any>
): ToolDefinition {
  return {
    name,
    description,
    inputSchema,
    execute,
  };
}

/**
 * Create AI SDK tools object from tool definitions
 */
export function createAISDKToolsMap(
  toolDefs: ToolDefinition[]
): Record<string, AISDKTool> {
  const tools: Record<string, AISDKTool> = {};
  for (const def of toolDefs) {
    tools[def.name] = createAISDKTool(def);
  }
  return tools;
}
