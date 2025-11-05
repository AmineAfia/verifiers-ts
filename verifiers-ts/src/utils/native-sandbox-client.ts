/**
 * Native TypeScript implementation of Prime Intellect sandbox client
 * Directly calls the Prime Intellect sandbox API via HTTP
 */

import type { SandboxClient, SandboxConfig, Sandbox, CommandResult } from "./sandbox-client.js";
import { getPrimeApiKey, getPrimeBaseUrl, getPrimeTeamId } from "./prime-config.js";

export class NativeSandboxClient implements SandboxClient {
  private apiKey: string;
  private baseUrl: string;
  private teamId?: string;

  constructor(apiKey?: string, baseUrl?: string, teamId?: string) {
    // Get API key from parameter, environment variables, or Prime CLI config
    this.apiKey =
      apiKey ||
      process.env.PRIME_INTELLECT_API_KEY ||
      process.env.PRIME_API_KEY ||
      getPrimeApiKey() ||
      "";

    if (!this.apiKey) {
      throw new Error(
        "Prime Intellect API key not found. " +
          "Set PRIME_INTELLECT_API_KEY or PRIME_API_KEY environment variable, " +
          "run 'prime login' to store credentials, " +
          "or pass apiKey to NativeSandboxClient constructor."
      );
    }

    // Get base URL from parameter, environment, Prime CLI config, or use default
    // According to OpenAPI spec, sandbox endpoints are at /api/v1/sandbox (singular)
    const rawBaseUrl =
      baseUrl ||
      process.env.PRIME_INTELLECT_API_URL ||
      getPrimeBaseUrl() ||
      "https://api.primeintellect.ai";
    
    // Ensure base URL doesn't have trailing slash
    this.baseUrl = rawBaseUrl.replace(/\/$/, "");

    // Get team ID from parameter, environment, or Prime CLI config
    this.teamId = teamId || process.env.PRIME_INTELLECT_TEAM_ID || getPrimeTeamId() || undefined;
  }

  private async makeRequest(
    method: string,
    endpoint: string,
    body?: any
  ): Promise<any> {
    const url = `${this.baseUrl}${endpoint}`;
    const headers: Record<string, string> = {
      "Authorization": `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
    };

    const options: RequestInit = {
      method,
      headers,
    };

    if (body) {
      options.body = JSON.stringify(body);
    }

    let response: Response;
    try {
      response = await fetch(url, options);
    } catch (error) {
      throw new Error(
        `Failed to connect to Prime Intellect API at ${url}: ${(error as Error).message}`
      );
    }

    // Handle errors
    if (!response.ok) {
      let errorMessage = `API request failed with status ${response.status} for ${method} ${url}`;
      try {
        const errorData = (await response.json()) as { error?: string; message?: string };
        if (errorData.error) {
          errorMessage = `${errorData.error} (${method} ${url})`;
        } else if (errorData.message) {
          errorMessage = `${errorData.message} (${method} ${url})`;
        }
      } catch {
        // If response is not JSON, use status text
        errorMessage = `${response.statusText || `Status ${response.status}`} (${method} ${url})`;
      }
      
      // Add helpful message for 404 errors
      if (response.status === 404) {
        errorMessage += `. Check that the API endpoint is correct and that your API key has access to sandbox resources.`;
      }
      
      throw new Error(errorMessage);
    }

    // Parse response
    try {
      return await response.json();
    } catch (error) {
      // If response is empty (e.g., DELETE), return success
      if (response.status === 204 || response.status === 200) {
        return {};
      }
      throw new Error(
        `Failed to parse API response: ${(error as Error).message}`
      );
    }
  }

  private convertConfigToAPI(config: SandboxConfig): any {
    return {
      name: config.name || "sandbox-env",
      docker_image: config.dockerImage || "python:3.11-slim",
      start_command: config.startCommand || "tail -f /dev/null",
      cpu_cores: config.cpuCores || 1,
      memory_gb: config.memoryGb || 2,
      disk_size_gb: config.diskSizeGb || 5,
      gpu_count: config.gpuCount || 0,
      timeout_minutes: config.timeoutMinutes || 60,
      environment_vars: config.environmentVars || {},
      team_id: config.teamId || this.teamId,
      advanced_configs: config.advancedConfigs,
    };
  }

  async createSandbox(config: SandboxConfig): Promise<Sandbox> {
    const requestBody = this.convertConfigToAPI(config);
    // OpenAPI spec: POST /api/v1/sandbox (singular)
    const result = await this.makeRequest("POST", "/api/v1/sandbox", requestBody) as { id: string };
    return { id: result.id };
  }

  async executeCommand(
    sandboxId: string,
    command: string
  ): Promise<CommandResult> {
    // Wait for sandbox to be ready before executing
    await this.waitForCreation(sandboxId);

    const requestBody = { command };
    // Note: Execute endpoint not in OpenAPI spec, but Python implementation uses it
    // Using /api/v1/sandbox/{id}/execute based on pattern
    const result = await this.makeRequest(
      "POST",
      `/api/v1/sandbox/${sandboxId}/execute`,
      requestBody
    ) as { stdout?: string; stderr?: string };

    return {
      stdout: result.stdout?.trim() || "",
      stderr: result.stderr?.trim() || "",
    };
  }

  async deleteSandbox(sandboxId: string): Promise<void> {
    // OpenAPI spec: DELETE /api/v1/sandbox/{sandbox_id}
    await this.makeRequest("DELETE", `/api/v1/sandbox/${sandboxId}`);
  }

  /**
   * Wait for sandbox to be ready (polling)
   * Uses exponential backoff: 1s, 2s, 4s, 8s (max 30s between polls)
   * Timeout: 5 minutes
   */
  async waitForCreation(sandboxId: string): Promise<void> {
    const startTime = Date.now();
    const timeout = 5 * 60 * 1000; // 5 minutes
    let delay = 1000; // Start with 1 second
    const maxDelay = 30000; // Max 30 seconds between polls

    while (Date.now() - startTime < timeout) {
      try {
        // OpenAPI spec: GET /api/v1/sandbox/{sandbox_id} returns SandboxResponse
        // Status can be: PENDING, PROVISIONING, RUNNING, STOPPED, ERROR, TERMINATED
        const sandbox = await this.makeRequest(
          "GET",
          `/api/v1/sandbox/${sandboxId}`
        ) as { status?: string; error?: string };

        // Sandbox is ready when status is RUNNING
        if (sandbox.status === "RUNNING") {
          return;
        }

        // If sandbox is in error state, throw
        if (sandbox.status === "ERROR" || sandbox.status === "TERMINATED") {
          throw new Error(
            `Sandbox ${sandboxId} failed to become ready: ${sandbox.error || "Unknown error"}`
          );
        }

        // Wait before next poll
        await new Promise((resolve) => setTimeout(resolve, delay));
        delay = Math.min(delay * 2, maxDelay); // Exponential backoff
      } catch (error) {
        // If it's a 404, sandbox might not exist yet, continue polling
        if ((error as Error).message.includes("404")) {
          await new Promise((resolve) => setTimeout(resolve, delay));
          delay = Math.min(delay * 2, maxDelay);
          continue;
        }
        // For other errors, rethrow
        throw error;
      }
    }

    throw new Error(
      `Timeout waiting for sandbox ${sandboxId} to become ready (5 minutes)`
    );
  }
}

