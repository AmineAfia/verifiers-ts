/**
 * XMLParser for extracting structured information from XML-tagged completions
 */

import type { Messages, ChatMessage } from "../types/index.js";
import { Parser } from "./parser.js";

type FieldDefinition = string | [string, ...string[]];

interface ParsedResult {
  [key: string]: string | null | undefined;
}

export class XMLParser extends Parser {
  private fields: Array<[string, string[]]> = [];
  private answerField: string;

  constructor(
    fields: FieldDefinition[],
    answerField: string = "answer",
    extractFn: (text: string) => string = (x) => x
  ) {
    super();
    this.answerField = answerField;

    const seen = new Set<string>();
    for (const field of fields) {
      let canonical: string;
      let alternatives: string[];

      if (typeof field === "string") {
        canonical = field;
        alternatives = [field];
      } else if (Array.isArray(field)) {
        if (field.length === 0) {
          throw new Error("Field tuple cannot be empty.");
        }
        canonical = field[0];
        alternatives = field;
      } else {
        throw new TypeError("Each field must be a string or a tuple of strings.");
      }

      if (seen.has(canonical)) {
        throw new Error(`Duplicate field name: ${canonical}`);
      }
      seen.add(canonical);
      this.fields.push([canonical, alternatives]);
    }

    if (seen.has("think")) {
      console.warn(
        "You have included the 'think' field in the XMLParser. This should only be used with models which always include <think>...</think> tags but do NOT parse them automatically."
      );
    }
  }

  parseAnswer(completion: Messages): string | null {
    const parsed = this.parse(completion, true, true);
    const answer = parsed[this.answerField];
    return answer || null;
  }

  parseCompletion(completion: Messages): ParsedResult {
    return this.parse(completion, true, false);
  }

  private parse(
    textOrMessages: Messages,
    strip: boolean = true,
    last: boolean = false
  ): ParsedResult {
    const text = this.getTextFromMessages(textOrMessages);
    const results: ParsedResult = {};

    for (const [canonical, alternatives] of this.fields) {
      for (const alt of alternatives) {
        const pattern = new RegExp(`<${alt}>\\s*(.*?)\\s*</${alt}>`, "gs");
        let matches = Array.from(text.matchAll(pattern));
        let match: RegExpMatchArray | null = null;

        if (last && matches.length > 0) {
          match = matches[matches.length - 1];
        } else if (matches.length > 0) {
          match = matches[0];
        }

        if (match && match[1]) {
          results[alt] = strip ? match[1].trim() : match[1];
        } else {
          results[alt] = null;
        }
      }
    }

    return results;
  }

  private getTextFromMessages(messages: Messages): string {
    if (typeof messages === "string") {
      return messages;
    }
    return messages
      .filter(
        (msg) =>
          typeof msg === "object" && msg.role === "assistant" && msg.content
      )
      .map((msg) => (msg as ChatMessage).content || "")
      .join("\n");
  }

  override getAssistantMessages(completion: Messages): ChatMessage[] {
    if (typeof completion === "string") {
      return [];
    }
    return completion.filter(
      (msg) => typeof msg === "object" && msg.role === "assistant"
    ) as ChatMessage[];
  }
}

