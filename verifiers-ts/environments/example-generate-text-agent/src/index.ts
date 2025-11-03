/**
 * Example environment using createRLEnvironment with generateText agent
 * Demonstrates how to easily convert AI SDK agents into RL environments
 */

import { openai } from "@ai-sdk/openai";
import { stepCountIs } from "ai";
import { z } from "zod";
import {
  createRLEnvironment,
  loadDataset,
  defineTool,
  createAISDKTool,
  type Environment,
  type Messages,
  type RewardFunc,
} from "verifiers-ts";

/**
 * Example: Simple Q&A environment with weather tool
 */
export async function loadEnvironment(): Promise<Environment> {
  // 1. Define tools using verifiers-ts helper function (which handles AI SDK correctly)
  const weatherParams = z.object({
    location: z.string().describe("The city and state, e.g. San Francisco, CA"),
    unit: z.enum(["celsius", "fahrenheit"]).optional().describe("Temperature unit"),
  });
  
  const weatherToolDef = defineTool(
    "weather",
    "Get the current weather for a location",
    weatherParams,
    async (args: z.infer<typeof weatherParams>) => {
      // Mock weather API call
      const { location, unit } = args;
      return `The weather in ${location} is 72°${unit === "celsius" ? "C" : "F"} and sunny.`;
    }
  );
  
  // Convert to AI SDK tool format
  const weatherTool = createAISDKTool(weatherToolDef);

  // 2. Create generateText configuration object (agent)
  // Use default openai() which uses Responses API (v2) in AI SDK 5
  const myAgent = {
    model: openai("gpt-4o-mini"),
    system: "You are a helpful assistant that answers questions and can check the weather.",
    tools: { weather: weatherTool },
    stopWhen: stepCountIs(10), // Max 10 tool steps
    temperature: 0.7,
    maxOutputTokens: 1000,
  };

  // 3. Create simple dataset (in practice, load from file)
  const datasetData = [
    {
      question: "What is 2+2?",
      answer: "4",
    },
    {
      question: "What's the weather in San Francisco?",
      answer: "72°F and sunny",
    },
    {
      question: "What is the capital of France?",
      answer: "Paris",
    },
  ];

  // 4. Create RL environment with one function call!
  const env = await createRLEnvironment({
    agent: myAgent,
    dataset: await loadDataset({
      source: "array",
      data: datasetData,
      questionKey: "question",
      answerKey: "answer",
    }),
    rewardFunction: (async (...args: unknown[]) => {
      // The rubric tries object form first: { completion, answer, parser, ... }
      // Then falls back to individual params: (completion, answer, state, task, info, parser)
      let completion: Messages;
      let expectedAnswer: string;
      let parser: { parseAnswer?: (msgs: Messages) => string | null } | undefined;
      
      if (args.length === 1 && typeof args[0] === "object" && args[0] !== null && "completion" in args[0]) {
        // Object form
        const argObj = args[0] as { completion?: Messages; answer?: string; parser?: typeof parser };
        completion = argObj.completion || [];
        expectedAnswer = argObj.answer || "";
        parser = argObj.parser;
      } else {
        // Individual parameter form: (completion, answer, state, task, info, parser)
        completion = (args[0] as Messages) || [];
        expectedAnswer = (args[1] as string) || "";
        parser = args[5] as typeof parser;
      }
      
      // Extract text from Messages using parser if available
      let text = "";
      if (parser && typeof parser.parseAnswer === "function") {
        const parsed = parser.parseAnswer(completion);
        text = parsed || "";
      } else {
        // Simple extraction: get assistant message content
        if (typeof completion === "string") {
          text = completion;
        } else if (Array.isArray(completion)) {
          const assistantMsgs = completion.filter(
            (m) => 
              typeof m === "object" && m !== null && "role" in m && m.role === "assistant"
          );
          text = assistantMsgs.map((m) => {
            const msg = m as { content?: string };
            return msg.content || "";
          }).join(" ");
        }
      }
      
      return text.toLowerCase().includes(expectedAnswer.toLowerCase()) ? 1.0 : 0.0;
    }) as RewardFunc,
    sandbox: { enabled: true },
    envId: "example-generate-text-agent",
  });

  return env;
}

