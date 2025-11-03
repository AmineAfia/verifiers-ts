/**
 * Helper factory for tool-driven multi-turn game environments.
 * Wraps the generic createRLEnvironment API so environments only implement
 * their game lifecycle (state setup, per-turn handling, termination).
 */

import { Parser } from "../parsers/parser.js";
import type { Dataset, Messages, RewardFunc, State } from "../types/index.js";
import type { Environment } from "../envs/environment.js";
import {
  createRLEnvironment,
  type RLEnvironmentConfig,
  type SandboxConfig,
} from "./create-rl-environment.js";

export interface ToolGameTurnArgs {
  messages: Messages;
  state: State;
  parser: Parser;
}

export type ToolGameTurnResult =
  | Messages
  | {
      /**
       * Messages (usually user role) to append for the next model turn.
       */
      messages?: Messages;
      /**
       * Convenience shortcut for returning a single text response.
       * Will be wrapped in a user message array.
       */
      reply?: string;
      /**
       * Updated state to persist. If omitted, the incoming state is reused.
       */
      state?: State;
    };

export interface ToolGameLifecycle {
  /**
   * Set up environment state before the first turn (e.g., seed game state).
   */
  setupState?: (state: State, parser: Parser) => Promise<State> | State;
  /**
   * Handle a single turn. Must return the messages to send back to the agent.
   */
  onTurn: (args: ToolGameTurnArgs) => Promise<ToolGameTurnResult> | ToolGameTurnResult;
  /**
   * Optional custom completion check (in addition to adapter defaults).
   */
  isCompleted?: (
    messages: Messages,
    state: State,
    parser: Parser
  ) => Promise<boolean> | boolean;
}

export interface ToolGameEnvironmentConfig {
  envId: string;
  agent: RLEnvironmentConfig["agent"];
  lifecycle: ToolGameLifecycle;
  dataset?: RLEnvironmentConfig["dataset"];
  evalDataset?: RLEnvironmentConfig["evalDataset"];
  rewardFunction: RewardFunc | RewardFunc[];
  rewardWeights?: number[];
  parser?: Parser;
  sandbox?: { enabled: boolean; config?: SandboxConfig };
  envArgs?: Record<string, unknown>;
  maxTurns?: number;
  multiTurnOptions?: NonNullable<RLEnvironmentConfig["multiTurn"]>["options"];
}

function normalizeTurnResult(
  result: ToolGameTurnResult,
  fallbackState: State
): [Messages, State] {
  if (typeof result === "string" || Array.isArray(result)) {
    return [result, fallbackState];
  }

  const messages =
    result.messages !== undefined
      ? result.messages
      : result.reply !== undefined
      ? [
          {
            role: "user",
            content: result.reply,
          },
        ]
      : [];

  const state = result.state ?? fallbackState;
  return [messages, state];
}

/**
 * Create a tool-driven multi-turn environment that delegates turn handling to
 * a simple lifecycle object.
 */
export async function createToolGameEnvironment(
  config: ToolGameEnvironmentConfig
): Promise<Environment> {
  const parser = config.parser ?? new Parser();
  const lifecycle = config.lifecycle;

  return createRLEnvironment({
    agent: config.agent,
    dataset: config.dataset,
    evalDataset: config.evalDataset,
    parser,
    rewardFunction: config.rewardFunction,
    rewardWeights: config.rewardWeights,
    sandbox: config.sandbox,
    envId: config.envId,
    envArgs: config.envArgs,
    multiTurn: {
      setupState: lifecycle.setupState
        ? async (state) => lifecycle.setupState!(state, parser)
        : undefined,
      isCompleted: lifecycle.isCompleted
        ? async (messages, state) =>
            lifecycle.isCompleted!(messages, state, parser)
        : undefined,
      envResponse: async (messages, state) => {
        const result = await lifecycle.onTurn({ messages, state, parser });
        return normalizeTurnResult(result, state);
      },
      options: {
        maxTurns: config.maxTurns,
        messageType: "chat",
        ...(config.multiTurnOptions ?? {}),
      },
    },
  });
}
