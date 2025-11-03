import { z } from "zod";
import type { AISDKTool } from "verifiers-ts";
import { defineTool, createAISDKTool } from "verifiers-ts";
import type { generateText } from "ai";

type GenerateTextParams = Parameters<typeof generateText>[0];

export type HangmanAgentConfig = Omit<GenerateTextParams, "messages" | "prompt">;

export interface HangmanAgentOptions {
  agent?: HangmanAgentConfig;
  systemPrompt: string;
}

export const guessLetterSchema = z.object({
  letter: z.string().length(1).describe("The letter to guess (A-Z)"),
});

export function createGuessLetterTool(): AISDKTool {
  const guessLetterToolDef = defineTool(
    "guess_letter",
    "Guess a letter in the Hangman word. Call this tool with a single letter each turn.",
    guessLetterSchema,
    async ({ letter }: { letter: string }) => `Guessing letter: ${letter.toUpperCase()}`
  );

  return createAISDKTool(guessLetterToolDef);
}

export function prepareHangmanAgent(options: HangmanAgentOptions): HangmanAgentConfig {
  const guessLetterTool = createGuessLetterTool();
  const baseAgent = (options.agent ?? {}) as Partial<HangmanAgentConfig>;

  const tools: Record<string, AISDKTool> = {
    guess_letter: guessLetterTool,
    ...(baseAgent.tools || {}),
  };

  return {
    ...(baseAgent as HangmanAgentConfig),
    system: baseAgent.system || options.systemPrompt,
    tools,
  } as HangmanAgentConfig;
}

