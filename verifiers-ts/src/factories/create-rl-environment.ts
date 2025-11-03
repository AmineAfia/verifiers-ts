/**
 * Factory function for creating RL environments from generateText configurations
 * Enables easy conversion of AI SDK agents into verifiers RL environments
 */

import { generateText } from "ai";
type GenerateTextParams = Parameters<typeof generateText>[0];
import type { Environment } from "../envs/environment.js";
import type { Dataset, RewardFunc, Messages, State } from "../types/index.js";
import type { Parser } from "../parsers/parser.js";
import {
  GenerateTextAdapter,
  type GenerateTextAdapterOptions,
} from "../agents/generate-text-adapter.js";
import {
  MultiTurnGenerateTextAdapter,
  type MultiTurnGenerateTextAdapterOptions,
} from "../agents/multiturn-generate-text-adapter.js";
import { Rubric } from "../rubrics/rubric.js";
import { Parser as DefaultParser } from "../parsers/parser.js";
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
  options?: Omit<MultiTurnGenerateTextAdapterOptions, "agent" | "argsToSkip" | "sandboxConfig">;
}

export interface RLEnvironmentConfig {
  /**
   * GenerateText configuration object
   * Pass generateText options (without messages/prompt) here
   * Example: { model: openai('gpt-4o'), system: '...', tools: {...}, stopWhen: stepCountIs(10) }
   * 
   * Note: Uses 'any' to handle AI SDK type compatibility between LanguageModelV1 and LanguageModel
   */
  agent: any; // eslint-disable-line @typescript-eslint/no-explicit-any

  /**
   * Dataset for evaluation/training
   * Can be a Dataset object or a function that returns a Promise<Dataset>
   */
  dataset?: Dataset | (() => Promise<Dataset>);

  /**
   * Evaluation dataset (optional, falls back to dataset if not provided)
   */
  evalDataset?: Dataset | (() => Promise<Dataset>);

  /**
   * Reward function(s) for evaluation
   * Can be a single function or array of functions
   */
  rewardFunction: RewardFunc | RewardFunc[];

  /**
   * Weights for reward functions (if multiple)
   * Defaults to 1.0 for each function
   */
  rewardWeights?: number[];

  /**
   * Sandbox configuration (optional)
   */
  sandbox?: {
    enabled: boolean;
    config?: SandboxConfig;
  };

  /**
   * Parser for extracting structured information from completions
   * Defaults to Parser() if not provided
   */
  parser?: Parser;

  /**
   * Environment ID (optional, used for results path)
   */
  envId?: string;

  /**
   * Additional environment arguments (optional)
   */
  envArgs?: Record<string, any>;

  /**
   * Optional multi-turn hooks for environments that need custom envResponse logic
   */
  multiTurn?: MultiTurnHooks;
}

/**
 * Create an RL environment from a generateText configuration
 *
 * @example
 * ```typescript
 * const env = createRLEnvironment({
 *   agent: {
 *     model: openai('gpt-4o'),
 *     system: 'You are a helpful assistant.',
 *     tools: { weather: weatherTool },
 *     stopWhen: stepCountIs(10),
 *   },
 *   dataset: myDataset,
 *   rewardFunction: (result) => checkCorrectness(result.text, result.expectedAnswer),
 * });
 * ```
 */
export async function createRLEnvironment(
  config: RLEnvironmentConfig
): Promise<Environment> {
  // Extract generateText configuration from agent
  const generateTextConfig = config.agent;

  // Merge sandbox tools into agent's tools if enabled
  let tools = generateTextConfig.tools || {};
  const argsToSkip = new Map<string, string[]>();
  let sandboxConfig: SandboxConfig | undefined;
  
  if (config.sandbox?.enabled) {
    console.warn("[Sandbox] createRLEnvironment: sandbox enabled!");
    const { tools: sandboxTools, argsToSkip: sandboxArgsToSkip } = createSandboxTools(
      config.sandbox.config
    );
    tools = { ...tools, ...sandboxTools };
    // Merge argsToSkip from sandbox tools
    for (const [toolName, skippedArgs] of sandboxArgsToSkip.entries()) {
      argsToSkip.set(toolName, skippedArgs);
    }
    // Use config.sandbox.config if provided, otherwise use empty object (will use defaults in adapter)
    sandboxConfig = config.sandbox.config ?? {};
    console.warn("[Sandbox] createRLEnvironment: sandboxConfig set to:", JSON.stringify(sandboxConfig));
  } else {
    console.warn("[Sandbox] createRLEnvironment: sandbox NOT enabled, config.sandbox:", JSON.stringify(config.sandbox));
  }

  // Set up rubric first
  const rewardFuncs = Array.isArray(config.rewardFunction)
    ? config.rewardFunction
    : [config.rewardFunction];

  const parser = config.parser || new DefaultParser();
  const rubric = new Rubric({
    funcs: rewardFuncs,
    weights: config.rewardWeights,
    parser,
  });

  // Load dataset(s) if provided (before creating adapter)
  let dataset: Dataset | undefined;
  if (config.dataset) {
    dataset =
      typeof config.dataset === "function"
        ? await config.dataset()
        : config.dataset;
  }

  let evalDataset: Dataset | undefined;
  if (config.evalDataset) {
    evalDataset =
      typeof config.evalDataset === "function"
        ? await config.evalDataset()
        : config.evalDataset;
  }

  const baseAdapterOptions: GenerateTextAdapterOptions = {
    agent: {
      ...generateTextConfig,
      tools,
    },
    argsToSkip,
    sandboxConfig,
    parser,
    rubric,
    dataset,
    evalDataset,
    envId: config.envId,
    envArgs: config.envArgs,
  };

  if (config.multiTurn) {
    const { setupState, isCompleted, envResponse, options: hookOptions } = config.multiTurn;

    class InternalMultiTurnAdapter extends MultiTurnGenerateTextAdapter {
      async setupState(state: State): Promise<State> {
        const baseState = await super.setupState(state);
        if (setupState) {
          return setupState(baseState);
        }
        return baseState;
      }

      async isCompleted(messages: Messages, state: State): Promise<boolean> {
        const baseCompleted = await super.isCompleted(messages, state);
        if (baseCompleted) {
          return true;
        }
        if (isCompleted) {
          const customCompleted = await isCompleted(messages, state);
          if (customCompleted) {
            if (this.sandboxConfig && state.sandbox_id) {
              const sandboxId = state.sandbox_id as string;
              try {
                console.warn(`[Sandbox] Cleaning up sandbox ${sandboxId} (custom completion)`);
                const sandboxClient = await getSandboxClient();
                await sandboxClient.deleteSandbox(sandboxId);
                console.warn(`[Sandbox] Deleted sandbox ${sandboxId}`);
                state.sandbox_id = undefined;
              } catch (error) {
                console.warn(`[Sandbox] Failed to delete sandbox ${sandboxId}:`, error);
              }
            }
            return true;
          }
        }
        return false;
      }

      async envResponse(
        messages: Messages,
        state: State
      ): Promise<[Messages, State]> {
        return envResponse(messages, state);
      }
    }

    const adapterOptions: MultiTurnGenerateTextAdapterOptions = {
      ...(hookOptions ?? {}),
      ...baseAdapterOptions,
    } as MultiTurnGenerateTextAdapterOptions;

    return new InternalMultiTurnAdapter(adapterOptions);
  }

  return new GenerateTextAdapter(baseAdapterOptions);
}

/**
 * Create sandbox tools for Prime Intellect sandbox integration
 * Returns tools with sandbox_id hidden from model schema (via argsToSkip)
 * and the argsToSkip map to pass to adapter
 */
export function createSandboxTools(
  config?: SandboxConfig
): {
  tools: Record<string, any>;
  argsToSkip: Map<string, string[]>;
} {
  const argsToSkip = new Map<string, string[]>();
  
  // Create bash tool for sandbox command execution
  // sandbox_id is hidden from model (will be injected from state)
  const bashToolDef = defineTool(
    "bash",
    "Execute a bash command in the sandbox environment",
    z.object({
      command: z.string().describe("The bash command to execute in the sandbox"),
      // Note: sandbox_id is NOT in the schema - it will be injected from state
    }),
    async (args: { command: string; sandbox_id?: string }) => {
      // This will be called with sandbox_id injected via updateToolArgs
      const sandboxId = args.sandbox_id;
      if (!sandboxId) {
        throw new Error(
          "sandbox_id is required but was not injected. " +
          "This should not happen if sandbox lifecycle is properly set up."
        );
      }
      
      // Execute command via sandbox client
      const sandboxClient = await getSandboxClient();
      const result = await sandboxClient.executeCommand(sandboxId, args.command);
      
      // Combine stdout and stderr for return
      let output = result.stdout;
      if (result.stderr) {
        if (output) {
          output = `${output}\nstderr:\n${result.stderr}`;
        } else {
          output = `stderr:\n${result.stderr}`;
        }
      }
      
      return output || "(no output)";
    }
  );
  
  // Mark sandbox_id as an arg to skip (hidden from model)
  argsToSkip.set("bash", ["sandbox_id"]);
  
  // Create tool with schema that doesn't include sandbox_id
  const bashTool = createAISDKTool(bashToolDef);
  
  return {
    tools: {
      bash: bashTool,
    },
    argsToSkip,
  };
}

/**
 * Create a multi-turn RL environment from a generateText configuration
 * Similar to createRLEnvironment but uses MultiTurnGenerateTextAdapter for multi-turn interactions
 *
 * @example
 * ```typescript
 * const env = createMultiTurnRLEnvironment({
 *   agent: {
 *     model: openai('gpt-4o'),
 *     system: 'You are playing a game.',
 *     tools: { move: moveTool },
 *     stopWhen: stepCountIs(10),
 *   },
 *   dataset: myDataset,
 *   rewardFunction: (result) => checkGameResult(result),
 * });
 * ```
 */
export async function createMultiTurnRLEnvironment(
  config: RLEnvironmentConfig
): Promise<Environment> {
  // Extract generateText configuration from agent
  const generateTextConfig = config.agent;

  // Merge sandbox tools into agent's tools if enabled
  let tools = generateTextConfig.tools || {};
  const argsToSkip = new Map<string, string[]>();
  let sandboxConfig: SandboxConfig | undefined;
  
  if (config.sandbox?.enabled) {
    console.warn("[Sandbox] createMultiTurnRLEnvironment: sandbox enabled!");
    const { tools: sandboxTools, argsToSkip: sandboxArgsToSkip } = createSandboxTools(
      config.sandbox.config
    );
    tools = { ...tools, ...sandboxTools };
    // Merge argsToSkip from sandbox tools
    for (const [toolName, skippedArgs] of sandboxArgsToSkip.entries()) {
      argsToSkip.set(toolName, skippedArgs);
    }
    // Use config.sandbox.config if provided, otherwise use empty object (will use defaults in adapter)
    sandboxConfig = config.sandbox.config ?? {};
    console.warn("[Sandbox] createMultiTurnRLEnvironment: sandboxConfig set to:", JSON.stringify(sandboxConfig));
  } else {
    console.warn("[Sandbox] createMultiTurnRLEnvironment: sandbox NOT enabled, config.sandbox:", JSON.stringify(config.sandbox));
  }

  // Set up rubric first
  const rewardFuncs = Array.isArray(config.rewardFunction)
    ? config.rewardFunction
    : [config.rewardFunction];

  const parser = config.parser || new DefaultParser();
  const rubric = new Rubric({
    funcs: rewardFuncs,
    weights: config.rewardWeights,
    parser,
  });

  // Load dataset(s) if provided (before creating adapter)
  let dataset: Dataset | undefined;
  if (config.dataset) {
    dataset =
      typeof config.dataset === "function"
        ? await config.dataset()
        : config.dataset;
  }

  let evalDataset: Dataset | undefined;
  if (config.evalDataset) {
    evalDataset =
      typeof config.evalDataset === "function"
        ? await config.evalDataset()
        : config.evalDataset;
  }

  // Create adapter with generateText configuration
  // Use an internal concrete class that extends MultiTurnGenerateTextAdapter
  // This allows the factory to work without requiring users to create their own subclass
  class InternalMultiTurnAdapter extends MultiTurnGenerateTextAdapter {
    async envResponse(
      messages: Messages,
      state: State
    ): Promise<[Messages, State]> {
      // Default implementation: return empty response
      // Users should create their own class extending MultiTurnGenerateTextAdapter
      // and implement envResponse for custom behavior
      return [[], state];
    }
  }

  const adapter = new InternalMultiTurnAdapter({
    agent: {
      ...generateTextConfig,
      tools, // Include merged tools
    },
    argsToSkip, // Pass argsToSkip for stateful tool support
    sandboxConfig, // Pass sandbox config for lifecycle management
    parser,
    rubric, // Pass rubric in constructor
    dataset, // Pass dataset in constructor
    evalDataset, // Pass evalDataset in constructor
    envId: config.envId,
    envArgs: config.envArgs,
  });

  return adapter;
}

