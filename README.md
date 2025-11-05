# verifiers-ts

Build reinforcement learning environments to train LLMs using TypeScript. The library is a fork from the Prime Intellect verifiers library to evaluate and train AI agents through interactive tasks, tool use, and multi-turn conversations.

## What is verifiers-ts?

`verifiers-ts` is a TypeScript framework for creating RL (reinforcement learning) environments that let you:

- **Evaluate** how well language models perform on specific tasks
- **Train** models using reinforcement learning with custom reward functions
- **Build** interactive environments with tools, multi-turn conversations, and sandboxed code execution
- **Measure** performance with flexible, multi-criteria reward systems

Think of it as a testing framework for AI agents—but instead of just checking if code runs, you're measuring how well models solve problems, use tools, and interact with their environment.

## Quick Start

Get started in under 2 minutes by scaffolding a minimal RL environment:

```bash
# 1. Authenticate with Prime Intellect (for sandbox features)
prime login

# 2. Create a new environment from template
npx -p verifiers-ts vf-init weather-bot --minimal-rl

# 3. Follow the setup instructions
cd weather-bot
pnpm install
pnpm build

# 4. Run your first evaluation
pnpm vf-eval -n 1 -r 1 -s
```

That's it! You now have a working RL environment. The scaffold includes:

- ✅ An AI agent that can call tools
- ✅ A sample dataset with prompts and answers
- ✅ A reward function to evaluate performance
- ✅ Sandbox support for safe code execution

**Before running evaluations**, make sure you have an API key set:

```bash
export OPENAI_API_KEY="your-key-here"
# Or pass it directly: pnpm vf-eval --api-key "your-key-here"
```

> 💡 **Tip**: The `-s` flag saves results to `outputs/` so you can explore them later with `pnpm vf-tui`.

## Understanding RL Environments

An RL environment in `verifiers-ts` is like a training gym for AI models. It defines the rules, provides the tools, and scores performance. Here's how the pieces fit together:

```
┌─────────────────────────────────────────────────────────────┐
│                    RL Environment                           │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌──────────────┐         ┌──────────────┐                │
│  │   Dataset    │────────▶│    Agent     │                │
│  │              │  prompt │              │                │
│  │ • Examples   │         │ • AI Model   │                │
│  │ • Answers    │         │ • Tools      │                │
│  └──────────────┘         └──────┬───────┘                │
│                                   │                         │
│                                   │ completion               │
│                                   ▼                         │
│                          ┌──────────────┐                  │
│                          │   Reward     │                  │
│                          │   Function   │                  │
│                          │              │                  │
│                          │ • Score: 0-1 │                  │
│                          │ • Criteria   │                  │
│                          └──────────────┘                  │
│                                   │                         │
│                                   │ score                   │
│                                   ▼                         │
│                          ┌──────────────┐                  │
│                          │   Results    │                  │
│                          │              │                  │
│                          │ • Metrics    │                  │
│                          │ • Logs       │                  │
│                          └──────────────┘                  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### The Four Core Components

Every RL environment needs these four elements:

#### 1. **Agent** 🤖
The AI model that will be evaluated or trained. It wraps a language model (like GPT-4) and optionally provides tools it can use.

```typescript
import { generateText, tool } from "ai";
import { openai } from "@ai-sdk/openai";
import type { GenerateTextAgent } from "verifiers-ts";

const myAgent: GenerateTextAgent = {
  generateText: (messages, options = {}) => {
    return generateText({
      model: openai("gpt-4o-mini"),
      system: "You are a helpful assistant.",
      messages,
      tools: { /* your tools */ },
      ...options,
    });
  },
  tools: { /* optional tool map */ },
};
```

**What it does**: Takes prompts from the dataset, generates responses using the AI model, and can call tools when needed.

#### 2. **Dataset** 📊
A collection of examples that define the task. Each example has a prompt (what you ask the model) and an optional answer (what you expect).

```typescript
const dataset = [
  {
    prompt: [
      { role: "user", content: "What is 2+2?" }
    ],
    answer: "4",  // Used by reward functions
  },
  {
    prompt: [
      { role: "user", content: "What's the weather in Seattle?" }
    ],
    answer: "seattle",
  },
  // ... more examples
];
```

**What it does**: Provides the test cases or training examples for your environment. The model will be evaluated on each example.

#### 3. **Reward Function** 🎯
A function that evaluates the model's output and returns a score (typically 0.0 to 1.0). This is how you measure success.

```typescript
import { structuredOutputReward } from "verifiers-ts";
import { z } from "zod";

// Option 1: Use built-in rewards
const reward = structuredOutputReward({
  schema: z.object({
    location: z.string(),
    temperature: z.number(),
  }),
});

// Option 2: Write a custom reward
const reward = async (completion, answer, state) => {
  const text = extractText(completion);
  return text.includes(answer) ? 1.0 : 0.0;
};
```

**What it does**: Analyzes the model's completion and returns a score. Higher scores = better performance. You can combine multiple reward functions with different weights.

#### 4. **Environment Configuration** ⚙️
Puts it all together into a runnable environment.

```typescript
import { createRLEnvironment } from "verifiers-ts";

const env = await createRLEnvironment({
  agent: myAgent,
  dataset: myDataset,
  rewardFunction: myReward,
  rewardWeights: [1.0],  // Optional: weights for multiple rewards
  sandbox: { enabled: true },  // Optional: enable code execution
});
```

**What it does**: Combines all components into a single environment that can be evaluated, trained, or integrated with RL training loops.

## How It Works: The Evaluation Flow

When you run an evaluation, here's what happens:

1. **Load Environment**: The environment reads your dataset and configuration
2. **Iterate Examples**: For each example in the dataset:
   - Extract the prompt
   - Send it to the agent
   - Agent generates a response (possibly using tools)
   - Response is evaluated by the reward function
   - Score is recorded
3. **Collect Results**: All scores and completions are saved
4. **Analyze**: You can explore results with `vf-tui` or analyze programmatically

```
Example 1: "What's 2+2?"
  → Agent: "The answer is 4"
  → Reward: 1.0 ✅

Example 2: "What's the weather?"
  → Agent: [calls getCurrentWeather tool]
  → Agent: "It's 18°C and sunny in Seattle"
  → Reward: 1.0 ✅
```

## Common Patterns

### Single-Turn Q&A
For tasks where the model gives one answer:

```typescript
import { SingleTurnEnv, Rubric } from "verifiers-ts";

const env = new SingleTurnEnv({
  dataset: myDataset,
  systemPrompt: "Answer accurately.",
  rubric: new Rubric({
    funcs: [correctnessReward],
    weights: [1.0],
  }),
});
```

### Tool-Using Agents
For agents that need to call functions:

```typescript
import { createRLEnvironment } from "verifiers-ts";

const env = await createRLEnvironment({
  agent: toolEnabledAgent,
  dataset: myDataset,
  rewardFunction: [
    correctnessReward,
    toolUseReward,  // Reward proper tool usage
  ],
  rewardWeights: [0.8, 0.2],
});
```

### Multi-Turn Conversations
For interactive tasks like games or simulations:

```typescript
import { createToolGameEnvironment } from "verifiers-ts";

const env = await createToolGameEnvironment({
  agent: myAgent,
  dataset: myDataset,
  rewardFunction: myReward,
  lifecycle: {
    setupState: async (state) => { /* initialize game */ },
    isCompleted: async (messages, state) => { /* check win/loss */ },
    onTurn: async ({ messages, state }) => { /* process turn */ },
  },
  maxTurns: 20,
});
```

## Next Steps

Now that you understand the basics:

1. **Explore the scaffold**: Look at the generated `src/index.ts` in your `weather-bot` project
2. **Customize your dataset**: Replace the example prompts with your own task
3. **Refine rewards**: Adjust the reward function to match your evaluation criteria
4. **Add tools**: Define more tools your agent can use
5. **Run evaluations**: Use `pnpm vf-eval -n 10 -r 3` to test multiple examples

### Explore Results

After running evaluations, browse them interactively:

```bash
pnpm vf-tui
```

This opens a terminal UI where you can:
- Navigate through evaluation runs
- View prompts, completions, and rewards
- Compare different runs and models
- Drill down into individual examples

### Learn More

- **Examples**: See `verifiers-ts/environments/hangman` for a complete multi-turn game example
- **API Reference**: Check out the TypeScript types and exported functions
- **Python Integration**: Use `vf-eval` and `vf-tui` from Python projects too

## Architecture

`verifiers-ts` provides several environment types:

- **`createRLEnvironment`**: General-purpose factory for RL environments
- **`SingleTurnEnv`**: Simple Q&A tasks
- **`MultiTurnEnv`**: Custom multi-turn protocols
- **`ToolEnv`**: Native AI SDK tool calling
- **`StatefulToolEnv`**: Tools requiring dynamic state
- **`SandboxEnv`**: Code execution in isolated environments
- **`createToolGameEnvironment`**: Factory for tool-driven games

All environments integrate seamlessly with [AI SDK](https://sdk.vercel.ai/docs) for model inference and tool calling.

## Development

This is a monorepo managed with [Turborepo](https://turbo.build):

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm turbo run build

# Run tests
pnpm turbo run test

# Lint
pnpm turbo run lint
```

## License

MIT
