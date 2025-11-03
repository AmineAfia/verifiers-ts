/**
 * Base Parser class for extracting structured information from completions
 */

import type { Messages, ChatMessage } from "../types/index.js";

export class Parser {
  protected extractFn: (text: string) => string;

  constructor(extractFn: (text: string) => string = (x) => x) {
    this.extractFn = extractFn;
  }

  /**
   * Parse an answer from completion messages
   * Default: returns the last assistant message's content
   */
  parseAnswer(completion: Messages): string | null {
    if (typeof completion === "string") {
      return this.extractFn(completion);
    }
    const assistantMessages = this.getAssistantMessages(completion);
    if (assistantMessages.length === 0) {
      return null;
    }
    const lastMessage = assistantMessages[assistantMessages.length - 1];
    const content = lastMessage.content || "";
    return this.extractFn(content);
  }

  /**
   * Parse completion to extract structured information
   * Default: returns parsed answer
   */
  parseCompletion(completion: Messages): any {
    return this.parseAnswer(completion);
  }

  /**
   * Get assistant messages from a completion
   */
  getAssistantMessages(completion: Messages): ChatMessage[] {
    if (typeof completion === "string") {
      return [];
    }
    return completion.filter(
      (msg) => typeof msg === "object" && msg.role === "assistant"
    ) as ChatMessage[];
  }

  /**
   * Get system messages from a completion
   */
  getSystemMessages(completion: Messages): ChatMessage[] {
    if (typeof completion === "string") {
      return [];
    }
    return completion.filter(
      (msg) => typeof msg === "object" && msg.role === "system"
    ) as ChatMessage[];
  }

  /**
   * Get user messages from a completion
   */
  getUserMessages(completion: Messages): ChatMessage[] {
    if (typeof completion === "string") {
      return [];
    }
    return completion.filter(
      (msg) => typeof msg === "object" && msg.role === "user"
    ) as ChatMessage[];
  }

  /**
   * Get tool messages from a completion
   */
  getToolMessages(completion: Messages): ChatMessage[] {
    if (typeof completion === "string") {
      return [];
    }
    return completion.filter(
      (msg) => typeof msg === "object" && msg.role === "tool"
    ) as ChatMessage[];
  }

  /**
   * Get a reward function that checks format compliance
   */
  getFormatRewardFunc(): (completion: Messages) => number {
    return (completion: Messages) => {
      const answer = this.parseAnswer(completion);
      return answer !== null ? 1.0 : 0.0;
    };
  }
}

