/**
 * Example tool-using environment demonstrating AI SDK tools
 */

import {
  ToolEnv,
  Rubric,
  defineTool,
} from "verifiers-ts";
import { z } from "zod";

// Example tools using AI SDK format
const calculatorTool = defineTool(
  "calculate",
  "Perform basic arithmetic operations",
  z.object({
    expression: z.string().describe("Mathematical expression to evaluate"),
  }),
  async (args) => {
    try {
      // Simple eval for demonstration (use a proper parser in production)
      const result = Function(`"use strict"; return (${args.expression})`)();
      return String(result);
    } catch (error) {
      return `Error: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
);

const weatherTool = defineTool(
  "get_weather",
  "Get weather information for a location",
  z.object({
    location: z.string().describe("City or location name"),
  }),
  async (args) => {
    // Mock weather data
    return `Weather in ${args.location}: 72°F, sunny`;
  }
);

export function loadEnvironment(options: Record<string, any> = {}) {
  // Reward function that checks if tools were used correctly
  function toolUseReward(params: {
    completion: any;
    state: any;
  }): number {
    const responses = params.state.responses || [];
    let toolCallCount = 0;
    
    for (const response of responses) {
      if (response.toolCalls && response.toolCalls.length > 0) {
        toolCallCount += response.toolCalls.length;
      }
      if (response.choices?.[0]?.message?.tool_calls) {
        toolCallCount += response.choices[0].message.tool_calls.length;
      }
    }
    
    // Reward for using tools
    return Math.min(toolCallCount / 2, 1.0); // Max reward if 2+ tool calls
  }

  const rubric = new Rubric({
    funcs: [toolUseReward],
    weights: [1.0],
  });

  const env = new ToolEnv({
    tools: [calculatorTool, weatherTool],
    maxTurns: 10,
    rubric,
    envId: "example-tool-use",
    envArgs: options,
  });

  return env;
}




