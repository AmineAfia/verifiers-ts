import type { GenerateTextResult } from "ai";
import type { State } from "../types/index.js";

export function extractExperimentalOutput(
  result: GenerateTextResult<any, any>
): unknown {
  if (!result || typeof result !== "object") {
    return undefined;
  }

  try {
    const value = (result as any).experimental_output;
    return value === undefined ? undefined : value;
  } catch (error) {
    if (isNoOutputSpecifiedError(error)) {
      return undefined;
    }
    throw error;
  }
}

export function isNoOutputSpecifiedError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const candidate = error as { name?: string };
  return candidate.name === "AI_NoOutputSpecifiedError";
}

export function getStructuredOutputFromState<T = unknown>(
  state?: State
): T | null {
  if (!state || typeof state !== "object") {
    return null;
  }

  const record = state as Record<string, unknown>;

  if (record.structured_output !== undefined) {
    return record.structured_output as T;
  }

  const structuredOutputs = record.structured_outputs;
  if (Array.isArray(structuredOutputs) && structuredOutputs.length > 0) {
    return structuredOutputs[structuredOutputs.length - 1] as T;
  }

  const rawSources: unknown[] = [];
  const rawResponses = record.raw_responses;
  if (Array.isArray(rawResponses)) {
    rawSources.push(...rawResponses);
  }
  const responses = record.responses;
  if (Array.isArray(responses)) {
    rawSources.push(...responses);
  }

  for (let i = rawSources.length - 1; i >= 0; i--) {
    const candidate = rawSources[i] as Record<string, unknown> | undefined;
    if (!candidate) {
      continue;
    }
    const output =
      candidate.experimental_output ??
      ((candidate.result as Record<string, unknown> | undefined)?.experimental_output) ??
      ((candidate.data as Record<string, unknown> | undefined)?.experimental_output);
    if (output !== undefined) {
      return output as T;
    }
  }

  return null;
}
