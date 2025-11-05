/**
 * Tool utilities for creating AI SDK tools
 * Uses AI SDK's native tool() function
 */

import { tool, type Tool } from "ai";
import { z } from "zod";

// AI SDK Tool type - accepts any Tool instance from AI SDK
// Using `any` for type parameters to allow tools with specific input/output types
// This is necessary because AI SDK's tool() function returns strongly-typed Tool instances
// like Tool<{ letter: string; }, string>, and TypeScript's generic types are invariant
// so we need to use `any` to accept all Tool variants
export type AISDKTool = Tool<any, any>;

// Generic tool definition interface
// Using any for the generic constraint to allow specific ZodObject types
export interface ToolDefinition<T extends z.ZodObject<any> = z.ZodObject<any>> {
  name: string;
  description: string;
  inputSchema: T;
  execute: (args: z.infer<T>) => unknown | Promise<unknown>;
}

/**
 * Create an AI SDK tool from a tool definition
 */
export function createAISDKTool<T extends z.ZodObject<any>>(
  def: ToolDefinition<T>
): AISDKTool {
  // AI SDK 5.0 uses inputSchema instead of parameters
  // The tool() function accepts Zod schemas directly
  // Note: AI SDK's tool() function has complex type constraints, so we use type assertions
  return tool({
    description: def.description,
    inputSchema: def.inputSchema, // Changed from 'parameters' to 'inputSchema' in AI SDK 5
    execute: def.execute as (args: unknown) => unknown | Promise<unknown>,
  }) as AISDKTool;
}

/**
 * Helper to create a tool definition that can be converted to AI SDK tool
 */
export function defineTool<T extends z.ZodObject<any>>(
  name: string,
  description: string,
  inputSchema: T,
  execute: (args: z.infer<T>) => unknown | Promise<unknown>
): ToolDefinition<T> {
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
  toolDefs: ToolDefinition<any>[]
): Record<string, AISDKTool> {
  const tools: Record<string, AISDKTool> = {};
  for (const def of toolDefs) {
    tools[def.name] = createAISDKTool(def);
  }
  return tools;
}
