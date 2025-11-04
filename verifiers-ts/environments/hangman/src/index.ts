/**
 * Hangman demo environment built on the tool game factory.
 * The environment only owns the dataset, game logic, rewards, and agent config.
 */

import type { Environment, SandboxConfig, GenerateTextAgent, RewardFunc } from "verifiers-ts";
import { createToolGameEnvironment } from "verifiers-ts";
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
import { hangmanAgent } from "./agent.js";

export type HangmanEnvironmentOptions = {
  agent?: GenerateTextAgent;
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
  const numTrainExamples = options.numTrainExamples ?? 100;
  const numEvalExamples = options.numEvalExamples ?? 20;
  const maxWrongGuesses = options.maxWrongGuesses ?? DEFAULT_WRONG_GUESSES;
  const maxTurns = options.maxTurns ?? 20;
  const words = options.wordList ?? generateWordList();

  const game = new HangmanGame({ maxWrongGuesses });
  const parser = game.parser;

  const trainData = createHangmanDataset(numTrainExamples, words);
  const evalData = createHangmanDataset(numEvalExamples, words);

  const rewardFunctions: RewardFunc[] = [
    correctnessReward,
    efficiencyReward,
    parser.getFormatRewardFunc(),
  ];

  return createToolGameEnvironment({
    envId: "hangman",
    agent: options.agent ?? hangmanAgent,
    dataset: trainData,
    evalDataset: evalData,
    parser,
    lifecycle: game,
    rewardFunction: rewardFunctions,
    rewardWeights: REWARD_WEIGHTS,
    sandbox: options.sandbox ?? { enabled: false },
    envArgs: {
      max_wrong_guesses: maxWrongGuesses,
      max_turns: maxTurns,
    },
    maxTurns,
  });
}

export const loadEnvironment = createHangmanEnvironment;

export type { HangmanGameState } from "./game.js";
