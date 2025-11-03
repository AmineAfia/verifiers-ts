export type { GenerateTextAgent } from "../agents/generate-text-adapter.js";

import type { Environment } from "../envs/environment.js";
import type { Dataset, RewardFunc, Messages, State, Info } from "../types/index.js";
import type { Parser } from "../parsers/parser.js";
import { Rubric } from "../rubrics/rubric.js";
import { Parser as DefaultParser } from "../parsers/parser.js";
import { GenerateTextAdapter, type GenerateTextAgent } from "../agents/generate-text-adapter.js";
import {
  MultiTurnGenerateTextAdapter,
  type MultiTurnGenerateTextAdapterOptions,
} from "../agents/multiturn-generate-text-adapter.js";
import type { AISDKTool } from "../utils/tool-utils.js";
import { defineTool, createAISDKTool } from "../utils/tool-utils.js";
import { z } from "zod";
import { getSandboxClient } from "../utils/sandbox-client.js";

export interface SandboxConfig {
  name?: string;
  dockerImage?: string;
  startCommand?: string;
  cpuCores?: number;
  memoryGb?: number;
  diskSizeGb?: number;
  gpuCount?: number;
  timeoutMinutes?: number;
  environmentVars?: Record<string, string>;
  teamId?: string;
  advancedConfigs?: Record<string, any>;
}

export interface MultiTurnHooks {
  envResponse: (
    messages: Messages,
    state: State
  ) => Promise<[Messages, State]>;
  setupState?: (state: State) => Promise<State>;
  isCompleted?: (messages: Messages, state: State) => Promise<boolean>;
  options?: Omit<MultiTurnGenerateTextAdapterOptions, "agent" | "dataset" | "evalDataset" | "parser" | "rubric" | "sandboxTools" | "sandboxArgsToSkip">;
}

export type DatasetExample = {
  prompt: Messages;
  answer?: string;
  example_id?: number;
  task?: string;
  info?: Info;
};

export type DatasetInput =
  | Dataset
  | DatasetExample[]
  | (() => Promise<Dataset | DatasetExample[]>);

export type SimpleRewardFunc = (
  completion: Messages,
  answer: string,
  state?: State,
  task?: string,
  info?: Info
) => number | Promise<number>;

export type RewardInput =
  | RewardFunc
  | RewardFunc[]
  | SimpleRewardFunc
  | SimpleRewardFunc[];

export interface RLEnvironmentConfig {
  agent: GenerateTextAgent;
  dataset?: DatasetInput;
  evalDataset?: DatasetInput;
  rewardFunction: RewardInput;
  rewardWeights?: number[];
  sandbox?: {
    enabled: boolean;
    config?: SandboxConfig;
  };
  parser?: Parser;
  envId?: string;
  envArgs?: Record<string, unknown>;
  multiTurn?: MultiTurnHooks;
}

export async function createRLEnvironment(
  config: RLEnvironmentConfig
): Promise<Environment> {
  const parser = config.parser || new DefaultParser();
  const { funcs: rewardFuncs, weights: rewardWeights } = normalizeRewardFunctions(
    config.rewardFunction,
    config.rewardWeights
  );
  const rubric = new Rubric({
    funcs: rewardFuncs,
    weights: rewardWeights,
    parser,
  });

  const dataset = await resolveDataset(config.dataset);
  const evalDataset = await resolveDataset(config.evalDataset);

  let sandboxTools: Record<string, AISDKTool> | undefined;
  const sandboxArgsToSkip = new Map<string, string[]>();
  let sandboxConfig: SandboxConfig | undefined;

  if (config.sandbox?.enabled) {
    const sandboxDetails = createSandboxTools(config.sandbox.config);
    sandboxTools = sandboxDetails.tools;
    sandboxDetails.argsToSkip.forEach((value, key) => {
      sandboxArgsToSkip.set(key, value);
    });
    sandboxConfig = config.sandbox.config ?? {};
  }

  if (config.multiTurn) {
    const multiTurn = config.multiTurn;

    class InternalMultiTurnAdapter extends MultiTurnGenerateTextAdapter {
      constructor() {
        super({
          ...(multiTurn.options || {}),
          agent: config.agent,
          dataset,
          evalDataset,
          parser,
          rubric,
          sandboxTools,
          sandboxArgsToSkip,
          sandboxConfig,
          envId: config.envId || undefined,
          envArgs: config.envArgs || undefined,
        } as MultiTurnGenerateTextAdapterOptions);
      }

      async setupState(state: State): Promise<State> {
        const base = await super.setupState(state);
        if (multiTurn.setupState) {
          return multiTurn.setupState(base);
        }
        return base;
      }

      async isCompleted(messages: Messages, state: State): Promise<boolean> {
        const baseCompleted = await super.isCompleted(messages, state);
        if (baseCompleted) {
          await this.cleanupSandbox(state);
          return true;
        }
        if (multiTurn.isCompleted) {
          const custom = await multiTurn.isCompleted(messages, state);
          if (custom) {
            await this.cleanupSandbox(state);
            return true;
          }
        }
        return false;
      }

      async envResponse(
        messages: Messages,
        state: State
      ): Promise<[Messages, State]> {
        return multiTurn.envResponse(messages, state);
      }

      private async cleanupSandbox(state: State): Promise<void> {
        if (sandboxConfig && state.sandbox_id) {
          try {
            const sandboxClient = await getSandboxClient();
            await sandboxClient.deleteSandbox(state.sandbox_id as string);
          } catch (error) {
            console.warn("[Sandbox] Failed to delete sandbox:", error);
          } finally {
            state.sandbox_id = undefined;
          }
        }
      }
    }

    return new InternalMultiTurnAdapter();
  }

  return new GenerateTextAdapter({
    agent: config.agent,
    dataset,
    evalDataset,
    parser,
    rubric,
    sandboxTools,
    sandboxArgsToSkip,
    sandboxConfig,
    envId: config.envId || undefined,
    envArgs: config.envArgs || undefined,
  });
}

async function resolveDataset(
  input?: DatasetInput
): Promise<Dataset | undefined> {
  if (!input) {
    return undefined;
  }

  const resolved = typeof input === "function" ? await input() : input;
  if (Array.isArray(resolved)) {
    return datasetFromExamples(resolved);
  }

  return resolved;
}

function datasetFromExamples(examples: DatasetExample[]): Dataset {
  const prompts: Messages[] = [];
  const answers: string[] = [];
  const exampleIds: number[] = [];
  const tasks: string[] = [];
  const infos: Info[] = [];

  examples.forEach((example, index) => {
    prompts.push(example.prompt);
    answers.push(example.answer ?? "");
    exampleIds.push(example.example_id ?? index);
    tasks.push(example.task ?? "default");
    infos.push(example.info ?? {});
  });

  return {
    column_names: ["prompt", "answer", "example_id", "task", "info"],
    prompt: prompts,
    answer: answers,
    example_id: exampleIds,
    task: tasks,
    info: infos,
  } as Dataset;
}

function normalizeRewardFunctions(
  rewardInput: RewardInput,
  weights?: number[]
): { funcs: RewardFunc[]; weights?: number[] } {
  const arrayInput = Array.isArray(rewardInput) ? rewardInput : [rewardInput];
  const funcs = arrayInput.map((fn) => fn as RewardFunc);
  const normalizedWeights = weights && weights.length > 0 ? weights : undefined;
  return { funcs, weights: normalizedWeights };
}

export function createSandboxTools(
  config?: SandboxConfig
): {
  tools: Record<string, AISDKTool>;
  argsToSkip: Map<string, string[]>;
} {
  const argsToSkip = new Map<string, string[]>();

  const bashToolDef = defineTool(
    "bash",
    "Execute a bash command in the sandbox environment",
    z.object({
      command: z.string().describe("The bash command to execute in the sandbox"),
    }),
    async (args: { command: string; sandbox_id?: string }) => {
      const sandboxId = args.sandbox_id;
      if (!sandboxId) {
        throw new Error(
          "sandbox_id is required but was not provided. Ensure sandbox lifecycle is configured."
        );
      }

      const sandboxClient = await getSandboxClient();
      const result = await sandboxClient.executeCommand(sandboxId, args.command);

      let output = result.stdout;
      if (result.stderr) {
        output = output ? `${output}\nstderr:\n${result.stderr}` : `stderr:\n${result.stderr}`;
      }

      return output || "(no output)";
    }
  );

  argsToSkip.set("bash", ["sandbox_id"]);

  const bashTool = createAISDKTool(bashToolDef);

  return {
    tools: {
      bash: bashTool,
    },
    argsToSkip,
  };
}
