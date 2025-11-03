/**
 * Hangman game environment for verifiers-ts
 * Multi-turn interactive game where the model guesses letters to reveal a secret word
 */

import { XMLParser, Rubric, createRLEnvironment } from "verifiers-ts";
import type { Environment, Messages, State, SandboxConfig } from "verifiers-ts";
import {
  DEFAULT_WRONG_GUESSES,
  generateDataset,
  generateWordList,
  createSetupStateHook,
  createEnvResponseHook,
  createIsCompletedHook,
  type HangmanGameState,
} from "./game.js";
import { prepareHangmanAgent, type HangmanAgentConfig } from "./agent.js";

// ============================================================================
// Reward Functions
// ============================================================================

function correctnessReward(
  parser: XMLParser,
  completion: Messages,
  answer: string,
  state: State,
  task: string,
  info: unknown,
  ...args: unknown[]
): number {
  const gameState = state.gameState as HangmanGameState | undefined;
  if (gameState?.gameWon) {
    return 1.0;
  }
  return 0.0;
}

function efficiencyReward(
  parser: XMLParser,
  completion: Messages,
  answer: string,
  state: State,
  task: string,
  info: unknown,
  ...args: unknown[]
): number {
  const gameState = state.gameState as HangmanGameState | undefined;
  if (!gameState || !gameState.gameWon) {
    return 0.0;
  }

  // Reward based on fewer wrong guesses
  // Maximum reward (1.0) for 0 wrong guesses
  // Decreasing reward as wrong guesses increase
  const maxWrongGuesses = DEFAULT_WRONG_GUESSES;
  const efficiency = 1.0 - gameState.wrongGuesses / maxWrongGuesses;
  return Math.max(0.0, efficiency);
}

// ============================================================================
// Load Environment Function
// ============================================================================

const SYSTEM_PROMPT = `You are playing Hangman! Guess one letter at a time to reveal the secret word.

Rules:
- Use the guess_letter tool to make your guess (e.g., guess_letter({letter: "A"}))
- You have 6 wrong guesses before losing
- Correct guesses reveal letter positions in the word
- Wrong guesses reduce your remaining attempts

You must call the guess_letter tool each turn with a single letter.`;

export type HangmanEnvironmentOptions = {
  agent?: HangmanAgentConfig;
  numTrainExamples?: number;
  numEvalExamples?: number;
  maxWrongGuesses?: number;
  maxTurns?: number;
  wordList?: string[];
  sandbox?: {
    enabled: boolean;
    config?: SandboxConfig;
  };
};

export async function createHangmanEnvironment(
  options: HangmanEnvironmentOptions = {}
): Promise<Environment> {
  // Enable sandbox by default (same as example-generate-text-agent)
  const sandboxEnabled = options.sandbox?.enabled ?? true;
  const numTrainExamples = options.numTrainExamples ?? 100;
  const numEvalExamples = options.numEvalExamples ?? 20;
  const maxWrongGuesses = options.maxWrongGuesses ?? DEFAULT_WRONG_GUESSES;
  const maxTurns = options.maxTurns ?? 20;
  const words = options.wordList || generateWordList();

  const trainData = generateDataset(numTrainExamples, words);
  const evalData = generateDataset(numEvalExamples, words);

  const parser = new XMLParser(["guess"], "guess");

  const rubric = new Rubric({
    parser,
    funcs: [
      correctnessReward,
      efficiencyReward,
      parser.getFormatRewardFunc(),
    ],
    weights: [1.0, 0.5, 0.2],
  });

  const agentConfig = prepareHangmanAgent({
    agent: options.agent,
    systemPrompt: SYSTEM_PROMPT,
  });

  const setupStateHook = createSetupStateHook();
  const isCompletedHook = createIsCompletedHook();
  const envResponseHook = createEnvResponseHook({ parser, maxWrongGuesses });

  const env = await createRLEnvironment({
    agent: agentConfig,
    dataset: trainData,
    evalDataset: evalData,
    parser,
    rewardFunction: [
      correctnessReward,
      efficiencyReward,
      parser.getFormatRewardFunc(),
    ],
    rewardWeights: [1.0, 0.5, 0.2],
    sandbox: sandboxEnabled
      ? { enabled: true, config: options.sandbox?.config }
      : { enabled: false },
    envId: "hangman",
    envArgs: {
      max_wrong_guesses: maxWrongGuesses,
      max_turns: maxTurns,
    },
    multiTurn: {
      setupState: setupStateHook,
      isCompleted: isCompletedHook,
      envResponse: envResponseHook,
      options: {
        maxTurns,
        messageType: "chat",
      },
    },
  });

  return env;
}

export const loadEnvironment = createHangmanEnvironment;

