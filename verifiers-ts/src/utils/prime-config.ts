/**
 * Utility functions for reading Prime CLI configuration
 * Reads from ~/.prime/config.json (same location as prime CLI)
 */

import fs from "fs";
import path from "path";
import os from "os";

export interface PrimeConfig {
  api_key?: string;
  team_id?: string | null;
  base_url?: string;
  frontend_url?: string;
  inference_url?: string;
  ssh_key_path?: string;
  current_environment?: string;
}

/**
 * Get the path to the Prime CLI config file
 */
export function getPrimeConfigPath(): string {
  return path.join(os.homedir(), ".prime", "config.json");
}

/**
 * Read Prime CLI configuration from ~/.prime/config.json
 * Returns null if config file doesn't exist or can't be read
 */
export function readPrimeConfig(): PrimeConfig | null {
  const configPath = getPrimeConfigPath();
  
  try {
    if (!fs.existsSync(configPath)) {
      return null;
    }

    const configContent = fs.readFileSync(configPath, "utf-8");
    const config = JSON.parse(configContent) as PrimeConfig;
    return config;
  } catch (error) {
    // Silently fail - config might not exist or be malformed
    return null;
  }
}

/**
 * Get API key from Prime CLI config
 * Returns null if not found
 */
export function getPrimeApiKey(): string | null {
  const config = readPrimeConfig();
  return config?.api_key || null;
}

/**
 * Get base URL from Prime CLI config
 * Returns null if not found
 */
export function getPrimeBaseUrl(): string | null {
  const config = readPrimeConfig();
  return config?.base_url || null;
}

/**
 * Get team ID from Prime CLI config
 * Returns null if not found
 */
export function getPrimeTeamId(): string | null {
  const config = readPrimeConfig();
  const teamId = config?.team_id;
  return teamId || null;
}

