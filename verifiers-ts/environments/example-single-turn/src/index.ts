/**
 * Example single-turn environment using verifiers-ts
 * Demonstrates basic Q&A evaluation
 */

import {
  SingleTurnEnv,
  Rubric,
  Parser,
} from "verifiers-ts";

// Simple dataset structure
interface SimpleDataset {
  prompt: Array<{ role: string; content: string }[]>;
  answer: string[];
}

export function loadEnvironment(options: {
  dataset?: SimpleDataset;
} = {}) {
  // Create a simple reward function
  function correctAnswer(params: {
    completion: any;
    answer: string;
  }): number {
    const completionText = Array.isArray(params.completion)
      ? params.completion
          .map((msg: any) =>
            typeof msg === "object" ? msg.content : String(msg)
          )
          .join(" ")
      : String(params.completion);

    const parsed = completionText.trim().toLowerCase();
    const expected = params.answer.trim().toLowerCase();
    return parsed === expected ? 1.0 : 0.0;
  }

  // Create rubric
  const rubric = new Rubric({
    funcs: [correctAnswer],
    weights: [1.0],
  });

  // Create environment
  const env = new SingleTurnEnv({
    dataset: options.dataset || createExampleDataset(),
    systemPrompt: "Answer the question concisely.",
    rubric,
    parser: new Parser(),
    envId: "example-single-turn",
    envArgs: options,
  });

  return env;
}

function createExampleDataset(): SimpleDataset {
  return {
    prompt: [
      [
        { role: "user", content: "What is 2+2?" },
      ],
      [
        { role: "user", content: "What is the capital of France?" },
      ],
    ],
    answer: ["4", "Paris"],
  };
}




