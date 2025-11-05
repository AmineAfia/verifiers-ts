#!/usr/bin/env node

import { spawn, spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

type PackageJSON = {
  name?: string;
  verifiers?: {
    envId?: string;
    envDir?: string;
  };
};

type EnvPackage = {
  dir: string;
  manifest: PackageJSON;
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageRoot = path.resolve(__dirname, "..", "..");
const pythonBridgePath = path.resolve(packageRoot, "python-bridge");

const rawArgs = process.argv.slice(2);
let envIdFromArgs: string | undefined;
let forwardedArgs = rawArgs.slice();

if (forwardedArgs.length > 0 && !forwardedArgs[0].startsWith("-")) {
  envIdFromArgs = forwardedArgs[0];
  forwardedArgs = forwardedArgs.slice(1);
}

function safeReadJSON<T>(filePath: string): T | undefined {
  try {
    const content = fs.readFileSync(filePath, "utf8");
    return JSON.parse(content) as T;
  } catch {
    return undefined;
  }
}

function findEnvironmentPackage(startDir: string): EnvPackage | undefined {
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

const envPackage = findEnvironmentPackage(process.cwd());

function findPyproject(startDir: string): string | undefined {
  let current = path.resolve(startDir);
  const root = path.parse(current).root;
  while (true) {
    const candidate = path.join(current, "pyproject.toml");
    if (fs.existsSync(candidate)) {
      return current;
    }
    if (current === root) {
      break;
    }
    current = path.dirname(current);
  }
  return undefined;
}

const pythonCwd = findPyproject(process.cwd()) ?? process.cwd();

const envId =
  envIdFromArgs ??
  envPackage?.manifest?.verifiers?.envId ??
  envPackage?.manifest?.name;

if (!envId) {
  console.error(
    "Unable to determine environment id. Pass it explicitly (`vf-eval <env-id>`) or add `verifiers.envId` to your package.json."
  );
  process.exit(1);
}

function normaliseEnvDirArg(args: string[]): {
  args: string[];
  envDirPath?: string;
} {
  const updated = [...args];
  let value: string | undefined;

  for (let i = 0; i < updated.length; i += 1) {
    const arg = updated[i];
    if (arg === "--env-dir-path" || arg === "-p") {
      const next = updated[i + 1];
      if (next) {
        value = path.resolve(process.cwd(), next);
        updated[i + 1] = value;
      }
      continue;
    }
    if (arg.startsWith("--env-dir-path=")) {
      const [, rawValue] = arg.split("=", 2);
      if (rawValue) {
        value = path.resolve(process.cwd(), rawValue);
        updated[i] = `--env-dir-path=${value}`;
      }
      continue;
    }
  }

  return { args: updated, envDirPath: value };
}

const { args: normalisedArgs, envDirPath: envDirFromArgs } =
  normaliseEnvDirArg(forwardedArgs);
forwardedArgs = normalisedArgs;

let resolvedEnvDirPath = envDirFromArgs;

if (!resolvedEnvDirPath) {
  if (envPackage?.manifest?.verifiers?.envDir) {
    resolvedEnvDirPath = path.resolve(
      envPackage.dir,
      envPackage.manifest.verifiers.envDir
    );
  } else if (envPackage) {
    resolvedEnvDirPath = path.dirname(envPackage.dir);
  }

  if (resolvedEnvDirPath) {
    forwardedArgs.push("--env-dir-path", resolvedEnvDirPath);
  }
}

const pythonArgs = [envId, ...forwardedArgs];

const childEnv = { ...process.env };

if (resolvedEnvDirPath) {
  childEnv.VERIFIERS_ENV_DIR_PATH = resolvedEnvDirPath;
}

if (fs.existsSync(pythonBridgePath)) {
  const existing = process.env.PYTHONPATH;
  const candidates = [pythonBridgePath];
  if (existing) {
    candidates.push(existing);
  }
  childEnv.PYTHONPATH = candidates.join(path.delimiter);

  if (!childEnv.VERIFIERS_TS_BRIDGE_PATH) {
    childEnv.VERIFIERS_TS_BRIDGE_PATH = pythonBridgePath;
  }
}

if (!childEnv.UV_CACHE_DIR) {
  try {
    const defaultCache = path.join(pythonCwd, ".uv-cache");
    fs.mkdirSync(defaultCache, { recursive: true });
    childEnv.UV_CACHE_DIR = defaultCache;
  } catch (error) {
    if (process.env.VERIFIERS_TS_DEBUG) {
      console.warn(
        `[vf-eval] Failed to prepare UV cache directory: ${(error as Error).message}`
      );
    }
  }
}

if (!childEnv.UV_PYTHON_INSTALL_DIR) {
  try {
    const installDir = path.join(pythonCwd, ".uv-python");
    fs.mkdirSync(installDir, { recursive: true });
    childEnv.UV_PYTHON_INSTALL_DIR = installDir;
  } catch (error) {
    if (process.env.VERIFIERS_TS_DEBUG) {
      console.warn(
        `[vf-eval] Failed to prepare UV Python install dir: ${(error as Error).message}`
      );
    }
  }
}

function commandExists(command: string): boolean {
  try {
    const result = spawnSync(command, ["--version"], {
      stdio: "ignore",
    });
    return result.status === 0;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    return false;
  }
}

function resolvePythonCommand(): string {
  if (childEnv.PYTHON && commandExists(childEnv.PYTHON)) {
    return childEnv.PYTHON;
  }
  if (commandExists("python3")) {
    return "python3";
  }
  if (commandExists("python")) {
    return "python";
  }
  return childEnv.PYTHON ?? "python3";
}

function getVenvPythonPath(venvDir: string): string {
  return path.join(
    venvDir,
    process.platform === "win32" ? "Scripts" : "bin",
    process.platform === "win32" ? "python.exe" : "python"
  );
}

function hasLzmaSupport(pythonCommand: string): boolean {
  const check = spawnSync(
    pythonCommand,
    ["-c", "import lzma"],
    { stdio: "ignore", env: childEnv }
  );
  return check.status === 0;
}

function tryResolveUvPython(): string | undefined {
  if (!commandExists("uv")) {
    return undefined;
  }

  const find = spawnSync(
    "uv",
    ["python", "find", "--managed-python", "3.11"],
    { env: childEnv, encoding: "utf8" }
  );
  if (find.status === 0) {
    const candidate = find.stdout.trim();
    if (candidate && hasLzmaSupport(candidate)) {
      return candidate;
    }
  }

  const install = spawnSync(
    "uv",
    ["python", "install", "3.11"],
    { env: childEnv, stdio: "inherit" }
  );
  if (install.status !== 0) {
    return undefined;
  }

  const locate = spawnSync(
    "uv",
    ["python", "find", "--managed-python", "3.11"],
    { env: childEnv, encoding: "utf8" }
  );
  if (locate.status === 0) {
    const candidate = locate.stdout.trim();
    if (candidate && hasLzmaSupport(candidate)) {
      return candidate;
    }
  }

  return undefined;
}

function ensurePythonHasLzma(basePython: string): string {
  if (hasLzmaSupport(basePython)) {
    return basePython;
  }

  console.warn(
    `[vf-eval] Python interpreter "${basePython}" is missing lzma support.`
  );

  const uvPython = tryResolveUvPython();
  if (uvPython) {
    console.warn(`[vf-eval] Using uv-managed Python at ${uvPython}.`);
    return uvPython;
  }

  console.error(
    "[vf-eval] Unable to locate a Python interpreter with lzma support. " +
      "Reinstall Python with lzma enabled (e.g. `brew install xz` then `pyenv install --patch ...`) " +
      "or set VERIFIERS_TS_USE_UV=1 to let uv manage Python."
  );
  process.exit(1);
}

function ensurePythonEnvironment(basePython: string): string {
  const venvDir = path.join(pythonCwd, ".vf-eval");
  const venvPython = getVenvPythonPath(venvDir);

  if (!fs.existsSync(venvPython)) {
    const createVenv = spawnSync(basePython, ["-m", "venv", venvDir], {
      stdio: "inherit",
      env: childEnv,
    });
    if (createVenv.status !== 0) {
      throw new Error("Failed to create Python virtual environment for vf-eval.");
    }
  }

  const markerFile = path.join(venvDir, ".verifiers_ts_ready");
  if (!fs.existsSync(markerFile)) {
    const install = spawnSync(
      venvPython,
      ["-m", "pip", "install", "-e", "."],
      { stdio: "inherit", cwd: pythonCwd, env: childEnv }
    );
    if (install.status !== 0) {
      throw new Error("Failed to install Python dependencies for vf-eval.");
    }
    fs.writeFileSync(markerFile, "ok");
  }

  return venvPython;
}

const preferUv = process.env.VERIFIERS_TS_USE_UV === "1";

let pythonInvoker: { command: string; args: string[] };

if (preferUv && commandExists("uv")) {
  pythonInvoker = { command: "uv", args: ["run", "vf-eval"] };
} else {
  const basePython = ensurePythonHasLzma(resolvePythonCommand());
  let pythonCommand = basePython;
  try {
    pythonCommand = ensurePythonEnvironment(basePython);
  } catch (error) {
    console.warn(
      `[vf-eval] Failed to bootstrap managed Python env: ${(error as Error).message}. Falling back to system Python.`
    );
  }
  childEnv.PYTHON = pythonCommand;
  pythonInvoker = {
    command: pythonCommand,
    args: ["-m", "verifiers.scripts.eval"],
  };
}

if (process.env.VERIFIERS_TS_DEBUG) {
  console.log(
    `[vf-eval] spawning: ${pythonInvoker.command} ${[...pythonInvoker.args, ...pythonArgs].join(" ")}`
  );
  console.log(`[vf-eval] working directory: ${pythonCwd}`);
  if (resolvedEnvDirPath) {
    console.log(`[vf-eval] env dir: ${resolvedEnvDirPath}`);
  }
}

const child = spawn(pythonInvoker.command, [...pythonInvoker.args, ...pythonArgs], {
  stdio: "inherit",
  env: childEnv,
  cwd: pythonCwd,
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});

child.on("error", (error) => {
  console.error(`Failed to run ${pythonInvoker.command}: ${error.message}`);
  process.exit(1);
});
