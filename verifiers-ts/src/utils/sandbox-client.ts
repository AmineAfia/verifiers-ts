/**
 * Sandbox client interface and implementation for Prime Intellect sandboxes
 * 
 * This module provides an abstraction layer for sandbox operations.
 * Uses native TypeScript HTTP client to call Prime Intellect sandbox API.
 */

import { NativeSandboxClient } from "./native-sandbox-client.js";
import { getPrimeApiKey } from "./prime-config.js";

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

  /**
   * Wait for sandbox to be ready (provisioned and running)
   */
  waitForCreation(sandboxId: string): Promise<void>;
}


/**
 * Placeholder sandbox client implementation
 * 
 * This will throw helpful errors if API key is not available.
 */
export class PlaceholderSandboxClient implements SandboxClient {
  async createSandbox(config: SandboxConfig): Promise<Sandbox> {
    throw new Error(
      "Sandbox client not available. " +
      "Set PRIME_INTELLECT_API_KEY or PRIME_API_KEY environment variable, " +
      "or run 'prime login' to store credentials."
    );
  }

  async executeCommand(
    sandboxId: string,
    command: string
  ): Promise<CommandResult> {
    throw new Error(
      "Sandbox client not available. " +
      "Set PRIME_INTELLECT_API_KEY or PRIME_API_KEY environment variable, " +
      "or run 'prime login' to store credentials."
    );
  }

  async deleteSandbox(sandboxId: string): Promise<void> {
    throw new Error(
      "Sandbox client not available. " +
      "Set PRIME_INTELLECT_API_KEY or PRIME_API_KEY environment variable, " +
      "or run 'prime login' to store credentials."
    );
  }

  async waitForCreation(sandboxId: string): Promise<void> {
    throw new Error(
      "Sandbox client not available. " +
      "Set PRIME_INTELLECT_API_KEY or PRIME_API_KEY environment variable, " +
      "or run 'prime login' to store credentials."
    );
  }
}

/**
 * Initialize native sandbox client if API key is available
 * Checks environment variables and Prime CLI config file
 */
function initializeNativeClient(): SandboxClient | null {
  // Check environment variables and Prime CLI config
  const apiKey =
    process.env.PRIME_INTELLECT_API_KEY ||
    process.env.PRIME_API_KEY ||
    getPrimeApiKey();
  
  if (!apiKey) {
    return null;
  }

  try {
    return new NativeSandboxClient();
  } catch (error) {
    // If initialization fails, return null
    return null;
  }
}

/**
 * Get or create a default sandbox client instance
 * Uses native TypeScript client if API key is available
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
      const nativeClient = initializeNativeClient();
      if (nativeClient) {
        defaultClient = nativeClient;
        return nativeClient;
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

