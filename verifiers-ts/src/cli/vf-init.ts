#!/usr/bin/env node

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const verifiersPackageJson = require("../../package.json") as { version?: string };

type ScaffoldMode = "single-turn" | "minimal-rl";

type ScaffoldOptions = {
  envName: string;
  targetDir: string;
  mode: ScaffoldMode;
};

function toPascalCase(value: string): string {
  return value
    .replace(/[-_]+/g, " ")
    .replace(/[^\w\s]/g, "")
    .split(" ")
    .filter(Boolean)
    .map((segment) => segment[0].toUpperCase() + segment.slice(1))
    .join("");
}

function ensureEmptyDir(dir: string) {
  if (fs.existsSync(dir)) {
    if (fs.statSync(dir).isDirectory() && fs.readdirSync(dir).length === 0) {
      return;
    }
    console.error(`Target directory already exists: ${dir}`);
    process.exit(1);
  }
  fs.mkdirSync(dir, { recursive: true });
}

function writeFile(filePath: string, contents: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents, { encoding: "utf8" });
}

const CLI_DIR = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(CLI_DIR, "..");
const WORKSPACE_MARKER = path.resolve(PACKAGE_ROOT, "../pnpm-workspace.yaml");

const CORE_PACKAGE_NAME = "verifiers-ts";
const CORE_VERSION = typeof verifiersPackageJson?.version === "string"
  ? verifiersPackageJson.version
  : "0.0.1";
const CORE_VERSION_RANGE = fs.existsSync(WORKSPACE_MARKER)
  ? "workspace:*"
  : `^${CORE_VERSION}`;

function createPackageJson({ envName, mode }: ScaffoldOptions, pascalName: string): string {
  const packageJson = {
    name: envName,
    version: "0.1.0",
    type: "module",
    main: "./dist/index.js",
    types: "./dist/index.d.ts",
    scripts: {
      build: "tsc",
      dev: "tsc --watch",
      test: "echo \"no tests yet\"",
      lint: "echo \"no lint configured\"",
      format: "echo \"use repo root formatter\"",
      "vf-eval": `node ./node_modules/${CORE_PACKAGE_NAME}/dist/cli/vf-eval.js`
    },
    dependencies: {
      [CORE_PACKAGE_NAME]: CORE_VERSION_RANGE,
      ...(mode === "minimal-rl"
        ? {
            ai: "^5.0.86",
            zod: "^3.25.6",
            "@ai-sdk/openai": "^2.0.59"
          }
        : {})
    },
    devDependencies: {
      "@types/node": "^20.0.0",
      typescript: "^5.3.0"
    },
    verifiers: {
      envId: envName,
      entry: "./dist/index.js",
      eval: {
        numExamples: 5,
        rolloutsPerExample: 1
      }
    }
  } as const;

  return `${JSON.stringify(packageJson, null, 2)}\n`;
}

function createTsConfig(): string {
  const config = {
    compilerOptions: {
      target: "ES2022",
      module: "ESNext",
      moduleResolution: "bundler",
      lib: ["ES2022"],
      rootDir: "./src",
      outDir: "./dist",
      strict: true,
      esModuleInterop: true,
      skipLibCheck: true,
      resolveJsonModule: true,
      isolatedModules: true,
      allowSyntheticDefaultImports: true,
      declaration: true,
      declarationMap: true,
      sourceMap: true,
      types: ["node"]
    },
    include: ["src/**/*"],
    exclude: ["dist", "node_modules"]
  } as const;

  return `${JSON.stringify(config, null, 2)}\n`;
}

function createSingleTurnIndex(envName: string, pascalName: string): string {
  return `import { Rubric, SingleTurnEnv } from "verifiers-ts";

type Example = {
  prompt: { role: "user"; content: string }[];
  answer: string;
};

const examples: Example[] = [
  {
    prompt: [{ role: "user", content: "Replace this prompt with your task." }],
    answer: "Expected answer",
  },
];

const rubric = new Rubric({
  funcs: [({ completion, answer }) => (serialize(completion).includes(answer) ? 1 : 0)],
  weights: [1],
});

function serialize(completion: unknown): string {
  if (typeof completion === "string") {
    return completion;
  }
  if (Array.isArray(completion)) {
    return completion
      .map((msg) => (typeof msg === "object" && msg && "content" in msg ? String((msg as any).content ?? "") : ""))
      .join(" ");
  }
  return "";
}

export async function create${pascalName}Environment() {
  return new SingleTurnEnv({
    envId: "${envName}",
    dataset: examples,
    systemPrompt: "Answer the question accurately.",
    rubric,
  });
}

export const loadEnvironment = create${pascalName}Environment;
`;
}

function createMinimalRLIndex(envName: string): string {
  return `import {
  createRLEnvironment,
  type GenerateTextAgent,
  type RewardFunc,
  type Messages,
  type State,
} from "verifiers-ts";
import { generateText, tool, type CoreMessage } from "ai";
import { z } from "zod";
import { openai } from "@ai-sdk/openai";

const getCurrentWeather = tool({
  description: "Get the current weather for a specific location.",
  inputSchema: z.object({
    location: z.string().describe("City and state, for example: Seattle, WA"),
    preferredUnit: z.enum(["celsius", "fahrenheit"]).default("celsius").describe("Temperature unit to return."),
  }),
  async execute({ location, preferredUnit }: { location: string; preferredUnit: "celsius" | "fahrenheit" }) {
    const temperatureC = 18;
    const temperature = preferredUnit === "celsius" ? temperatureC : temperatureC * 1.8 + 32;
    const unitLabel = preferredUnit === "celsius" ? "°C" : "°F";
    return \`It is \${temperature} \${unitLabel} and sunny in \${location}.\`;
  },
});

const weatherAgent: GenerateTextAgent = {
  generateText: (messages: CoreMessage[], options: Record<string, unknown> = {}) => {
    const { tools, ...rest } = options as { tools?: Record<string, unknown> };
    return generateText({
      model: openai("gpt-4o-mini") as any,
      system:
        "You are WeatherBot. When a user asks about the weather, call the getCurrentWeather tool and report the results clearly.",
      temperature: 0,
      messages,
      ...(tools ? { tools: { getCurrentWeather, ...tools } } : { tools: { getCurrentWeather } }),
      ...rest,
    });
  },
  tools: { getCurrentWeather },
};

type DatasetExample = {
  prompt: { role: "user"; content: string }[];
  answer: string;
};

const dataset: DatasetExample[] = [
  {
    prompt: [
      {
        role: "user",
        content: "What's the weather like in Seattle right now?",
      },
    ],
    answer: "seattle",
  },
];

// Simple reward function that checks if the completion mentions the answer
const rewardFunction: RewardFunc = async (
  completion: Messages,
  answer: string,
  state: State
): Promise<number> => {
  // Convert completion to text for comparison
  const completionText = Array.isArray(completion)
    ? completion
        .map((m) => (typeof m === "string" ? m : m.content || ""))
        .join(" ")
        .toLowerCase()
    : String(completion).toLowerCase();
  
  const answerLower = answer.toLowerCase();
  
  // Reward 1.0 if answer is mentioned, 0.0 otherwise
  return completionText.includes(answerLower) ? 1.0 : 0.0;
};

export async function loadEnvironment() {
  return createRLEnvironment({
    agent: weatherAgent,
    dataset,
    rewardFunction,
    sandbox: { enabled: true },
  });
}
`;
}

function createReadme(envName: string, pascalName: string, mode: ScaffoldMode): string {
  if (mode === "minimal-rl") {
    return `# ${pascalName} Environment

Scaffold generated by verifiers-ts using the minimal RL template. It includes:

- An AI SDK agent with a tool
- A tiny dataset array (replace with your own)
- A simple reward function that checks completion text
- Sandbox support enabled by default

## Quick start

\`\`\`bash
cd ${envName}
pnpm install
pnpm build
pnpm vf-eval -n 1 -r 1 -s
\`\`\`

Set \`OPENAI_API_KEY\` (or pass \`--api-key\` to \`vf-eval\`) before running evaluations.

The \`-s\` flag saves results to \`outputs/\` for later exploration.

## Exploring Results

After running evaluations, browse the results interactively:

\`\`\`bash
pnpm vf-tui
\`\`\`

This opens an interactive terminal UI where you can:
- Navigate through evaluation runs
- View prompts, completions, and rewards
- Compare different runs and models
- Drill down into individual examples

Results are automatically saved when using the \`-s\` flag with \`vf-eval\`.

## Next steps

1. Swap the dataset prompt/answer with your task.
2. Refine the reward function to match your evaluation criteria (check completion text, tool usage, or state).
3. Add additional tools or customize the agent as needed.
4. Run evaluations with sandbox: \`pnpm vf-eval -n 5 -r 3 -s\` (ensure you're logged in with \`prime login\`).
`;
  }

  return `# ${pascalName} Environment

Scaffold generated by verifiers-ts. Update the prompt, dataset, and rewards to fit your task.

## Quick start

\`${envName}\` ships with basic TypeScript tooling:

\`\`\`bash
cd ${envName}
pnpm install
pnpm build
pnpm vf-eval -n 1 -r 1
\`\`\`

## Next steps

1. Replace the placeholder dataset in src/index.ts.
2. Customize the reward functions and rubric weights.
3. Add tools, multi-turn lifecycles, or custom agents as needed.
`;
}

function createIndexTs(options: ScaffoldOptions, pascalName: string): string {
  if (options.mode === "minimal-rl") {
    return createMinimalRLIndex(options.envName);
  }
  return createSingleTurnIndex(options.envName, pascalName);
}

function scaffold(options: ScaffoldOptions) {
  const pascalName = toPascalCase(options.envName);
  ensureEmptyDir(options.targetDir);

  writeFile(
    path.join(options.targetDir, "package.json"),
    createPackageJson(options, pascalName)
  );
  writeFile(path.join(options.targetDir, "tsconfig.json"), createTsConfig());
  writeFile(path.join(options.targetDir, "README.md"), createReadme(options.envName, pascalName, options.mode));
  writeFile(
    path.join(options.targetDir, "src", "index.ts"),
    createIndexTs(options, pascalName)
  );
}

function main() {
  const rawArgs = process.argv.slice(2);
  if (rawArgs.length === 0) {
    console.error("Usage: vf-init <env-name> [--minimal-rl]");
    process.exit(1);
  }

  let envName: string | null = null;
  const flags = new Set<string>();
  for (const arg of rawArgs) {
    if (arg.startsWith("--")) {
      flags.add(arg);
      continue;
    }
    if (!envName) {
      envName = arg;
    } else {
      console.error(`Unexpected argument: ${arg}`);
      process.exit(1);
    }
  }

  if (!envName) {
    console.error("Environment name is required.");
    process.exit(1);
  }

  const safeName = envName.trim();
  if (!safeName) {
    console.error("Environment name cannot be empty");
    process.exit(1);
  }

  const targetDir = path.resolve(process.cwd(), safeName);
  const mode: ScaffoldMode =
    flags.has("--minimal-rl") || flags.has("--minimal") ? "minimal-rl" : "single-turn";

  scaffold({ envName: safeName, targetDir, mode });

  console.log(`Created TypeScript environment scaffold at ${targetDir}`);
  console.log("Next steps: pnpm install && pnpm build && pnpm vf-eval -n 1 -r 1");
  if (mode === "minimal-rl") {
    console.log("Tip: export OPENAI_API_KEY before running vf-eval.");
  }
}

main();
