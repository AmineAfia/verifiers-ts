/**
 * Evaluation utilities for saving results in compatible format
 */

import type { GenerateOutputs, GenerateMetadata } from "../types/index.js";
import * as fs from "fs/promises";
import * as path from "path";

/**
 * Convert GenerateOutputs to JSONL format compatible with Python verifiers
 */
export async function saveResultsToDisk(
  results: GenerateOutputs,
  outputPath: string
): Promise<void> {
  // Create output directory
  await fs.mkdir(outputPath, { recursive: true });

  // Save results as JSONL (one JSON object per line)
  const resultsPath = path.join(outputPath, "results.jsonl");
  const lines: string[] = [];

  const n = results.prompt.length;
  for (let i = 0; i < n; i++) {
    const record: Record<string, unknown> = {
      example_id: results.example_id[i],
      prompt: formatMessagesForOutput(results.prompt[i]),
      completion: formatMessagesForOutput(results.completion[i]),
      answer: results.answer[i],
      task: results.task[i],
      info: results.info[i],
      reward: results.reward[i],
      ...Object.fromEntries(
        Object.entries(results.metrics).map(([key, values]) => [
          key,
          values[i],
        ])
      ),
      // Add timing from state if available
      ...(results.state[i]?.timing && {
        generation_ms: results.state[i].timing.generation_ms,
        scoring_ms: results.state[i].timing.scoring_ms,
        total_ms: results.state[i].timing.total_ms,
      }),
    };

    lines.push(JSON.stringify(record));
  }

  await fs.writeFile(resultsPath, lines.join("\n") + "\n", "utf-8");

  // Save metadata
  const metadataPath = path.join(outputPath, "metadata.json");
  const metadata = sanitizeMetadata(results.metadata);
  await fs.writeFile(
    metadataPath,
    JSON.stringify(metadata, null, 2),
    "utf-8"
  );
}

/**
 * Format messages for output (convert to string representation)
 */
function formatMessagesForOutput(messages: unknown): string {
  if (typeof messages === "string") {
    return messages;
  }
  if (Array.isArray(messages)) {
    return messages
      .map((msg) => {
        if (typeof msg === "object" && msg !== null) {
          const role = (msg as { role?: string }).role || "unknown";
          const content = (msg as { content?: string }).content || "";
          return `${role}: ${content}`;
        }
        return String(msg);
      })
      .join("\n");
  }
  return String(messages);
}

/**
 * Sanitize metadata for JSON serialization
 */
function sanitizeMetadata(metadata: GenerateMetadata): Record<string, unknown> {
  return {
    env_id: metadata.env_id,
    env_args: metadata.env_args,
    model: metadata.model,
    base_url: metadata.base_url,
    num_examples: metadata.num_examples,
    rollouts_per_example: metadata.rollouts_per_example,
    sampling_args: metadata.sampling_args,
    date: metadata.date,
    time_ms: metadata.time_ms,
    avg_reward: metadata.avg_reward,
    avg_metrics: metadata.avg_metrics,
    state_columns: metadata.state_columns,
    path_to_save: metadata.path_to_save,
  };
}

/**
 * Get results path based on env_id and model
 */
export function getResultsPath(
  envId: string,
  model: string,
  basePath: string = "./outputs"
): string {
  // Format: outputs/evals/{env_id}--{model}/{run_id}/
  const envModelStr = `${envId}--${model.replace("/", "--")}`;
  const runId = `${Date.now()}-${Math.random().toString(36).substring(7)}`;
  return path.join(basePath, "evals", envModelStr, runId);
}




