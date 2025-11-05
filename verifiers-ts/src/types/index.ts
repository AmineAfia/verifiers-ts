/**
 * Core type definitions for verifiers-ts
 * Mirrors the Python verifiers types for compatibility
 */

export type ChatMessage =
  | {
      role: "system" | "user" | "assistant" | "tool";
      content: string | null;
      tool_calls?: ToolCall[];
      tool_call_id?: string;
      name?: string;
    }
  | {
      role: "assistant";
      content: string | null;
      tool_calls?: ToolCall[];
    };

export type MessageType = "chat" | "completion";

export type Message = string | ChatMessage;

export type Messages = string | ChatMessage[];

export type Info = Record<string, any>;

export type State = Record<string, any>;

export type SamplingArgs = Record<string, any>;

export interface ModelResponse {
  id: string;
  choices: Array<{
    message?: {
      role: string;
      content: string | null;
      tool_calls?: unknown[];
    };
    text?: string;
  }>;
  toolCalls?: unknown[];
  toolResults?: unknown[];
}

export type RewardFunc = (
  ...args: any[]
) => number | Promise<number>;

export type ToolCall = {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string | Record<string, unknown>;
  };
};

export interface GenerateInputs {
  prompt: Messages[];
  completion?: Messages[];
  answer?: string[];
  task?: string[];
  info?: Info[];
  example_id?: number[];
}

export interface GenerateMetadata {
  env_id: string;
  env_args: Record<string, any>;
  model: string;
  base_url: string;
  num_examples: number;
  rollouts_per_example: number;
  sampling_args: SamplingArgs;
  date: string;
  time_ms: number;
  avg_reward: number;
  avg_metrics: Record<string, number>;
  state_columns: string[];
  path_to_save: string;
}

export interface GenerateOutputs {
  prompt: Messages[];
  completion: Messages[];
  answer: string[];
  state: State[];
  task: string[];
  info: Info[];
  example_id: number[];
  reward: number[];
  metrics: Record<string, number[]>;
  metadata: GenerateMetadata;
}

export interface RolloutScore {
  reward: number;
  metrics: Record<string, number>;
}

export interface RolloutScores {
  reward: number[];
  metrics: Record<string, number[]>;
}

export interface ClientConfig {
  api_key_var?: string;
  api_base_url?: string;
  timeout?: number;
  max_connections?: number;
  max_keepalive_connections?: number;
  max_retries?: number;
  extra_headers?: Record<string, string>;
}

export interface EvalConfig {
  env_id: string;
  env_args: Record<string, any>;
  env_dir_path: string;
  model: string;
  client_config: ClientConfig;
  sampling_args: SamplingArgs;
  num_examples: number;
  rollouts_per_example: number;
  max_concurrent: number;
  max_concurrent_generation?: number;
  max_concurrent_scoring?: number;
  interleave_scoring: boolean;
  print_results: boolean;
  verbose: boolean;
  state_columns?: string[];
  save_results: boolean;
  save_every: number;
  save_to_hf_hub: boolean;
  hf_hub_dataset_name?: string;
}

/**
 * Dataset interface - compatible with HuggingFace datasets
 */
export interface Dataset {
  column_names: string[];
  [key: string]: any;
}

/**
 * Parser interface for extracting structured information from completions
 */
export interface IParser {
  parse_answer(completion: Messages): string | null;
  parse_completion(completion: Messages): any;
}

