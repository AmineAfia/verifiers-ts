/**
 * SingleTurnEnv for single-turn Q&A tasks
 */

import type { Messages, State } from "../types/index.js";
import { MultiTurnEnv, MultiTurnEnvOptions } from "./multiturn-env.js";

export interface SingleTurnEnvOptions extends MultiTurnEnvOptions {}

export class SingleTurnEnv extends MultiTurnEnv {
  constructor(options: SingleTurnEnvOptions = {}) {
    super(options);
  }

  async isCompleted(messages: Messages, state: State): Promise<boolean> {
    const responses = state.responses as unknown[] | undefined;
    return (responses?.length || 0) > 0;
  }

  async envResponse(messages: Messages, state: State): Promise<[Messages, State]> {
    // Never called in MultiTurnEnv.rollout for single-turn tasks
    // but must be implemented due to abstract requirement
    return [[{ role: "user", content: "" }], state];
  }
}

