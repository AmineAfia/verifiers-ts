import type { GenerateTextAgent, AISDKTool } from "verifiers-ts";
import { tool, generateText, stepCountIs } from "ai";
import type { CoreMessage } from "ai";
import { openai } from "@ai-sdk/openai";

const guessLetter = (tool as any)({
  description: "Guess a single letter in the Hangman word.",
  execute: async (args: any) => `Guessed ${String(args?.letter ?? args).toUpperCase()}`,
}) as AISDKTool;

export const hangmanGenerateText = (
  messages: CoreMessage[],
  options: Record<string, unknown> = {}
) => {
  const { tools: overrideTools = {}, ...rest } = options as {
    tools?: Record<string, AISDKTool>;
  } & Record<string, unknown>;

  return generateText({
    model: openai("gpt-4o-mini") as any,
    system: [
      "You are playing Hangman.",
      "Each turn you must call guess_letter with exactly one character.",
      "Explain your reasoning briefly before calling the tool.",
    ].join("\n"),
    stopWhen: stepCountIs(12),
    temperature: 0,
    tools: {
      guess_letter: guessLetter,
      ...overrideTools,
    },
    ...rest,
    messages,
  });
};

export const hangmanAgent: GenerateTextAgent = {
  generateText: hangmanGenerateText,
  tools: {
    guess_letter: guessLetter,
  },
};
