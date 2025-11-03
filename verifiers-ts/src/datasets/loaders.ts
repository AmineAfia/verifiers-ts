/**
 * Dataset loading utilities
 * Supports loading datasets from various sources and converting to verifiers format
 */

import type { Dataset, Messages, ChatMessage } from "../types/index.js";
import { promises as fs } from "fs";

export interface LoadDatasetOptions {
  source: "file" | "array" | "huggingface";
  path?: string; // For file source
  data?: Array<Record<string, any>>; // For array source
  name?: string; // For huggingface source
  split?: string; // For huggingface source
  questionKey?: string; // Key for question/prompt in dataset
  answerKey?: string; // Key for answer in dataset
}

/**
 * Load a dataset from various sources
 *
 * @example
 * ```typescript
 * // From file
 * const dataset = await loadDataset({
 *   source: 'file',
 *   path: './data.jsonl'
 * });
 *
 * // From array
 * const dataset = await loadDataset({
 *   source: 'array',
 *   data: [
 *     { question: 'What is 2+2?', answer: '4' },
 *     { question: 'What is 3+3?', answer: '6' },
 *   ],
 *   questionKey: 'question',
 *   answerKey: 'answer',
 * });
 * ```
 */
export async function loadDataset(
  options: LoadDatasetOptions
): Promise<Dataset> {
  switch (options.source) {
    case "file":
      if (!options.path) {
        throw new Error("path is required for file source");
      }
      return await loadDatasetFromFile(options.path);

    case "array":
      if (!options.data) {
        throw new Error("data is required for array source");
      }
      return convertArrayToDataset(
        options.data,
        options.questionKey || "question",
        options.answerKey || "answer"
      );

    case "huggingface":
      // TODO: Implement HuggingFace dataset loading
      // This would require @huggingface/datasets or similar
      throw new Error(
        "HuggingFace dataset loading not yet implemented. Use 'file' or 'array' source."
      );

    default:
      throw new Error(`Unknown dataset source: ${options.source}`);
  }
}

/**
 * Load dataset from JSONL file
 */
async function loadDatasetFromFile(path: string): Promise<Dataset> {
  const content = await fs.readFile(path, "utf-8");
  const lines = content.trim().split("\n");
  const data = lines
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));

  return convertArrayToDataset(data, "question", "answer");
}

/**
 * Convert array of objects to verifiers Dataset format
 */
function convertArrayToDataset(
  data: Array<Record<string, any>>,
  questionKey: string,
  answerKey: string
): Dataset {
  // Extract columns
  const columnNames = new Set<string>();
  data.forEach((row) => {
    Object.keys(row).forEach((key) => columnNames.add(key));
  });

  // Ensure required columns exist
  const columns: Record<string, any[]> = {};
  const prompts: Messages[] = [];
  const answers: string[] = [];
  const exampleIds: number[] = [];

  data.forEach((row, index) => {
    // Extract question and answer
    const question = row[questionKey] || "";
    const answer = row[answerKey] || "";

    // Convert question to Messages format (assume string for now)
    // In practice, questions might already be in Messages format
    let prompt: Messages;
    if (typeof question === "string") {
      prompt = [{ role: "user", content: question }];
    } else if (Array.isArray(question)) {
      prompt = question as ChatMessage[];
    } else {
      prompt = [{ role: "user", content: String(question) }];
    }

    prompts.push(prompt);
    answers.push(answer);
    exampleIds.push(row.example_id !== undefined ? row.example_id : index);

    // Copy all other columns
    for (const col of columnNames) {
      if (col !== questionKey && col !== answerKey && col !== "example_id") {
        if (!columns[col]) {
          columns[col] = [];
        }
        columns[col].push(row[col]);
      }
    }
  });

  // Build dataset object
  const dataset: Dataset = {
    column_names: Array.from(columnNames),
    prompt: prompts,
    answer: answers,
    example_id: exampleIds,
    ...columns,
  };

  return dataset;
}

/**
 * Format dataset with system prompt and few-shot examples
 * Similar to Python verifiers' format_dataset method
 */
export function formatDataset(
  dataset: Dataset,
  systemPrompt?: string,
  fewShot?: ChatMessage[]
): Dataset {
  if (!dataset.prompt) {
    throw new Error("Dataset must have 'prompt' column");
  }

  const formattedPrompts = dataset.prompt.map((prompt: Messages) => {
    const messages: ChatMessage[] = [];

    if (systemPrompt) {
      messages.push({ role: "system", content: systemPrompt });
    }

    if (fewShot) {
      messages.push(...fewShot);
    }

    // Add the actual prompt
    if (Array.isArray(prompt)) {
      messages.push(...prompt);
    } else if (typeof prompt === "string") {
      messages.push({ role: "user", content: prompt });
    }

    return messages;
  });

  return {
    ...dataset,
    prompt: formattedPrompts,
  };
}

