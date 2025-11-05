# verifiers-ts

TypeScript implementation of the verifiers framework for building RL environments and evaluations with AI SDK integration.

## Overview

`verifiers-ts` provides the same core functionality as the Python `verifiers` library, enabling you to:

- Define custom interaction protocols between models and environments
- Build agents, multi-turn conversations, tool-augmented reasoning, and interactive games
- Create reusable evaluation environments with multi-criteria reward functions
- Integrate with [AI SDK](https://sdk.vercel.ai/docs) for model inference and native tool calling

## Installation

```bash
npm install verifiers-ts
```

Or if developing locally:

```bash
cd verifiers-ts
npm install
npm run build
```

## Quick Start

### Scaffold a Minimal RL Environment

```bash
pnpm dlx verifiers-ts vf-init weather-bot --minimal-rl
cd weather-bot
pnpm install
pnpm build
pnpm vf-eval -n 1 -r 1
```

This template matches the screenshot example: a tool-enabled agent, tiny dataset, and a reward built with `structuredOutputReward`. Replace the prompt, tweak the agent defaults, and you’re ready to evaluate. Remember to export `OPENAI_API_KEY` (or pass `--api-key` to `vf-eval`).

### Scaffold an Environment

```bash
pnpm dlx verifiers-ts vf-init my-environment
cd my-environment
pnpm install
pnpm build
pnpm vf-eval -n 1 -r 1
```

Customize the generated `src/index.ts`, dataset, and reward functions to match your task.

> `vf-eval` automatically compiles your TypeScript, provisions a local `.vf-eval/` virtualenv, and exposes the environment to Python tooling—no manual `uv sync` required.
> Provide `OPENAI_API_KEY` (or another provider key) so the default agent can make model calls.

### Minimal RL Environment

```typescript
import { generateText, tool } from "ai";
import { z } from "zod";
import { openai } from "@ai-sdk/openai";
import { createRLEnvironment } from "verifiers-ts";

const getCurrentWeather = tool({
  description: "Get the current weather for a specific location.",
  parameters: z.object({
    location: z
      .string()
      .describe("City and state, for example: Seattle, WA"),
    unit: z
      .enum(["celsius", "fahrenheit"])
      .describe("Temperature unit to return.")
      .optional(),
  }),
  execute: async ({ location, unit }) => {
    const preferredUnit = unit ?? "celsius";
    const temperature = preferredUnit === "celsius" ? 18 : 64;
    return `It is ${temperature}°${preferredUnit === "celsius" ? "C" : "F"} and sunny in ${location}.`;
  },
});

const weatherAgent = {
  generateText: (messages: any, options: Record<string, unknown> = {}) => {
    const { tools = {}, ...rest } = options as {
      tools?: Record<string, ReturnType<typeof tool>>;
    };

    return generateText({
      model: openai("gpt-4o-mini") as any,
      system:
        "You are WeatherBot. When a user asks about the weather, call the getCurrentWeather tool and report the results clearly.",
      temperature: 0,
      tools: { getCurrentWeather, ...tools },
      messages,
      ...rest,
    });
  },
  tools: { getCurrentWeather },
};

const env = await createRLEnvironment({
  agent: weatherAgent,
  dataset: [
    {
      prompt: [
        {
          role: "user",
          content: "What's the weather like in Seattle right now?",
        },
      ],
      answer: "seattle",
    },
  ],
  rewardFunction: (completion, answer) => {
    const text = Array.isArray(completion)
      ? completion
          .filter(
            (msg) =>
              typeof msg === "object" &&
              msg !== null &&
              "role" in msg &&
              msg.role === "assistant"
          )
          .map((msg) => (msg as { content?: string }).content ?? "")
          .join(" ")
      : typeof completion === "string"
      ? completion
      : "";
    const normalized = text.toLowerCase();
    return normalized.includes(answer) && normalized.includes("weather") ? 1 : 0;
  },
});
```

### Single-Turn Environment

```typescript
import { SingleTurnEnv, Rubric, Parser } from "verifiers-ts";

function correctAnswer(params: {
  completion: any;
  answer: string;
}): number {
  const text = extractText(params.completion);
  return text.trim() === params.answer.trim() ? 1.0 : 0.0;
}

const rubric = new Rubric({
  funcs: [correctAnswer],
  weights: [1.0],
});

const env = new SingleTurnEnv({
  dataset: myDataset,
  systemPrompt: "Solve step by step",
  rubric,
});

const results = await env.evaluate(
  "gpt-4",
  {},
  10, // numExamples
  1,  // rolloutsPerExample
  true, // scoreRollouts
  32, // maxConcurrent
  undefined, // maxConcurrentGeneration
  undefined, // maxConcurrentScoring
  process.env.OPENAI_API_KEY
);
```

### Tool-Using Environment

```typescript
import { ToolEnv, defineTool } from "verifiers-ts";
import { z } from "zod";

const calculator = defineTool(
  "calculate",
  "Perform arithmetic",
  z.object({
    expression: z.string(),
  }),
  async (args) => {
    return eval(args.expression); // Use proper parser in production
  }
);

const env = new ToolEnv({
  tools: [calculator],
  maxTurns: 10,
});

// AI SDK automatically handles tool calling loop
const results = await env.evaluate("gpt-4", {}, 10);
```

## Architecture

The library mirrors the Python verifiers structure:

- **Environments**: Base `Environment` class with `MultiTurnEnv`, `SingleTurnEnv`, `ToolEnv`, `StatefulToolEnv`, and `SandboxEnv` variants
- **Rubrics**: Weighted reward functions for evaluation
- **Parsers**: Extract structured information (`Parser`, `ThinkParser`, `XMLParser`)
- **Tools**: Native AI SDK tool integration using `tool()` function from 'ai' package
- **AI SDK Integration**: Uses `generateText` for model calls and automatic tool calling

## Key Features

### AI SDK Integration

- **Native Tool Calling**: Tools use AI SDK's `tool()` function with Zod schemas
- **Automatic Loop Handling**: AI SDK manages tool execution loops with `stopWhen` conditions
- **Type-Safe Tools**: Zod schemas provide runtime validation and TypeScript types
- **Structured Outputs**: Support for `generateObject` when needed

### Compatibility

- **Results Format**: Saves results in JSONL format compatible with Python `vf-tui`
- **Native TypeScript Evaluation**: TypeScript projects use native `vf-eval` CLI (no Python bridge needed)
- **Sandbox Bridge**: Python bridge available for sandbox environments only
- **State Management**: Same state structure as Python verifiers

## Environment Types

### SingleTurnEnv
For Q&A tasks requiring a single model response.

### MultiTurnEnv
Base class for custom interaction protocols. Override `is_completed` and `env_response`.

### ToolEnv
Uses AI SDK's native tool calling. Tools are defined with `defineTool()` and automatically handled by AI SDK.

### StatefulToolEnv
Extends `ToolEnv` for tools requiring dynamic state (e.g., sandbox IDs).

### SandboxEnv
Abstract base for Prime Intellect sandbox integration.

## Evaluation

TypeScript environments are evaluated natively using the TypeScript `vf-eval` CLI:

```bash
npx vf-eval hangman -n 5 -r 1
```

The CLI automatically:
- Detects TypeScript projects (those with `package.json` containing `verifiers.envId` but no `pyproject.toml`)
- Uses native TypeScript evaluation implementation
- Saves results in compatible JSONL format for `vf-tui`

For Python projects, `vf-eval` delegates to the Python `verifiers` CLI.

## Sandbox Bridge

Sandbox environments (using `SandboxEnv`) require the Python `sandbox_bridge.py` script to interact with Prime Intellect sandboxes. This bridge is automatically detected and used when available.

## Examples

See `environments/` directory for example implementations:
- `example-single-turn`: Basic Q&A environment
- `example-tool-use`: Tool calling with AI SDK

## Development

This workspace uses [Turborepo](https://turbo.build) for task orchestration and caching. Use `turbo run` commands to build all packages with automatic dependency resolution and caching.

```bash
# Install dependencies
pnpm install

# Build all packages (core + environments)
pnpm turbo run build

# Build a specific environment
pnpm turbo run build --filter hangman

# Run tests
pnpm turbo run test

# Lint all packages
pnpm turbo run lint

# Format code
pnpm turbo run format

# Watch mode (runs all dev tasks in parallel)
pnpm turbo run dev --parallel

# Watch a specific environment
pnpm turbo run dev --parallel --filter hangman
```

### Turbo Features

- **Task Dependencies**: Builds automatically respect workspace dependencies (`dependsOn: ["^build"]`)
- **Local Caching**: Build outputs are cached locally for faster rebuilds
- **Parallel Execution**: Dev tasks run in parallel across packages
- **Filtering**: Use `--filter <package-name>` to target specific packages

For remote caching (CI/CD), set `TURBO_TEAM` and `TURBO_TOKEN` environment variables.

## Status

✅ **Core Complete** - All base classes and AI SDK integration implemented
🔄 **In Progress** - Python bridge refinement
📝 **Pending** - Comprehensive tests and examples

## License

MIT
