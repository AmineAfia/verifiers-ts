# Example: GenerateText Agent Environment

This example demonstrates how to easily create an RL environment using `createRLEnvironment` with a `generateText` configuration object.

## Workflow

1. **Create tools** using AI SDK's `tool()` function
2. **Create agent config** - a `generateText` configuration object (without messages/prompt)
3. **Load dataset** from array or file
4. **Create environment** with one function call using `createRLEnvironment()`
5. **Evaluate and train!**

## Example Code

```typescript
import { openai } from "@ai-sdk/openai";
import { tool, stepCountIs } from "ai";
import { z } from "zod";
import { createRLEnvironment, loadDataset } from "verifiers-ts";

// 1. Create tools
const weatherTool = tool({
  description: "Get the current weather",
  parameters: z.object({ location: z.string() }),
  execute: async ({ location }) => getWeather(location),
});

// 2. Create agent config
const myAgent = {
  model: openai("gpt-4o"),
  system: "You are a helpful assistant.",
  tools: { weather: weatherTool },
  stopWhen: stepCountIs(10),
};

// 3. Create environment
const env = await createRLEnvironment({
  agent: myAgent,
  dataset: await loadDataset({ source: "file", path: "./data.jsonl" }),
  rewardFunction: (result) => checkCorrectness(result.text, result.answer),
});

// 4. Evaluate!
const results = await env.evaluate("gpt-4o", {}, 100);
```

## Key Benefits

- **No architecture learning curve** - just use generateText configs you already know
- **Direct message compatibility** - Messages arrays work directly
- **Native tool support** - Use AI SDK's tool() function directly
- **Built-in tool loop** - stopWhen controls multi-step execution
- **Full control** - All generateText options available

## Running with vf-eval

This environment can be run using the `vf-eval` CLI tool, just like Python environments.

### Installation

1. **Build TypeScript code**:
   ```bash
   cd verifiers-ts/environments/example-generate-text-agent
   npm install
   npm run build
   ```

2. **Install Python package**:
   ```bash
   uv pip install -e .
   ```

### Usage

Run evaluation with vf-eval:

```bash
vf-eval example-generate-text-agent -n 3 -r 1
```

Options:
- `-n 3`: Evaluate 3 examples
- `-r 1`: 1 rollout per example
- `-m gpt-4o-mini`: Specify model (default: gpt-4.1-mini)
- `-s`: Save results to disk

### Direct Python Usage

You can also use it directly from Python:

```python
import verifiers as vf
from openai import AsyncOpenAI

env = vf.load_environment("example-generate-text-agent")
results = await env.evaluate(
    client=AsyncOpenAI(),
    model="gpt-4o-mini",
    num_examples=3
)
```

