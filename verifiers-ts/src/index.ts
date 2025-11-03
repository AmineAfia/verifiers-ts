/**
 * verifiers-ts - TypeScript implementation of the verifiers framework
 */

// Types
export * from "./types/index.js";

// Parsers
export { Parser } from "./parsers/parser.js";
export { ThinkParser } from "./parsers/think-parser.js";
export { XMLParser } from "./parsers/xml-parser.js";

// Rubrics
export { Rubric } from "./rubrics/rubric.js";
export type { RubricOptions } from "./rubrics/rubric.js";

// Environments
export { Environment } from "./envs/environment.js";
export type { EnvironmentOptions } from "./envs/environment.js";
export { MultiTurnEnv } from "./envs/multiturn-env.js";
export type { MultiTurnEnvOptions } from "./envs/multiturn-env.js";
export { SingleTurnEnv } from "./envs/singleturn-env.js";
export type { SingleTurnEnvOptions } from "./envs/singleturn-env.js";
export { ToolEnv } from "./envs/tool-env.js";
export type { ToolEnvOptions } from "./envs/tool-env.js";
export { StatefulToolEnv } from "./envs/stateful-tool-env.js";
export type { StatefulToolEnvOptions } from "./envs/stateful-tool-env.js";
export { SandboxEnv } from "./envs/sandbox-env.js";
export type { SandboxEnvOptions } from "./envs/sandbox-env.js";

// Utils
export { defineTool, createAISDKTool, createAISDKToolsMap } from "./utils/tool-utils.js";
export type { ToolDefinition, AISDKTool } from "./utils/tool-utils.js";
export { maybeAwait, Semaphore } from "./utils/async-utils.js";
export {
  saveResultsToDisk,
  getResultsPath,
} from "./utils/eval-utils.js";
export {
  getSandboxClient,
  setSandboxClient,
  PlaceholderSandboxClient,
} from "./utils/sandbox-client.js";
export type {
  SandboxConfig,
  Sandbox,
  CommandResult,
  SandboxClient,
} from "./utils/sandbox-client.js";

// Agents (AI SDK Integration)
export {
  GenerateTextAdapter,
  type GenerateTextAdapterOptions,
} from "./agents/generate-text-adapter.js";
export {
  MultiTurnGenerateTextAdapter,
  type MultiTurnGenerateTextAdapterOptions,
} from "./agents/multiturn-generate-text-adapter.js";

// Factories
export {
  createRLEnvironment,
  createMultiTurnRLEnvironment,
  createSandboxTools,
} from "./factories/create-rl-environment.js";
export {
  createToolGameEnvironment,
  type ToolGameEnvironmentConfig,
  type ToolGameLifecycle,
  type ToolGameTurnArgs,
  type ToolGameTurnResult,
} from "./factories/tool-game-environment.js";
export type {
  RLEnvironmentConfig,
  SandboxConfig as RLEnvironmentSandboxConfig,
} from "./factories/create-rl-environment.js";

// Rewards
export {
  correctnessReward,
  toolUseReward,
  formatReward,
  stepCountReward,
  combinedReward,
  similarityReward,
} from "./rewards/agent-rewards.js";

// Datasets
export {
  loadDataset,
  formatDataset,
  type LoadDatasetOptions,
} from "./datasets/loaders.js";
