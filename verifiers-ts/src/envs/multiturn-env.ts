/**
 * MultiTurnEnv for multi-turn interactions
 * Base class for environments with multiple turns
 */

import type {
  Messages,
  State,
  Info,
  SamplingArgs,
  ChatMessage,
} from "../types/index.js";
import { Environment, EnvironmentOptions } from "./environment.js";
import { maybeAwait } from "../utils/async-utils.js";
import type { AISDKTool } from "../utils/tool-utils.js";

function normalizeToolCall(tc: any): {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
} {
  const id =
    tc?.id || tc?.toolCallId || `tool_call_${Date.now()}_${Math.random()}`;

  const name =
    tc?.toolName ||
    tc?.name ||
    tc?.function?.name ||
    "unknown_tool";

  let rawArgs: unknown = undefined;

  if (typeof tc?.args === "string") {
    rawArgs = tc.args;
  } else if (typeof tc?.input === "string") {
    rawArgs = tc.input;
  } else if (tc?.function && typeof tc.function.arguments === "string") {
    rawArgs = tc.function.arguments;
  } else if (tc?.function && tc.function.arguments !== undefined) {
    rawArgs = tc.function.arguments;
  } else if (tc?.args !== undefined) {
    rawArgs = tc.args;
  } else if (tc?.input !== undefined) {
    rawArgs = tc.input;
  }

  if (rawArgs === undefined) {
    rawArgs = {};
  }

  const argumentsString =
    typeof rawArgs === "string" ? rawArgs : JSON.stringify(rawArgs);

  return {
    id,
    type: "function" as const,
    function: {
      name,
      arguments: argumentsString,
    },
  };
}

export interface MultiTurnEnvOptions extends EnvironmentOptions {
  maxTurns?: number;
}

export abstract class MultiTurnEnv extends Environment {
  protected maxTurns: number;

  constructor(options: MultiTurnEnvOptions = {}) {
    super(options);
    this.maxTurns = options.maxTurns || -1;
  }

  async promptTooLong(state: State): Promise<boolean> {
    return state.prompt_too_long === true;
  }

  async maxTurnsReached(state: State): Promise<boolean> {
    return (state.turn as number) >= this.maxTurns && this.maxTurns > 0;
  }

  async setupState(state: State): Promise<State> {
    return state;
  }

  async isCompleted(
    messages: Messages,
    state: State
  ): Promise<boolean> {
    const maxTurnsReached = await this.maxTurnsReached(state);
    const promptTooLong = await this.promptTooLong(state);
    return maxTurnsReached || promptTooLong;
  }

  abstract envResponse(
    messages: Messages,
    state: State
  ): Promise<[Messages, State]>;

  async getContextMessages(state: State): Promise<Messages> {
    const prompt = state.prompt as Messages;
    const completion = state.completion as Messages;

    if (this.messageType === "chat") {
      if (Array.isArray(prompt) && Array.isArray(completion)) {
        return [...prompt, ...completion];
      }
    } else {
      if (typeof prompt === "string" && typeof completion === "string") {
        return prompt + completion;
      }
    }
    return [];
  }

  async rollout(
    modelId: string,
    prompt: Messages,
    completion?: Messages,
    answer: string = "",
    state: State = {},
    task: string = "default",
    info: Info | null = null,
    exampleId: number = 0,
    samplingArgs: SamplingArgs = {},
    apiKey?: string,
    baseUrl?: string
  ): Promise<[Messages, State]> {
    console.warn("[MultiTurnEnv] rollout called!");
    const resolvedCompletion = completion || (await this.initCompletion());
    const resolvedInfo = info || {};
    let isCompleted = false;

    let resolvedState = state;
    if (Object.keys(state).length === 0) {
      resolvedState = await this.initState(
        prompt,
        resolvedCompletion,
        answer,
        task,
        resolvedInfo,
        exampleId
      );
    }

    const startTime = Date.now();
    console.warn("[MultiTurnEnv] About to call setupState");
    resolvedState = await this.setupState(resolvedState);
    console.warn("[MultiTurnEnv] setupState completed");

    // Validate message types
    if (this.messageType === "chat") {
      if (!Array.isArray(resolvedState.prompt)) {
        throw new Error("Chat prompts must be arrays");
      }
      if (!Array.isArray(resolvedState.completion)) {
        resolvedState.completion = [];
      }
    } else {
      if (typeof resolvedState.prompt !== "string") {
        throw new Error("Completion prompts must be strings");
      }
      if (typeof resolvedState.completion !== "string") {
        resolvedState.completion = "";
      }
      if (!resolvedState.responses_start_idx) {
        resolvedState.responses_start_idx = [];
      }
    }

    // Get AI SDK tools if available (from ToolEnv)
    const aiSdkTools =
      (this as any).aiSdkTools ||
      ((this as any).getAISDKTools?.() as Record<string, AISDKTool>);

    // Main rollout loop
    while (!isCompleted) {
      const contextMessages = await this.getContextMessages(resolvedState);
      const completed = await this.isCompleted(contextMessages, resolvedState);

      if (completed) {
        isCompleted = true;
        break;
      }

      // Get model response - AI SDK handles tool calling automatically if tools exist
      const toolsForCall = aiSdkTools && Object.keys(aiSdkTools).length > 0
        ? aiSdkTools
        : null;

      const response = await this.getModelResponse(
        modelId,
        contextMessages,
        toolsForCall,
        samplingArgs,
        this.messageType,
        apiKey,
        baseUrl
      );

      // Handle overlong prompt
      if (response?.id === "overlong-prompt") {
        resolvedState.prompt_too_long = true;
        break;
      }

      if (!resolvedState.responses) {
        resolvedState.responses = [];
      }
      resolvedState.responses.push(response);

      // Extract response text and update completion
      let responseText = "";
      if (this.messageType === "chat") {
        if (Array.isArray(contextMessages)) {
          const choices = response?.choices;
          if (choices?.[0]?.message) {
            responseText = choices[0].message.content || "";
          }

          const responseMessage: ChatMessage = {
            role: "assistant",
            content: responseText,
          };

          // Handle tool calls from AI SDK response
          if (response.toolCalls && response.toolCalls.length > 0) {
            // AI SDK already executed tools - convert to message format
            responseMessage.tool_calls = response.toolCalls.map((tc: any) =>
              normalizeToolCall(tc)
            );
          } else if (choices?.[0]?.message?.tool_calls) {
            const toolCalls = choices[0].message.tool_calls as any[];
            responseMessage.tool_calls = toolCalls.map((tc) =>
              normalizeToolCall(tc)
            );
          }

          (resolvedState.completion as ChatMessage[]).push(responseMessage);
        }
      } else {
        const choices = response?.choices;
        if (choices?.[0]) {
          responseText = choices[0].text || "";
        }
        if (typeof resolvedState.completion === "string") {
          (resolvedState.responses_start_idx as number[]).push(
            resolvedState.completion.length
          );
          resolvedState.completion = resolvedState.completion + responseText;
        }
      }

      // Check completion again after model response
      const contextMessagesAfter = await this.getContextMessages(resolvedState);
      const completedAfter = await this.isCompleted(contextMessagesAfter, resolvedState);

      if (completedAfter) {
        isCompleted = true;
        const endTime = Date.now();
        if (!resolvedState.timing) {
          resolvedState.timing = { generation_ms: 0, scoring_ms: 0, total_ms: 0 };
        }
        resolvedState.timing.generation_ms = endTime - startTime;
        resolvedState.timing.total_ms = endTime - startTime;
        break;
      }

      // Get environment response (for custom non-tool responses)
      const [envMessages, updatedState] = await this.envResponse(contextMessagesAfter, resolvedState);

      resolvedState = updatedState;
      resolvedState.turn = ((resolvedState.turn as number) || 0) + 1;

      // Add environment messages to completion
      if (this.messageType === "chat") {
        if (Array.isArray(envMessages)) {
          (resolvedState.completion as ChatMessage[]).push(...envMessages);
        }
      } else {
        if (typeof envMessages === "string") {
          if (typeof resolvedState.completion === "string") {
            resolvedState.completion = resolvedState.completion + envMessages;
          }
        }
      }
    }

    return [resolvedState.completion as Messages, resolvedState];
  }
}
