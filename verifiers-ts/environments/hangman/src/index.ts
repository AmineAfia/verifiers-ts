/**
 * Hangman demo environment built on the tool game factory.
 * The environment only owns the dataset, game logic, rewards, and agent config.
 */

import type { Environment, SandboxConfig } from "verifiers-ts";
import {
  createToolGameEnvironment,
  type RewardFunc,
} from "verifiers-ts";
import {
  DEFAULT_WRONG_GUESSES,
  HangmanGame,
  createHangmanDataset,
  generateWordList,
  type HangmanGameState,
} from "./game.js";
import {
  correctnessReward,
  efficiencyReward,
  FORMAT_REWARD_WEIGHT,
  CORRECTNESS_REWARD_WEIGHT,
  EFFICIENCY_REWARD_WEIGHT,
} from "./rewards.js";
import { prepareHangmanAgent, type HangmanAgentConfig } from "./agent.js";

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

const REWARD_WEIGHTS = [
  CORRECTNESS_REWARD_WEIGHT,
  EFFICIENCY_REWARD_WEIGHT,
  FORMAT_REWARD_WEIGHT,
];

export async function createHangmanEnvironment(
  options: HangmanEnvironmentOptions = {}
): Promise<Environment> {
  const sandboxEnabled = options.sandbox?.enabled ?? true;
  const numTrainExamples = options.numTrainExamples ?? 100;
  const numEvalExamples = options.numEvalExamples ?? 20;
  const maxWrongGuesses = options.maxWrongGuesses ?? DEFAULT_WRONG_GUESSES;
  const maxTurns = options.maxTurns ?? 20;
  const words = options.wordList ?? generateWordList();

  const game = new HangmanGame({ maxWrongGuesses });
  const parser = game.parser;

  const trainData = createHangmanDataset(numTrainExamples, words);
  const evalData = createHangmanDataset(numEvalExamples, words);

  const agentConfig = prepareHangmanAgent({
    agent: options.agent,
    systemPrompt: SYSTEM_PROMPT,
  });

  const rewardFunctions: RewardFunc[] = [
    correctnessReward,
    efficiencyReward,
    parser.getFormatRewardFunc(),
  ];

  return createToolGameEnvironment({
    envId: "hangman",
    agent: agentConfig,
    dataset: trainData,
    evalDataset: evalData,
    parser,
    lifecycle: game,
    rewardFunction: rewardFunctions,
    rewardWeights: REWARD_WEIGHTS,
    sandbox: sandboxEnabled
      ? { enabled: true, config: options.sandbox?.config }
      : { enabled: false },
    envArgs: {
      max_wrong_guesses: maxWrongGuesses,
      max_turns: maxTurns,
    },
    maxTurns,
  });
}

export const loadEnvironment = createHangmanEnvironment;

export type { HangmanGameState } from "./game.js";
