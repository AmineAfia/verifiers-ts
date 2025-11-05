#!/usr/bin/env node

/**
 * Native TypeScript implementation of vf-eval CLI
 * Mirrors Python verifiers/scripts/eval.py functionality
 */

import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import type {
  Environment,
  GenerateOutputs,
  SamplingArgs,
} from "../index.js";
import { saveResultsToDisk, getResultsPath } from "../utils/eval-utils.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

type PackageJSON = {
  name?: string;
  verifiers?: {
    envId?: string;
    envDir?: string;
    entry?: string;
    eval?: {
      numExamples?: number;
      rolloutsPerExample?: number;
    };
  };
};

type CLIArgs = {
  envId: string;
  envArgs: Record<string, any>;
  envDirPath?: string;
  model: string;
  apiKeyVar: string;
  apiBaseUrl: string;
  headers: string[];
  numExamples?: number;
  rolloutsPerExample?: number;
  maxConcurrent: number;
  maxConcurrentGeneration?: number;
  maxConcurrentScoring?: number;
  maxTokens?: number;
  temperature?: number;
  samplingArgs?: SamplingArgs;
  verbose: boolean;
  noInterleaveScoring: boolean;
  stateColumns: string[];
  saveResults: boolean;
  saveEvery: number;
  saveToHfHub: boolean;
  hfHubDatasetName?: string;
};

function safeReadJSON<T>(filePath: string): T | undefined {
  try {
    const content = fs.readFileSync(filePath, "utf8");
    return JSON.parse(content) as T;
  } catch {
    return undefined;
  }
}

function findEnvironmentPackage(startDir: string): { dir: string; manifest: PackageJSON } | undefined {
  let current = path.resolve(startDir);
  const root = path.parse(current).root;
  while (true) {
    const candidate = path.join(current, "package.json");
    if (fs.existsSync(candidate)) {
      const manifest = safeReadJSON<PackageJSON>(candidate);
      if (manifest?.verifiers?.envId) {
        return { dir: current, manifest };
      }
    }
    if (current === root) {
      break;
    }
    current = path.dirname(current);
  }
  return undefined;
}

function parseHeader(headerStr: string): [string, string] {
  const colonIndex = headerStr.indexOf(":");
  if (colonIndex === -1) {
    throw new Error(`Invalid header format: ${headerStr}. Expected "Name: Value"`);
  }
  const name = headerStr.substring(0, colonIndex).trim();
  const value = headerStr.substring(colonIndex + 1).trim();
  return [name, value];
}

function parseCLIArgs(): CLIArgs {
  const args = process.argv.slice(2);
  let envId: string | undefined;
  const restArgs: string[] = [];

  // Extract env_id (first positional argument)
  if (args.length > 0 && !args[0].startsWith("-")) {
    envId = args[0];
    restArgs.push(...args.slice(1));
  } else {
    restArgs.push(...args);
  }

  // Find environment package to get defaults
  const envPackage = findEnvironmentPackage(process.cwd());
  const defaults = envPackage?.manifest?.verifiers?.eval || {};

  // Default values matching Python argparse defaults
  const parsed: CLIArgs = {
    envId: envId || envPackage?.manifest?.verifiers?.envId || envPackage?.manifest?.name || "",
    envArgs: {},
    envDirPath: undefined,
    model: "gpt-4.1-mini",
    apiKeyVar: "OPENAI_API_KEY",
    apiBaseUrl: "https://api.openai.com/v1",
    headers: [],
    numExamples: defaults.numExamples,
    rolloutsPerExample: defaults.rolloutsPerExample,
    maxConcurrent: 32,
    maxConcurrentGeneration: undefined,
    maxConcurrentScoring: undefined,
    maxTokens: undefined,
    temperature: undefined,
    samplingArgs: undefined,
    verbose: false,
    noInterleaveScoring: false,
    stateColumns: [],
    saveResults: false,
    saveEvery: -1,
    saveToHfHub: false,
    hfHubDatasetName: undefined,
  };

  // Parse arguments
  for (let i = 0; i < restArgs.length; i++) {
    const arg = restArgs[i];
    const next = restArgs[i + 1];

    if (arg === "--env-args" || arg === "-a") {
      if (next) {
        parsed.envArgs = JSON.parse(next);
        i++;
      }
    } else if (arg === "--env-dir-path" || arg === "-p") {
      if (next) {
        parsed.envDirPath = path.resolve(process.cwd(), next);
        i++;
      }
    } else if (arg.startsWith("--env-dir-path=")) {
      const [, value] = arg.split("=", 2);
      parsed.envDirPath = path.resolve(process.cwd(), value);
    } else if (arg === "--model" || arg === "-m") {
      if (next) {
        parsed.model = next;
        i++;
      }
    } else if (arg === "--api-key-var" || arg === "-k") {
      if (next) {
        parsed.apiKeyVar = next;
        i++;
      }
    } else if (arg === "--api-base-url" || arg === "-b") {
      if (next) {
        parsed.apiBaseUrl = next;
        i++;
      }
    } else if (arg === "--header") {
      if (next) {
        parsed.headers.push(next);
        i++;
      }
    } else if (arg === "--num-examples" || arg === "-n") {
      if (next) {
        parsed.numExamples = parseInt(next, 10);
        i++;
      }
    } else if (arg === "--rollouts-per-example" || arg === "-r") {
      if (next) {
        parsed.rolloutsPerExample = parseInt(next, 10);
        i++;
      }
    } else if (arg === "--max-concurrent" || arg === "-c") {
      if (next) {
        parsed.maxConcurrent = parseInt(next, 10);
        i++;
      }
    } else if (arg === "--max-concurrent-generation") {
      if (next) {
        parsed.maxConcurrentGeneration = parseInt(next, 10);
        i++;
      }
    } else if (arg === "--max-concurrent-scoring") {
      if (next) {
        parsed.maxConcurrentScoring = parseInt(next, 10);
        i++;
      }
    } else if (arg === "--max-tokens" || arg === "-t") {
      if (next) {
        parsed.maxTokens = parseInt(next, 10);
        i++;
      }
    } else if (arg === "--temperature" || arg === "-T") {
      if (next) {
        parsed.temperature = parseFloat(next);
        i++;
      }
    } else if (arg === "--sampling-args" || arg === "-S") {
      if (next) {
        parsed.samplingArgs = JSON.parse(next);
        i++;
      }
    } else if (arg === "--verbose" || arg === "-v") {
      parsed.verbose = true;
    } else if (arg === "--no-interleave-scoring" || arg === "-N") {
      parsed.noInterleaveScoring = true;
    } else if (arg === "--state-columns" || arg === "-C") {
      const columns: string[] = [];
      let j = i + 1;
      while (j < restArgs.length && !restArgs[j].startsWith("-")) {
        columns.push(restArgs[j]);
        j++;
      }
      parsed.stateColumns = columns;
      i = j - 1;
    } else if (arg === "--save-results" || arg === "-s") {
      parsed.saveResults = true;
    } else if (arg === "--save-every" || arg === "-f") {
      if (next) {
        parsed.saveEvery = parseInt(next, 10);
        i++;
      }
    } else if (arg === "--save-to-hf-hub" || arg === "-H") {
      parsed.saveToHfHub = true;
    } else if (arg === "--hf-hub-dataset-name" || arg === "-D") {
      if (next) {
        parsed.hfHubDatasetName = next;
        i++;
      }
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      console.error(`Unknown argument: ${arg}`);
      process.exit(1);
    }
  }

  if (!parsed.envId) {
    console.error(
      "Unable to determine environment id. Pass it explicitly (`vf-eval <env-id>`) or add `verifiers.envId` to your package.json."
    );
    process.exit(1);
  }

  return parsed;
}

function printHelp() {
  console.log(`
Usage: vf-eval <env-id> [OPTIONS]

Options:
  -a, --env-args JSON              Environment arguments as JSON object
  -p, --env-dir-path PATH         Path to environments directory
  -m, --model MODEL               Model name (default: gpt-4.1-mini)
  -k, --api-key-var VAR           API key environment variable (default: OPENAI_API_KEY)
  -b, --api-base-url URL          API base URL (default: https://api.openai.com/v1)
  --header NAME:VALUE             Extra HTTP header (repeatable)
  -n, --num-examples N            Number of examples to evaluate
  -r, --rollouts-per-example N    Number of rollouts per example
  -c, --max-concurrent N          Max concurrent requests (default: 32)
  --max-concurrent-generation N   Max concurrent generation requests
  --max-concurrent-scoring N      Max concurrent scoring requests
  -t, --max-tokens N              Maximum tokens to generate
  -T, --temperature FLOAT         Temperature for sampling
  -S, --sampling-args JSON        Sampling arguments as JSON object
  -v, --verbose                   Verbose output
  -N, --no-interleave-scoring     Disable interleaving of scoring
  -C, --state-columns COL ...      State columns to save
  -s, --save-results              Save results to disk
  -f, --save-every N              Save every N rollouts
  -H, --save-to-hf-hub            Save to Hugging Face Hub
  -D, --hf-hub-dataset-name NAME  Hugging Face dataset name
  -h, --help                      Show this help message
`);
}

async function loadEnvironment(
  envId: string,
  envDirPath?: string,
  envArgs: Record<string, any> = {}
): Promise<Environment> {
  // If envDirPath is provided, load from that directory
  if (envDirPath) {
    const envPath = path.join(envDirPath, envId);
    const packageJsonPath = path.join(envPath, "package.json");

    if (fs.existsSync(packageJsonPath)) {
      const manifest = safeReadJSON<PackageJSON>(packageJsonPath);
      const entry = manifest?.verifiers?.entry || "./dist/index.js";
      const entryPath = path.resolve(envPath, entry);

      if (fs.existsSync(entryPath)) {
        // Use pathToFileURL for proper ESM import handling (cross-platform)
        const resolvedPath = path.resolve(entryPath);
        const entryUrl = pathToFileURL(resolvedPath).href;
        const module = await import(entryUrl);
        if (typeof module.loadEnvironment === "function") {
          return await module.loadEnvironment(envArgs);
        }
        throw new Error(`Module ${entryPath} does not export loadEnvironment function`);
      }
      throw new Error(`Entry point not found: ${entryPath}. Run 'pnpm build' to build the environment.`);
    }
  }

  // Try loading from current directory (standalone project)
  const envPackage = findEnvironmentPackage(process.cwd());
  if (envPackage && envPackage.manifest.verifiers?.envId === envId) {
    const entry = envPackage.manifest.verifiers?.entry || "./dist/index.js";
    const entryPath = path.resolve(envPackage.dir, entry);

    if (fs.existsSync(entryPath)) {
      // Use pathToFileURL for proper ESM import handling (cross-platform)
      const resolvedPath = path.resolve(entryPath);
      const entryUrl = pathToFileURL(resolvedPath).href;
      const module = await import(entryUrl);
      if (typeof module.loadEnvironment === "function") {
        return await module.loadEnvironment(envArgs);
      }
      throw new Error(`Module ${entryPath} does not export loadEnvironment function`);
    }
    throw new Error(`Entry point not found: ${entryPath}. Run 'pnpm build' to build the environment.`);
  }

  throw new Error(
    `Could not find environment "${envId}". Ensure the environment is built and the entry point exists.`
  );
}

function buildSamplingArgs(args: CLIArgs): SamplingArgs {
  const sampling: SamplingArgs = { ...args.samplingArgs };

  if (args.maxTokens !== undefined) {
    sampling.max_tokens = args.maxTokens;
  }
  if (args.temperature !== undefined) {
    sampling.temperature = args.temperature;
  }

  return sampling;
}

function printResults(results: GenerateOutputs, numSamples: number = 1) {
  const n = results.prompt.length;
  const uniqueExamples = new Set(results.example_id).size;

  console.log(`\nEvaluation Results:`);
  console.log(`Total rollouts: ${n}`);
  console.log(`Unique examples: ${uniqueExamples}`);
  console.log(`Average reward: ${results.metadata.avg_reward.toFixed(4)}`);

  if (Object.keys(results.metadata.avg_metrics).length > 0) {
    console.log(`\nAverage metrics:`);
    for (const [key, value] of Object.entries(results.metadata.avg_metrics)) {
      console.log(`  ${key}: ${value.toFixed(4)}`);
    }
  }

  // Group by example_id and show rollouts
  if (numSamples > 0 && uniqueExamples > 0) {
    const examplesShown = Math.min(numSamples, uniqueExamples);
    const exampleIds = Array.from(new Set(results.example_id)).slice(0, examplesShown);

    console.log(`\nExample rollouts (showing ${examplesShown} of ${uniqueExamples}):`);
    for (const exampleId of exampleIds) {
      const indices = results.example_id
        .map((id, idx) => (id === exampleId ? idx : -1))
        .filter((idx) => idx !== -1);

      const trials = indices.map((idx) => {
        const reward = results.reward[idx];
        const metrics = Object.fromEntries(
          Object.entries(results.metrics).map(([key, values]) => [key, values[idx]])
        );
        return { reward, metrics };
      });

      const trialsStr = trials
        .map((t, i) => `r${i + 1}: reward=${t.reward.toFixed(4)} ${Object.entries(t.metrics).map(([k, v]) => `${k}=${v.toFixed(4)}`).join(" ")}`)
        .join(", ");

      console.log(`Example ${exampleId}: ${trialsStr}`);
    }
  }
}

async function runEvaluation(args: CLIArgs): Promise<void> {
  const startTime = Date.now();

  // Get API key from environment and set it if not already set
  let apiKey = process.env[args.apiKeyVar];
  if (!apiKey) {
    console.error(`API key not found in environment variable ${args.apiKeyVar}`);
    console.error(`Please set ${args.apiKeyVar} environment variable or use --api-key-var to specify a different variable.`);
    process.exit(1);
  }
  // Ensure the API key is available for the AI SDK
  if (!process.env[args.apiKeyVar]) {
    process.env[args.apiKeyVar] = apiKey;
  }

  // Build extra headers
  const extraHeaders: Record<string, string> = {};
  for (const headerStr of args.headers) {
    const [name, value] = parseHeader(headerStr);
    extraHeaders[name] = value;
  }

  // Determine env_dir_path
  let resolvedEnvDirPath = args.envDirPath;
  if (!resolvedEnvDirPath) {
    const envPackage = findEnvironmentPackage(process.cwd());
    if (envPackage) {
      const manifestEnvDir = envPackage.manifest.verifiers?.envDir;
      if (manifestEnvDir) {
        resolvedEnvDirPath = path.resolve(envPackage.dir, manifestEnvDir);
      } else {
        // For standalone projects, the project root IS the environment
        const parentDir = path.dirname(envPackage.dir);
        const envDirCandidates: string[] = [];
        if (args.envId) {
          envDirCandidates.push(path.join(parentDir, args.envId));
          envDirCandidates.push(path.join(parentDir, args.envId.replace(/-/g, "_")));
        }
        const matchingParent = envDirCandidates.find((candidate) =>
          fs.existsSync(candidate)
        );
        resolvedEnvDirPath = matchingParent ? parentDir : envPackage.dir;
      }
    }
  }

  if (args.verbose) {
    console.log(`Loading environment: ${args.envId}`);
    if (resolvedEnvDirPath) {
      console.log(`Environment directory: ${resolvedEnvDirPath}`);
    }
  }

  // Load environment
  const env = await loadEnvironment(args.envId, resolvedEnvDirPath, args.envArgs);

  // Build sampling args
  const samplingArgs = buildSamplingArgs(args);

  // Get defaults from package.json if not provided
  const envPackageForDefaults = findEnvironmentPackage(process.cwd());
  const defaults = envPackageForDefaults?.manifest.verifiers?.eval || {};
  const numExamples: number = args.numExamples ?? defaults.numExamples ?? -1;
  const rolloutsPerExample: number = args.rolloutsPerExample ?? defaults.rolloutsPerExample ?? 1;

  if (args.verbose) {
    console.log(`Starting evaluation with model: ${args.model}`);
    console.log(
      `Configuration: num_examples=${numExamples}, rollouts_per_example=${rolloutsPerExample}, max_concurrent=${args.maxConcurrent}`
    );
  }

  // Determine results path
  let resultsPath: string | undefined;
  if (args.saveResults || args.saveEvery > 0) {
    resultsPath = getResultsPath(args.envId, args.model);
  }

  // Run evaluation
  // Note: TypeScript Environment.evaluate doesn't accept apiKey/baseUrl directly
  // Instead, these should be set via environment variables or AI SDK config
  // For now, we'll rely on the OPENAI_API_KEY env var being set
  const results = await env.evaluate(
    args.model,
    samplingArgs,
    numExamples,
    rolloutsPerExample,
    true, // scoreRollouts
    args.maxConcurrent,
    args.maxConcurrentGeneration,
    args.maxConcurrentScoring,
    apiKey, // Pass API key
    args.apiBaseUrl // Pass base URL
  );

  const endTime = Date.now();
  const durationSeconds = (endTime - startTime) / 1000;

  // Update metadata with timing
  results.metadata.time_ms = endTime - startTime;
  results.metadata.date = new Date().toISOString().replace("T", " ").substring(0, 19);

  if (args.verbose) {
    console.log(`Evaluation completed in ${durationSeconds.toFixed(2)} seconds`);
  }

  // Print results
  printResults(results, args.verbose ? 10 : 5);

  // Save results if requested
  if (args.saveResults && resultsPath) {
    await saveResultsToDisk(results, resultsPath);
    console.log(`\nResults saved to: ${resultsPath}`);
  }

  // TODO: Implement HuggingFace Hub upload if args.saveToHfHub
  if (args.saveToHfHub) {
    console.warn("HuggingFace Hub upload not yet implemented");
  }
}

async function main() {
  try {
    const args = parseCLIArgs();
    await runEvaluation(args);
  } catch (error) {
    console.error(`Error: ${(error as Error).message}`);
    if (process.env.VERIFIERS_TS_DEBUG) {
      console.error((error as Error).stack);
    }
    // Flush output streams before exiting
    process.stdout.write("");
    process.stderr.write("");
    process.exit(1);
  }
}

// Ensure unhandled promise rejections cause process to exit
main().catch((error) => {
  console.error(`Unhandled error: ${(error as Error).message}`);
  if (process.env.VERIFIERS_TS_DEBUG) {
    console.error((error as Error).stack);
  }
  // Flush output streams before exiting
  process.stdout.write("");
  process.stderr.write("");
  process.exit(1);
});

// Handle unhandled promise rejections globally
process.on("unhandledRejection", (reason, promise) => {
  const errorMessage = reason instanceof Error ? reason.message : String(reason);
  console.error("Unhandled promise rejection:", errorMessage);
  // Use setTimeout to ensure output is flushed before exit
  setTimeout(() => {
    process.exit(1);
  }, 100);
});

