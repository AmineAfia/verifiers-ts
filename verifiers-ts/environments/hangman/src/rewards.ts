import type { Messages, State } from "verifiers-ts";
import { DEFAULT_WRONG_GUESSES, type HangmanGameState } from "./game.js";

export const CORRECTNESS_REWARD_WEIGHT = 1.0;
export const EFFICIENCY_REWARD_WEIGHT = 0.5;
export const FORMAT_REWARD_WEIGHT = 0.2;

type RewardContext = {
  completion: Messages;
  answer: string;
  state: State;
};

export function correctnessReward({ state }: RewardContext): number {
  const gameState = state.gameState as HangmanGameState | undefined;
  return gameState?.gameWon ? 1.0 : 0.0;
}

export function efficiencyReward({ state }: RewardContext): number {
  const gameState = state.gameState as HangmanGameState | undefined;
  if (!gameState || !gameState.gameWon) {
    return 0.0;
  }

  const maxWrongGuesses =
    (state.maxWrongGuesses as number | undefined) ?? DEFAULT_WRONG_GUESSES;

  const efficiency = 1.0 - gameState.wrongGuesses / maxWrongGuesses;
  return Math.max(0.0, efficiency);
}
