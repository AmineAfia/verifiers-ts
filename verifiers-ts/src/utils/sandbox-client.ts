/**
 * Sandbox client interface and implementation for Prime Intellect sandboxes
 * 
 * This module provides an abstraction layer for sandbox operations.
 * Supports Python bridge to prime-sandboxes library.
 */

import { spawn, execSync } from "child_process";
import * as fs from "fs/promises";
import * as path from "path";
import { fileURLToPath } from "url";

export interface SandboxConfig {
  name?: string;
  dockerImage?: string;
  startCommand?: string;
  cpuCores?: number;
  memoryGb?: number;
  diskSizeGb?: number;
  gpuCount?: number;
  timeoutMinutes?: number;
  environmentVars?: Record<string, string>;
  teamId?: string;
  advancedConfigs?: Record<string, any>;
}

export interface Sandbox {
  id: string;
}

export interface CommandResult {
  stdout: string;
  stderr: string;
}

/**
 * Abstract interface for sandbox client operations
 */
export interface SandboxClient {
  /**
   * Create a new sandbox instance
   */
  createSandbox(config: SandboxConfig): Promise<Sandbox>;

  /**
   * Execute a command in a sandbox
   */
  executeCommand(
    sandboxId: string,
    command: string
  ): Promise<CommandResult>;

  /**
   * Delete a sandbox instance
   */
  deleteSandbox(sandboxId: string): Promise<void>;
}

/**
 * Python bridge sandbox client that calls prime-sandboxes via Python script
 */
export class PythonSandboxClient implements SandboxClient {
  private pythonPath: string;
  private bridgeScriptPath: string;

  constructor(pythonPath: string, bridgeScriptPath: string) {
    this.pythonPath = pythonPath;
    this.bridgeScriptPath = bridgeScriptPath;
  }

  private async callPython(
    method: string,
    args: Record<string, any>
  ): Promise<any> {
    return new Promise((resolve, reject) => {
      const command = {
        method,
        ...args,
      };

      const pythonProcess = spawn(this.pythonPath, [this.bridgeScriptPath], {
        stdio: ["pipe", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";

      pythonProcess.stdout.on("data", (data) => {
        stdout += data.toString();
      });

      pythonProcess.stderr.on("data", (data) => {
        stderr += data.toString();
      });

      pythonProcess.on("error", (error) => {
        reject(
          new Error(
            `Failed to spawn Python process: ${error.message}\n` +
              `Python path: ${this.pythonPath}\n` +
              `Bridge script: ${this.bridgeScriptPath}`
          )
        );
      });

      pythonProcess.on("close", (code) => {
        if (code !== 0) {
          // Try to parse error from stderr
          try {
            const errorData = JSON.parse(stderr.trim());
            reject(
              new Error(
                `Python sandbox bridge error: ${errorData.error || stderr}`
              )
            );
          } catch {
            reject(
              new Error(
                `Python sandbox bridge failed with code ${code}.\n` +
                  `Stderr: ${stderr || "(no error output)"}`
              )
            );
          }
          return;
        }

        // Parse JSON response
        try {
          const result = JSON.parse(stdout.trim());
          resolve(result);
        } catch (error) {
          reject(
            new Error(
              `Failed to parse Python bridge response: ${error}\n` +
                `Stdout: ${stdout}\n` +
                `Stderr: ${stderr}`
            )
          );
        }
      });

      // Send command to Python process
      pythonProcess.stdin.write(JSON.stringify(command));
      pythonProcess.stdin.end();
    });
  }

  async createSandbox(config: SandboxConfig): Promise<Sandbox> {
    const result = await this.callPython("create", { config });
    return { id: result.id };
  }

  async executeCommand(
    sandboxId: string,
    command: string
  ): Promise<CommandResult> {
    const result = await this.callPython("execute", {
      sandbox_id: sandboxId,
      command,
    });
    return {
      stdout: result.stdout || "",
      stderr: result.stderr || "",
    };
  }

  async deleteSandbox(sandboxId: string): Promise<void> {
    await this.callPython("delete", { sandbox_id: sandboxId });
  }
}

/**
 * Placeholder sandbox client implementation
 * 
 * This will throw helpful errors if prime-sandboxes is not available.
 */
export class PlaceholderSandboxClient implements SandboxClient {
  async createSandbox(config: SandboxConfig): Promise<Sandbox> {
    throw new Error(
      "Sandbox client not available. " +
      "To use sandboxes, install prime-sandboxes: pip install prime-sandboxes"
    );
  }

  async executeCommand(
    sandboxId: string,
    command: string
  ): Promise<CommandResult> {
    throw new Error(
      "Sandbox client not available. " +
      "Cannot execute command in sandbox without prime-sandboxes."
    );
  }

  async deleteSandbox(sandboxId: string): Promise<void> {
    throw new Error(
      "Sandbox client not available. " +
      "Cannot delete sandbox without prime-sandboxes."
    );
  }
}

/**
 * Find Python executable path
 */
async function findPythonPath(): Promise<string | null> {
  // Check environment variables first
  const pythonEnv = process.env.PYTHON_PATH || process.env.PYTHON;
  if (pythonEnv) {
    try {
      await fs.access(pythonEnv);
      return pythonEnv;
    } catch {
      // Path doesn't exist, continue searching
    }
  }

  // Try common Python executable names
  const pythonNames = ["python3", "python"];
  for (const pythonName of pythonNames) {
    try {
      // Check if command exists by trying to get version
      execSync(`${pythonName} --version`, { stdio: "ignore" });
      return pythonName;
    } catch {
      // Command not found, try next
    }
  }

  return null;
}

/**
 * Find bridge script path
 */
async function findBridgeScriptPath(): Promise<string> {
  // Try to resolve relative to package root
  // In development: verifiers-ts/python-bridge/sandbox_bridge.py
  // In installed package: node_modules/verifiers-ts/python-bridge/sandbox_bridge.py
  
  // Get current file's directory
  const currentFile = fileURLToPath(import.meta.url);
  const currentDir = path.dirname(currentFile);
  
  // Go up from src/utils to package root, then to python-bridge
  const packageRoot = path.resolve(currentDir, "../../");
  const bridgePath = path.join(packageRoot, "python-bridge", "sandbox_bridge.py");
  
  // Check if file exists
  try {
    await fs.access(bridgePath);
    return bridgePath;
  } catch {
    // File doesn't exist, but return path anyway (will fail with helpful error)
    return bridgePath;
  }
}

/**
 * Check if prime-sandboxes is available in Python
 */
async function checkPrimeSandboxesAvailable(
  pythonPath: string
): Promise<boolean> {
  try {
    // Try to import prime_sandboxes and check if it works
    const checkScript = `
import sys
try:
    import prime_sandboxes
    sys.exit(0)
except ImportError:
    sys.exit(1)
`;
    execSync(`${pythonPath} -c "${checkScript}"`, {
      stdio: "ignore",
      timeout: 5000,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Initialize Python sandbox client if available
 */
async function initializePythonClient(): Promise<SandboxClient | null> {
  const pythonPath = await findPythonPath();
  if (!pythonPath) {
    return null;
  }

  const bridgeScriptPath = await findBridgeScriptPath();
  
  // Check if bridge script exists
  try {
    await fs.access(bridgeScriptPath);
  } catch {
    // Bridge script not found
    return null;
  }

  // Check if prime-sandboxes is available
  const available = await checkPrimeSandboxesAvailable(pythonPath);
  if (!available) {
    return null;
  }

  return new PythonSandboxClient(pythonPath, bridgeScriptPath);
}

/**
 * Get or create a default sandbox client instance
 * Auto-detects Python bridge if prime-sandboxes is available
 */
let defaultClient: SandboxClient | null = null;
let initializationPromise: Promise<SandboxClient> | null = null;

export async function getSandboxClient(): Promise<SandboxClient> {
  if (defaultClient) {
    return defaultClient;
  }

  // Initialize lazily
  if (!initializationPromise) {
    initializationPromise = (async () => {
      const pythonClient = await initializePythonClient();
      if (pythonClient) {
        defaultClient = pythonClient;
        return pythonClient;
      }
      
      // Fallback to placeholder
      defaultClient = new PlaceholderSandboxClient();
      return defaultClient;
    })();
  }

  return initializationPromise;
}

/**
 * Set a custom sandbox client implementation
 */
export function setSandboxClient(client: SandboxClient): void {
  defaultClient = client;
  initializationPromise = null; // Reset so next call uses this client
}

