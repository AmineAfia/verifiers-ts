# Get Started: Build an RL Environment with verifiers

The Hangman demo walks you through every building block required to ship a multi-turn, tool-enabled RL evaluation using the `verifiers` TypeScript SDK. By the end you will understand how to structure your own environment and expose it to both the TypeScript and Python tooling.

---

## 1. Prerequisites

- Install [`uv`](https://github.com/astral-sh/uv) for Python dependency management.
- Install [`pnpm`](https://pnpm.io/) for the TypeScript build.
- (Optional) Install the Prime CLI for sandboxed tool execution:

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
uv tool install prime
```

Make sure you have access to an AI SDK compatible model (e.g., OpenAI via `@ai-sdk/openai`) and the credentials set in your environment.

---

## 2. Clone and install

```bash
cd verifiers-ts/environments/hangman
# First, ensure verifiers-ts is built (from repo root)
cd ../..
pnpm build

# Then install and build the environment
cd environments/hangman
pnpm install
pnpm build          # compiles the TypeScript sources
pnpm vf-eval -- -n 5 -r 1 -m gpt-5-mini -s
```

**Note:** The environment uses a file dependency (`file:../..`) to reference the local `verifiers-ts` package. Make sure `verifiers-ts` is built (produces `dist/`) before building the environment, as TypeScript will resolve types from the compiled output.

---

## 3. Understand the anatomy

This tutorial environment is intentionally small. Each file maps to a concept you will reuse in your own projects:

| File | Concept | What it does |
|------|---------|--------------|
| `src/game.ts` | **Lifecycle** | Implements `ToolGameLifecycle` (`setupState`, `onTurn`, `isCompleted`) that defines per-turn logic. |
| `src/agent.ts` | **Agent** | Wraps `generateText` from AI SDK and registers the `guess_letter` tool. |
| `src/rewards.ts` | **Rewards & Rubric** | Provides reward functions and weights that score each rollout. |
| `src/index.ts` | **Environment factory** | Calls `createToolGameEnvironment` to stitch everything together. |
| `package.json` | **Manifest & CLI hooks** | Stores `verifiers` metadata (env id, eval defaults) and wires the `vf-eval` npm script. |

Keep these responsibilities separate: the SDK handles the rollout loop, concurrency, and sandboxing; you provide domain-specific logic.

---

## 4. Implement the lifecycle

`ToolGameLifecycle` is the contract that powers multi-turn, tool-augmented environments. In Hangman:

```ts
export class HangmanGame implements ToolGameLifecycle {
  async setupState(state: State) { /* create the initial game state */ }
  async onTurn({ messages, state }: ToolGameTurnArgs) { /* parse guess, update state, emit feedback */ }
  async isCompleted(_messages: Messages, state: State) { /* stop when win or loss */ }
}
```

To adapt this pattern:

1. Decide what state your task needs across turns.
2. Parse the model’s response (using `XMLParser`, JSON, or custom logic).
3. Emit new user messages (or tool results) that drive the next step.

---

## 5. Wire the agent and tools

Agents must expose a `generateText` function and a `tools` dictionary. Hangman wraps AI SDK’s `generateText`, injects a system prompt, and registers the `guess_letter` tool. Replace these pieces with your own prompt, safety settings, or tool definitions as needed.

```ts
export const hangmanAgent: GenerateTextAgent = {
  generateText: hangmanGenerateText,
  tools: { guess_letter: guessLetter },
};
```

Tools are authored with `defineTool`/`tool` helpers and return plain text or structured JSON payloads back to the model.

---

## 6. Define rewards and weights

Rewards are simple functions `(completion, answer, state) => number`. Combine them in a `Rubric` or pass a list plus weights.

```ts
export const correctnessReward: RewardFunc = ({ state }) =>
  state.gameState?.gameWon ? 1 : 0;

export const efficiencyReward: RewardFunc = ({ state }) =>
  Math.max(0, 1 - state.gameState!.wrongGuesses / state.maxWrongGuesses);
```

Use multiple rewards to score accuracy, safety, efficiency, or formatting separately. The SDK will aggregate them using the provided weights.

---

## 7. Create the environment factory

`createToolGameEnvironment` is the high-level helper that registers your environment, datasets, parser, and rewards.

```ts
export async function createHangmanEnvironment(
  options: HangmanEnvironmentOptions = {}
): Promise<Environment> {
  const game = new HangmanGame({ maxWrongGuesses });
  const parser = game.parser;
  const rewardFunctions: RewardFunc[] = [
    correctnessReward,
    efficiencyReward,
    parser.getFormatRewardFunc(),
  ];

  return createToolGameEnvironment({
    envId: "hangman",
    agent: options.agent ?? hangmanAgent,
    dataset: trainData,
    evalDataset: evalData,
    parser,
    lifecycle: game,
    rewardFunction: rewardFunctions,
    rewardWeights: [1.0, 0.5, 0.2],
    sandbox: options.sandbox ?? { enabled: true },
    maxTurns,
  });
}
```

Swap out `createToolGameEnvironment` for `createSingleTurnEnvironment`, `createMultiTurnEnvironment`, or other helpers depending on your task structure.

---

## 8. Run an evaluation

After building the TypeScript bundle, run the npm-backed CLI. The SDK bridges into Python’s `vf-eval` under the hood:

```bash
pnpm build
export OPENAI_API_KEY=sk-your-key
pnpm vf-eval -- -n 5 -r 1 -m gpt-5-mini -s
uv run vf-tui outputs   # browse results
```

`pnpm vf-eval` compiles the environment if needed, exports it through the TypeScript bridge, and invokes the Python evaluation loop without requiring any per-environment `.py` files.

---

## 9. Customize and extend

Tweak the Hangman demo to explore different design choices:

- Change `wordList`, `maxWrongGuesses`, or `maxTurns` by passing options to `createHangmanEnvironment`.
- Swap in your own agent or model by supplying an `agent` override.
- Add new tools or multi-step logic by extending the lifecycle.
- Introduce new rewards to track novel metrics (e.g., reasoning chain length, safety checks).

Once you are comfortable, use this folder as a template: copy it, rename the files to your domain, and replace the lifecycle, dataset, and rewards with your own logic.

---

## 10. Next steps

- Read the top-level `AGENTS.md` for coding standards and testing expectations.
- Inspect other environments in `environments/` for pattern variety (multi-turn, MCP tools, sandboxed Python execution).
- Publish your environment by exporting a `load_environment` function and sharing the folder (or packaging it via `vf-install`).

With these fundamentals you can build, evaluate, and iterate on new RL environments quickly using the `verifiers` ecosystem. Happy hacking!
