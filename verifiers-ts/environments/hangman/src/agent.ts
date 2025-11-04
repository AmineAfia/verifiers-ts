import type { GenerateTextAgent, AISDKTool } from "verifiers-ts";
import { defineTool, createAISDKTool } from "verifiers-ts";
import { generateText, stepCountIs } from "ai";
import type { CoreMessage } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";

const guessLetterDefinition = defineTool(
  "guess_letter",
  "Guess a single letter in the Hangman word.",
  z.object({
    letter: z
      .string()
      .length(1, { message: "Provide exactly one character." })
      .describe("Single letter to guess."),
  }),
  async ({ letter }) => `Guessed ${letter.toUpperCase()}`
);

const guessLetter = createAISDKTool(guessLetterDefinition);

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
