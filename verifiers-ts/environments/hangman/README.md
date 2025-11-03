# Hangman Environment

A multi-turn interactive Hangman game environment for `verifiers-ts`, where the model guesses letters to reveal a secret word.

## Overview

The Hangman environment extends `MultiTurnEnv` to create an interactive game where:
- The model guesses one letter at a time
- The environment reveals letter positions for correct guesses
- The model has 6 wrong guesses before losing
- Visual feedback shows word state, wrong guesses, and available letters

## Running with vf-eval

### Installation

First, ensure you're in the verifiers root directory and install dependencies:

```bash
cd verifiers-ts/environments/hangman
pnpm install
cd ../../..
uv sync
```

### Basic Usage

Run an evaluation with `vf-eval`:

```bash
uv run vf-eval hangman -n 10 -m gpt-4o-mini
```

### Options

- `-n, --num-examples`: Number of examples to evaluate (default: 10)
- `-m, --model`: Model to use (e.g., `gpt-4o-mini`, `gpt-4o`)
- `-r, --rollouts-per-example`: Number of rollouts per example (default: 1)
- `-s, --save`: Save results to disk
- `--num-train-examples`: Number of training examples (default: 100)
- `--num-eval-examples`: Number of evaluation examples (default: 20)
- `--max-wrong-guesses`: Maximum wrong guesses allowed (default: 6)
- `--max-turns`: Maximum turns per game (default: 20)

### Examples

```bash
# Quick test run
uv run vf-eval hangman -n 5 -m gpt-4o-mini -s

# Full evaluation with custom settings
uv run vf-eval hangman -n 50 -r 3 -m gpt-4o --num-train-examples 200 --max-turns 15
```

## Direct TypeScript Usage

### Basic Usage

```typescript
import { createHangmanEnvironment } from "./src/index.js";

// Create environment with a single factory call (loadEnvironment() is an alias)
const env = await createHangmanEnvironment({
  numTrainExamples: 100,
  numEvalExamples: 20,
  maxWrongGuesses: 6,
  maxTurns: 20,
});

// loadEnvironment() is still available and forwards to createHangmanEnvironment()

// Run evaluation
const results = await env.evaluate("gpt-4o-mini", {}, 10);

// Access results
console.log(results.metadata.avg_reward);
console.log(results.reward);
```

### Tool-Based Guessing (Default Behavior)

The Hangman environment uses AI SDK's `tool()` function directly for making guesses. By default, a `guess_letter` tool is automatically added to the agent config. The model calls this tool to make guesses instead of using text format:

```typescript
import { createHangmanEnvironment } from "./src/index.js";

// The guess_letter tool is automatically included
const env = await createHangmanEnvironment({
  numTrainExamples: 100,
});

// Model will call guess_letter({letter: "A"}) to make guesses
const results = await env.evaluate("gpt-4o-mini", {}, 10);
```

### With Custom AI SDK Agent Config

The Hangman environment supports the AI SDK agent pattern, allowing you to customize the model, system prompt, tools, and sampling arguments. You can also provide your own tools or override the default `guess_letter` tool:

```typescript
import { createHangmanEnvironment } from "./src/index.js";
import { openai } from "@ai-sdk/openai";
import { stepCountIs } from "ai";

// Load environment with custom agent configuration
const env = await createHangmanEnvironment({
  numTrainExamples: 100,
  numEvalExamples: 20,
  maxWrongGuesses: 6,
  maxTurns: 20,
  agent: {
    model: openai("gpt-4o"), // Custom model
    system: "You are an expert Hangman player. Think strategically about letter frequency.",
    temperature: 0.3, // Lower temperature for more consistent play
    maxOutputTokens: 50, // Short responses
    stopWhen: stepCountIs(5), // Limit tool steps if using tools
  },
});

// Run evaluation
const results = await env.evaluate("gpt-4o", {}, 10);
```

### Using createMultiTurnRLEnvironment Directly

You can also use the factory function directly for more control:

### Simple Agent Configuration (Recommended)

The simplest way matches the `example-generate-text-agent` pattern - just pass the `generateText` config object. The `guess_letter` tool is automatically included:

```typescript
import { createHangmanEnvironment } from "./src/index.js";
import { openai } from "@ai-sdk/openai";

const env = await createHangmanEnvironment({
  agent: {
    model: openai("gpt-4o-mini"),
    system: "You are an expert Hangman player.",
    temperature: 0.3,
  },
  numTrainExamples: 100,
});
```

### Custom Tools

You can provide your own tools alongside or instead of the default `guess_letter` tool. If you provide a `guess_letter` tool, it will override the default:

```typescript
import { createHangmanEnvironment } from "./src/index.js";
import { openai } from "@ai-sdk/openai";
import { tool } from "ai";
import { z } from "zod";

// Custom guess_letter tool (overrides default)
const customGuessTool = tool({
  description: "My custom guess tool",
  inputSchema: z.object({
    letter: z.string().length(1),
  }),
  execute: async ({ letter }) => {
    return `Custom guess: ${letter}`;
  },
});

// Additional custom tool
const helperTool = tool({
  description: "Helper tool for strategy",
  inputSchema: z.object({}),
  execute: async () => {
    return "Strategy advice";
  },
});

const env = await createHangmanEnvironment({
  agent: {
    model: openai("gpt-4o-mini"),
    tools: {
      guess_letter: customGuessTool, // Overrides default
      helper: helperTool, // Additional tool
    },
  },
});
```

## Game Rules

1. The model guesses one letter per turn
2. Correct guesses reveal all positions of that letter
3. Wrong guesses reduce remaining attempts
4. The game is won when all letters are revealed
5. The game is lost after 6 wrong guesses

## Reward Functions

The environment includes three reward functions:

1. **Correctness Reward** (weight: 1.0): 1.0 if the word was guessed correctly, 0.0 otherwise
2. **Efficiency Reward** (weight: 0.5): Bonus based on fewer wrong guesses (higher reward for 0 wrong guesses)
3. **Format Reward** (weight: 0.2): Reward for using correct format (primarily for tool calls, with XML fallback)

## Visual Feedback

Each turn displays:

```
Word: _ _ _ _ _
Wrong guesses: 0/6
Guessed letters: 
Available: A B C D E F G H I J K L M N O P Q R S T U V W X Y Z

Guess a letter:
```

After a win:
```
🎉 Congratulations! You guessed the word: APPLE
Word: A P P L E
Wrong guesses: 1/6
```

After a loss:
```
💀 Game Over! The word was: APPLE
Word: _ P P _ _
Wrong guesses: 6/6 (X, Y, Z, Q, W, V)
```

## Implementation Details

- **Tool-Based Guessing**: Uses AI SDK's `tool()` function directly - no wrappers needed. The `guess_letter` tool is automatically added to the agent config.
- **Tool Call Extraction**: The environment extracts guesses from tool calls in `envResponse()`, with fallback to text parsing for backward compatibility.
- **Parser**: Uses `XMLParser` with field `["guess"]` as fallback for text-based guesses
- **State Management**: Game state stored in `state.gameState` with:
  - `secretWord`: The word to guess
  - `guessedLetters`: Array of guessed letters
  - `wrongGuesses`: Number of incorrect guesses
  - `gameWon`: Boolean flag for win condition
  - `gameLost`: Boolean flag for loss condition
  - `wordDisplay`: Current visual display string

## Customization

You can customize the word list, max wrong guesses, agent config, and other settings:

```typescript
const env = await createHangmanEnvironment({
  agent: {
    model: openai("gpt-4o"),
    system: "Custom system prompt",
    temperature: 0.7,
  },
  numTrainExamples: 100,
  numEvalExamples: 20,
  maxWrongGuesses: 6,
  maxTurns: 20,
  wordList: ["apple", "banana", "custom", "words"],
});
```

