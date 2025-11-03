/**
 * SandboxEnv for environments requiring sandboxed execution
 * Integrates with Prime Intellect sandboxes
 */

import type { Messages, State } from "../types/index.js";
import { StatefulToolEnv, StatefulToolEnvOptions } from "./stateful-tool-env.js";
import { defineTool } from "../utils/tool-utils.js";
import { z } from "zod";

export interface SandboxConfig {
  sandboxName?: string;
  dockerImage?: string;
  startCommand?: string;
  cpuCores?: number;
  memoryGb?: number;
  diskSizeGb?: number;
  gpuCount?: number;
  timeoutMinutes?: number;
  environmentVars?: Record<string, string>;
  teamId?: string;
}

export interface SandboxEnvOptions extends StatefulToolEnvOptions {
  sandboxConfig?: SandboxConfig;
}

/**
 * Abstract base class for sandbox environments
 * Subclasses should implement the sandbox client integration
 */
export abstract class SandboxEnv extends StatefulToolEnv {
  protected sandboxConfig: Required<SandboxConfig>;
  protected activeSandboxes: Set<string>;

  constructor(options: SandboxEnvOptions = {}) {
    super(options);

    const config = options.sandboxConfig || {};
    this.sandboxConfig = {
      sandboxName: config.sandboxName || "sandbox-env",
      dockerImage: config.dockerImage || "python:3.11-slim",
      startCommand: config.startCommand || "tail -f /dev/null",
      cpuCores: config.cpuCores || 1,
      memoryGb: config.memoryGb || 2,
      diskSizeGb: config.diskSizeGb || 5,
      gpuCount: config.gpuCount || 0,
      timeoutMinutes: config.timeoutMinutes || 60,
      environmentVars: config.environmentVars || {},
      teamId: config.teamId || "",
    };

    this.activeSandboxes = new Set();

    // Add bash tool for executing commands in sandbox
    const bashTool = defineTool(
      "bash",
      "Execute a bash command in the sandbox",
      z.object({
        command: z.string().describe("The bash command to execute"),
        sandbox_id: z.string().describe("The sandbox ID"),
      }),
      async (args) => {
        return this.executeBash(args.command, args.sandbox_id);
      }
    );

    this.addTool(bashTool, ["sandbox_id"]);
  }

  /**
   * Execute a bash command in the sandbox
   * Must be implemented by subclasses
   */
  protected abstract executeBash(
    command: string,
    sandboxId: string
  ): Promise<string>;

  /**
   * Create a sandbox instance
   * Must be implemented by subclasses
   */
  protected abstract createSandbox(): Promise<{ id: string }>;

  /**
   * Destroy a sandbox instance
   * Must be implemented by subclasses
   */
  protected abstract destroySandbox(sandboxId: string | null): Promise<void>;

  /**
   * Cleanup all active sandboxes
   */
  async cleanupSandboxes(): Promise<void> {
    const sandboxIds = Array.from(this.activeSandboxes);
    for (const id of sandboxIds) {
      try {
        await this.destroySandbox(id);
      } catch (error) {
        console.warn(`Failed to delete sandbox ${id}:`, error);
      }
    }
    this.activeSandboxes.clear();
  }

  async setupState(state: State): Promise<State> {
    // Create per-rollout sandbox
    const sandbox = await this.createSandbox();
    this.activeSandboxes.add(sandbox.id);
    console.debug(`Created sandbox ${sandbox.id}`);
    state.sandbox_id = sandbox.id;
    return super.setupState(state);
  }

  updateToolArgs(
    toolName: string,
    toolArgs: Record<string, unknown>,
    messages: Messages,
    state: State
  ): Record<string, unknown> {
    if (toolName === "bash") {
      return {
        ...toolArgs,
        sandbox_id: state.sandbox_id as string,
      };
    }
    return toolArgs;
  }

  async isCompleted(messages: Messages, state: State): Promise<boolean> {
    const completed = await super.isCompleted(messages, state);
    if (completed) {
      await this.postRollout?.(messages, state);
      const sandboxId = state.sandbox_id as string | null;
      if (sandboxId) {
        await this.destroySandbox(sandboxId);
        state.sandbox_id = undefined;
      }
    }
    return completed;
  }

  /**
   * Hook for post-rollout cleanup
   * Override in subclasses if needed
   */
  protected async postRollout?(
    messages: Messages,
    state: State
  ): Promise<void>;

  /**
   * Bulk delete sandboxes by their IDs
   * Must be implemented by subclasses if needed
   */
  async bulkDeleteSandboxes(sandboxIds: string[]): Promise<void> {
    for (const id of sandboxIds) {
      try {
        await this.destroySandbox(id);
      } catch (error) {
        console.error(`Failed to bulk delete sandbox ${id}:`, error);
      }
    }
    sandboxIds.forEach((id) => this.activeSandboxes.delete(id));
  }
}

