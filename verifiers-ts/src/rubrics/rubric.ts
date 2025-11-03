import { Parser } from "../parsers/parser.js";
import {
  type Info,
  type Messages,
  type RewardFunc,
  type RolloutScore,
  type RolloutScores,
  type State,
} from "../types/index.js";
import { maybeAwait, Semaphore } from "../utils/async-utils.js";

export interface RubricOptions {
  funcs?: RewardFunc[];
  weights?: number[];
  parser?: Parser;
  parallelizeScoring?: boolean;
}

export class Rubric {
  private rewardFuncs: RewardFunc[];
  private rewardWeights: number[];
  private parser: Parser;
  private parallelizeScoring: boolean;

  constructor(options: RubricOptions = {}) {
    this.rewardFuncs = options.funcs || [];
    this.rewardWeights = options.weights || [];
    this.parser = options.parser || new Parser();
    this.parallelizeScoring = options.parallelizeScoring ?? true;

    if (this.rewardWeights.length === 0) {
      this.rewardWeights = new Array(this.rewardFuncs.length).fill(1.0);
    } else if (this.rewardWeights.length < this.rewardFuncs.length) {
      const padding = new Array(
        this.rewardFuncs.length - this.rewardWeights.length
      ).fill(1.0);
      this.rewardWeights = [...this.rewardWeights, ...padding];
    }
  }

  getRewardFuncNames(): string[] {
    return this.rewardFuncs.map((func) => func.name || "anonymous_reward");
  }

  getRewardFuncs(): RewardFunc[] {
    return this.rewardFuncs;
  }

  getRewardWeights(): number[] {
    return this.rewardWeights;
  }

  addRewardFunc(func: RewardFunc, weight: number = 1.0): void {
    this.rewardFuncs.push(func);
    this.rewardWeights.push(weight);
  }

  private async callRewardFunc(
    func: RewardFunc,
    prompt: Messages,
    completion: Messages,
    answer: string,
    state: State,
    task: string,
    info: Info,
    exampleId: number | null
  ): Promise<number> {
    const context = {
      prompt,
      completion,
      answer,
      state,
      task,
      info,
      example_id: exampleId,
      parser: this.parser,
    } as const;

    const attempts: Array<() => Promise<any>> = [
      () => maybeAwait(func(context as unknown as Record<string, unknown>)),
    ];

    const positionalArgs = this.buildPositionalArgs(
      func.length,
      completion,
      answer,
      state,
      task,
      info,
      exampleId
    );

    attempts.push(() => maybeAwait(func(...positionalArgs)));

    // Additional fallback with parser-first ordering for multi-argument functions
    if (func.length >= 4) {
      attempts.push(() =>
        maybeAwait(
          func(
            this.parser,
            completion,
            answer,
            state,
            task,
            info,
            exampleId
          )
        )
      );
    }

    for (const attempt of attempts) {
      try {
        const result = await attempt();
        const numeric = Number(result);
        if (!Number.isNaN(numeric)) {
          return numeric;
        }
      } catch (_error) {
        // Ignore and try next strategy
      }
    }

    return 0.0;
  }

  private buildPositionalArgs(
    argCount: number,
    completion: Messages,
    answer: string,
    state: State,
    task: string,
    info: Info,
    exampleId: number | null
  ): any[] {
    if (argCount <= 0) {
      return [];
    }
    if (argCount === 1) {
      return [completion];
    }
    if (argCount === 2) {
      return [completion, answer];
    }
    if (argCount === 3) {
      return [completion, answer, state];
    }
    if (argCount === 4) {
      return [completion, answer, state, task];
    }
    if (argCount === 5) {
      return [completion, answer, state, task, info];
    }
    if (argCount === 6) {
      return [
        this.parser,
        completion,
        answer,
        state,
        task,
        info,
      ];
    }
    return [
      this.parser,
      completion,
      answer,
      state,
      task,
      info,
      exampleId,
    ];
  }

  private ensureTiming(state: State): void {
    if (!state.timing) {
      state.timing = {
        generation_ms: 0,
        scoring_ms: 0,
        total_ms: 0,
      };
    } else {
      state.timing.generation_ms = state.timing.generation_ms ?? 0;
      state.timing.scoring_ms = state.timing.scoring_ms ?? 0;
      state.timing.total_ms = state.timing.total_ms ?? 0;
    }
  }

  async scoreRollout(
    prompt: Messages,
    completion: Messages,
    answer: string,
    state: State,
    task: string,
    info: Info,
    exampleId: number | null = null
  ): Promise<RolloutScore> {
    this.ensureTiming(state);
    const start = Date.now();

    const infoValue = info || {};
    const scores: number[] = [];

    if (this.parallelizeScoring) {
      const promises = this.rewardFuncs.map((func) =>
        this.callRewardFunc(
          func,
          prompt,
          completion,
          answer,
          state,
          task,
          infoValue,
          exampleId
        )
      );
      scores.push(...(await Promise.all(promises)));
    } else {
      for (const func of this.rewardFuncs) {
        const score = await this.callRewardFunc(
          func,
          prompt,
          completion,
          answer,
          state,
          task,
          infoValue,
          exampleId
        );
        scores.push(score);
      }
    }

    const metrics: Record<string, number> = {};
    this.rewardFuncs.forEach((func, idx) => {
      const name = func.name || `reward_${idx}`;
      metrics[name] = scores[idx] ?? 0;
    });

    const weightedReward = scores.reduce((acc, score, idx) => {
      const weight = this.rewardWeights[idx] ?? 1;
      return acc + score * weight;
    }, 0);

    const elapsed = Date.now() - start;
    state.timing.scoring_ms = elapsed;
    state.timing.total_ms = (state.timing.total_ms || 0) + elapsed;

    return {
      reward: weightedReward,
      metrics,
    };
  }

  async scoreRollouts(
    prompts: Messages[],
    completions: Messages[],
    answers: string[],
    states: State[],
    tasks: string[],
    infos: Info[],
    exampleIds: number[] | undefined,
    maxConcurrent: number = -1
  ): Promise<RolloutScores> {
    const count = completions.length;
    const resolvedExampleIds = exampleIds ?? Array.from({ length: count }, (_, i) => i);

    if (
      !(
        prompts.length === count &&
        answers.length === count &&
        states.length === count &&
        tasks.length === count &&
        infos.length === count &&
        resolvedExampleIds.length === count
      )
    ) {
      throw new Error("Rubric.scoreRollouts: input arrays must have equal length");
    }

    const rewards: number[] = new Array(count).fill(0);
    const metrics: Record<string, number[]> = {};
    this.getRewardFuncNames().forEach((name) => {
      metrics[name] = new Array(count).fill(0);
    });

    const run = async (idx: number): Promise<void> => {
      const result = await this.scoreRollout(
        prompts[idx],
        completions[idx],
        answers[idx],
        states[idx],
        tasks[idx],
        infos[idx] || {},
        resolvedExampleIds[idx]
      );
      rewards[idx] = result.reward;
      for (const [name, value] of Object.entries(result.metrics)) {
        if (!metrics[name]) {
          metrics[name] = new Array(count).fill(0);
        }
        metrics[name][idx] = value;
      }
    };

    if (maxConcurrent > 0) {
      const semaphore = new Semaphore(maxConcurrent);
      await Promise.all(
        completions.map((_, idx) => semaphore.withLock(() => run(idx)))
      );
    } else {
      for (let i = 0; i < count; i++) {
        await run(i);
      }
    }

    return {
      reward: rewards,
      metrics,
    };
  }
}

