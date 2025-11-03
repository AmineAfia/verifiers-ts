## Hangman Demo Environment

The Hangman environment showcases how little code is required to build a multi-turn, tool-driven RL environment with the TypeScript verifiers SDK. Everything specific to the game lives in this folder (dataset, game rules, rewards, agent), while the SDK supplies the rollout loop, sandboxing, and evaluation plumbing.

### What lives here?

- `src/game.ts` &mdash; the Hangman state machine. Implements `ToolGameLifecycle` so the SDK can drive each turn.
- `src/agent.ts` &mdash; minimal AI SDK agent config plus the `guess_letter` tool definition.
- `src/rewards.ts` &mdash; two reward functions (`correctness`, `efficiency`) and their weights.
- `src/index.ts` &mdash; wires the pieces together via `createToolGameEnvironment`.
- `hangman.py` &mdash; Python bridge so `vf-eval` can load the TS environment.

### pre-requisites

install uv and prime cli
```bash
#install uv
curl -LsSf https://astral.sh/uv/install.sh | sh

# Install uv (if not already installed)
curl -LsSf https://astral.sh/uv/install.sh | sh

# Install prime
uv tool install prime
```

### Quick start

```bash
cd verifiers-ts/environments/hangman
pnpm install
pnpm build

# install dependenices once
uv sync

# evaluate the bundled dataset with your model
uv run vf-eval hangman -n 1 -r 1 -m gpt-5-mini -s -c 2

# browse the evaluation runs
uv run vf-tui outputs
```

> ℹ️ The project uses `uv` for dependency management and expects that you build artifacts separately (see `AGENTS.md` for full setup guidance).

<img width="1412" height="1360" alt="image" src="https://github.com/user-attachments/assets/0ae2fd3c-4a95-4ce8-be59-5879c5ff75c2" />



### Core snippets

```ts
import {
  createToolGameEnvironment,
  type RewardFunc,
} from "verifiers-ts";
import { HangmanGame, createHangmanDataset } from "./src/game";
import { prepareHangmanAgent } from "./src/agent";
import { correctnessReward, efficiencyReward } from "./src/rewards";

// 1. Tools + agent
const agent = prepareHangmanAgent({ systemPrompt: "Play Hangman carefully." });

// 2. Dataset (raw examples, auto-normalized by the factory)
const dataset = createHangmanDataset(10, ["alpha", "beta", "gamma"]);

// 3. Rewards (simple RewardFunc array)
const rewards: RewardFunc[] = [correctnessReward, efficiencyReward];

// 4. Game lifecycle (setup/onTurn/isCompleted hooks)
const game = new HangmanGame({ maxWrongGuesses: 6 });

// 5. Create RL environment
const env = await createToolGameEnvironment({
  envId: "hangman",
  agent,
  dataset,
  rewardFunction: rewards,
  lifecycle: game,
});
```

### Customising the demo

| Parameter | Description | Default |
|-----------|-------------|---------|
| `maxWrongGuesses` | Number of incorrect guesses before the game ends. | 6 |
| `maxTurns` | Hard cap on dialogue turns. | 20 |
| `numTrainExamples` / `numEvalExamples` | Dataset sizes generated from the built-in word list. | 100 / 20 |
| `wordList` | Replace with your own vocabulary to theme the game. | `DEFAULT_WORD_LIST` from `game.ts` |
| `sandbox` | Enable Prime Intellect sandbox tools for agents that need execution. | Enabled |

Pass these through `createHangmanEnvironment({ ... })` or `load_environment(**kwargs)` in Python.

### How the pieces fit

1. **Agent** – `prepareHangmanAgent` adds the `guess_letter` tool and the system prompt.
2. **Game lifecycle** – `HangmanGame` implements `setupState`, `onTurn`, and `isCompleted`. The SDK invokes these via `createToolGameEnvironment`.
3. **Dataset** – `createHangmanDataset` generates simple prompts that seed the rollout with a secret word.
4. **Rewards** – `correctnessReward` awards 1.0 for victory, `efficiencyReward` scales up to 0.5 for using fewer wrong guesses, and the SDK’s format reward adds 0.2.

Because the environment relies on `createToolGameEnvironment`, you get:

- Automatic rollout loop with tool-call handling.
- Optional sandbox integration without extra code.
- Drop-in reward/rubric wiring.
- Shared TypeScript + Python loading interfaces.

### Porting your own game

1. Implement a subclass (or plain object) with `setupState`, `onTurn`, and `isCompleted`.
2. Build or import an AI SDK agent config.
3. Provide reward functions and (optionally) a dataset generator.
4. Call `createToolGameEnvironment({ envId, agent, lifecycle, rewardFunction, ... })`.

Use the Hangman implementation as a template and replace only the domain-specific logic.
