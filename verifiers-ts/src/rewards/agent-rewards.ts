/**
 * Helper functions for common reward patterns
 * Makes it easy to create reward functions for RL environments
 */

import type { RewardFunc, Messages, State, Info } from "../types/index.js";
import { Parser } from "../parsers/parser.js";
import { getStructuredOutputFromState } from "../utils/structured-output.js";

type RewardInvokePayload = {
  prompt: Messages;
  completion: Messages;
  answer: string;
  state: State;
  task: string;
  info: Info;
  example_id: number | null;
  parser: Parser;
};

export interface StructuredOutputRewardContext<T = unknown> {
  prompt: Messages;
  completion: Messages;
  answer: string;
  state: State;
  task: string;
  info: Info;
  exampleId: number | null;
  parser: Parser;
  structuredOutput: T | null;
}

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

export function structuredOutputReward<T>(
  evaluate: (
    context: StructuredOutputRewardContext<T>
  ) => number | Promise<number>,
  options: { defaultScore?: number } = {}
): RewardFunc {
  const defaultScore = options.defaultScore ?? 0;
  return async (rawContext: unknown, ...positional: unknown[]): Promise<number> => {
    const context = extractInvocationContext(rawContext, positional);
    if (!context) {
      return defaultScore;
    }

    const structuredOutput = getStructuredOutputFromState<T>(context.state);
    const evaluationContext: StructuredOutputRewardContext<T> = {
      prompt: context.prompt,
      completion: context.completion,
      answer: context.answer,
      state: context.state,
      task: context.task,
      info: context.info,
      exampleId: context.example_id ?? null,
      parser: context.parser,
      structuredOutput,
    };

    try {
      const score = await evaluate(evaluationContext);
      const numeric = Number(score);
      return Number.isNaN(numeric) ? defaultScore : numeric;
    } catch {
      return defaultScore;
    }
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

function extractInvocationContext(
  rawContext: unknown,
  positional: unknown[]
): RewardInvokePayload | null {
  if (isRewardInvokePayload(rawContext)) {
    return rawContext;
  }

  const args = [rawContext, ...positional];
  if (args.length < 3) {
    return null;
  }

  const completion = args[0] as Messages;
  const answer = typeof args[1] === "string" ? (args[1] as string) : "";
  const stateCandidate = args[2];
  const state =
    stateCandidate && typeof stateCandidate === "object"
      ? (stateCandidate as State)
      : ({} as State);
  const task = typeof args[3] === "string" ? (args[3] as string) : "default";
  const info =
    args.length > 4 && args[4] && typeof args[4] === "object"
      ? (args[4] as Info)
      : ({} as Info);
  const exampleRaw = args.length > 5 ? args[5] : null;
  const example_id =
    typeof exampleRaw === "number"
      ? exampleRaw
      : exampleRaw === null || exampleRaw === undefined
      ? null
      : Number.isFinite(Number(exampleRaw))
      ? Number(exampleRaw)
      : null;
  const parserCandidate =
    state && typeof (state as Record<string, unknown>).parser === "object"
      ? (state as Record<string, unknown>).parser
      : null;

  return {
    prompt: [] as Messages,
    completion,
    answer,
    state,
    task,
    info,
    example_id,
    parser: parserCandidate instanceof Parser ? parserCandidate : new Parser(),
  };
}

function isRewardInvokePayload(value: unknown): value is RewardInvokePayload {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    "completion" in candidate &&
    "answer" in candidate &&
    "state" in candidate &&
    "task" in candidate &&
    "info" in candidate &&
    "parser" in candidate
  );
}
