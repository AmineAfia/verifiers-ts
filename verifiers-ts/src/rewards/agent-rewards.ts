/**
 * Helper functions for common reward patterns
 * Makes it easy to create reward functions for RL environments
 */

import type { RewardFunc, Messages, State, Info } from "../types/index.js";
import { Parser } from "../parsers/parser.js";

/**
 * Create a reward function that checks correctness against an expected answer
 *
 * @example
 * ```typescript
 * const rewardFunc = correctnessReward("42");
 * ```
 */
export function correctnessReward(expectedAnswer: string): RewardFunc {
  return async (completion: Messages, answer: string, ...args: any[]) => {
    const parser = args.find((arg) => arg instanceof Parser) || new Parser();
    const parsed = parser.parseAnswer(completion);
    return parsed === expectedAnswer ? 1.0 : 0.0;
  };
}

/**
 * Create a reward function that rewards tool usage
 * Checks if specific tools were called during the interaction
 *
 * @example
 * ```typescript
 * const rewardFunc = toolUseReward(["weather", "calculator"]);
 * ```
 */
export function toolUseReward(expectedTools: string[]): RewardFunc {
  return async (completion: Messages, answer: string, state: State, ...args: any[]) => {
    const toolCalls = state.toolCalls || [];
    const calledTools = new Set(
      (toolCalls as Array<{ toolName?: string; function?: { name?: string } }>)
        .map((tc) => tc.toolName || tc.function?.name)
        .filter((name): name is string => !!name)
    );

    // Reward based on how many expected tools were called
    const matches = expectedTools.filter((tool) => calledTools.has(tool));
    return matches.length / expectedTools.length;
  };
}

/**
 * Create a reward function that validates format
 * Uses a validator function to check if the completion matches expected format
 *
 * @example
 * ```typescript
 * const rewardFunc = formatReward((text) => text.includes("<answer>") && text.includes("</answer>"));
 * ```
 */
export function formatReward(
  validator: (text: string) => boolean
): RewardFunc {
  return async (completion: Messages, answer: string, ...args: any[]) => {
    const parser = args.find((arg) => arg instanceof Parser) || new Parser();
    const parsed = parser.parseAnswer(completion);
    if (!parsed) return 0.0;
    return validator(parsed) ? 1.0 : 0.0;
  };
}

/**
 * Create a reward function that rewards fewer steps
 * Gives higher reward for completing the task in fewer steps
 *
 * @example
 * ```typescript
 * const rewardFunc = stepCountReward(5); // Rewards completing in <= 5 steps
 * ```
 */
export function stepCountReward(maxSteps: number): RewardFunc {
  return async (completion: Messages, answer: string, state: State, ...args: any[]) => {
    const steps = state.responses?.length || 0;
    if (steps === 0) return 0.0;
    // Reward inversely proportional to step count, up to maxSteps
    return Math.max(0, 1.0 - (steps - 1) / maxSteps);
  };
}

/**
 * Create a reward function that combines multiple reward functions
 * Useful for creating composite rewards with different weights
 *
 * @example
 * ```typescript
 * const rewardFunc = combinedReward([
 *   { func: correctnessReward("42"), weight: 0.8 },
 *   { func: stepCountReward(5), weight: 0.2 },
 * ]);
 * ```
 */
export function combinedReward(
  rewards: Array<{ func: RewardFunc; weight: number }>
): RewardFunc {
  return async (...args: any[]) => {
    const scores = await Promise.all(
      rewards.map(({ func, weight }) =>
        (async () => {
          const score = await func(...args);
          return score * weight;
        })()
      )
    );
    return scores.reduce((sum, score) => sum + score, 0);
  };
}

/**
 * Create a reward function based on similarity score
 * Uses a similarity function to compare completion with expected answer
 *
 * @example
 * ```typescript
 * const rewardFunc = similarityReward((a, b) => {
 *   // Custom similarity calculation
 *   return levenshteinDistance(a, b) < 3 ? 1.0 : 0.0;
 * });
 * ```
 */
export function similarityReward(
  similarityFn: (completion: string, expected: string) => number
): RewardFunc {
  return async (completion: Messages, answer: string, ...args: any[]) => {
    const parser = args.find((arg) => arg instanceof Parser) || new Parser();
    const parsed = parser.parseAnswer(completion);
    if (!parsed) return 0.0;
    return similarityFn(parsed, answer);
  };
}



