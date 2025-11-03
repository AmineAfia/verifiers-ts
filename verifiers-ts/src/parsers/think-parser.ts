/**
 * ThinkParser for extracting answers from reasoning-separated completions
 * Handles <think>...</think> tags
 */

import type { Messages, ChatMessage } from "../types/index.js";
import { Parser } from "./parser.js";

export class ThinkParser extends Parser {
  constructor(extractFn: (text: string) => string = (x) => x) {
    super(extractFn);
    console.warn(
      "ThinkParser is intended for use with models which always include <think>...</think> tags but do NOT parse them automatically. " +
        "This will cause parsing failures if the model does not include <think>...</think> tags, or if the chat template automatically removes <think>...</think> tags. " +
        "In particular, you should NOT use this parser with Qwen3 or DeepSeek-R1 models."
    );
  }

  parseAnswer(completion: Messages): string | null {
    let text: string;
    if (typeof completion === "string") {
      text = completion;
    } else {
      // Get the last assistant message
      const assistantMessages = this.getAssistantMessages(completion);
      if (assistantMessages.length === 0) {
        return null;
      }
      text = assistantMessages[assistantMessages.length - 1].content || "";
    }

    if (text.includes("</think>")) {
      text = text.split("</think>").slice(-1)[0].trim();
    } else {
      // Do not allow any further extraction/parsing if no </think> is found
      text = "";
    }
    return this.extractFn(text.trim()) || null;
  }

  parseCompletion(completion: Messages): any {
    return this.parseAnswer(completion);
  }

  override getAssistantMessages(completion: Messages): ChatMessage[] {
    if (typeof completion === "string") {
      return [];
    }
    return completion.filter(
      (msg) => typeof msg === "object" && msg.role === "assistant"
    ) as ChatMessage[];
  }

  getFormatRewardFunc(): (completion: Messages) => number {
    return (completion: Messages) => {
      const answer = this.parseAnswer(completion);
      return answer !== null ? 1.0 : 0.0;
    };
  }
}

