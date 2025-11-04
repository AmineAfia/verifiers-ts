import type {
  ChatMessage,
  DatasetExample,
  Messages,
  State,
  ToolGameLifecycle,
  ToolGameTurnArgs,
  ToolGameTurnResult,
} from "verifiers-ts";
import { XMLParser } from "verifiers-ts";

export const DEFAULT_WRONG_GUESSES = 6;

export interface HangmanGameState {
  secretWord: string;
  guessedLetters: string[];
  wrongGuesses: number;
  gameWon: boolean;
  gameLost: boolean;
  wordDisplay: string;
}

export const DEFAULT_WORD_LIST: string[] = [
  "apple",
  "banana",
  "orange",
  "grape",
  "mango",
  "hello",
  "world",
  "python",
  "coding",
  "system",
  "jazz",
  "quark",
  "xylophone",
  "rhythm",
  "symbol",
  "window",
  "laptop",
  "keyboard",
  "monitor",
  "screen",
  "coffee",
  "garden",
  "forest",
  "river",
  "mountain",
  "planet",
  "galaxy",
  "universe",
  "nebula",
  "quasar",
  "puzzle",
  "riddle",
  "mystery",
  "secret",
  "hidden",
  "castle",
  "knight",
  "dragon",
  "wizard",
  "sword",
  "music",
  "dance",
  "theater",
  "comedy",
  "drama",
  "ocean",
  "island",
  "beach",
  "coral",
  "whale",
  "elephant",
  "giraffe",
  "monkey",
  "tiger",
  "lion",
];

export function generateWordList(): string[] {
  return DEFAULT_WORD_LIST.slice();
}

export interface HangmanGameOptions {
  maxWrongGuesses?: number;
  parser?: XMLParser;
}

export class HangmanGame implements ToolGameLifecycle {
  readonly maxWrongGuesses: number;
  readonly parser: XMLParser;

  constructor(options: HangmanGameOptions = {}) {
    this.maxWrongGuesses = options.maxWrongGuesses ?? DEFAULT_WRONG_GUESSES;
    this.parser = options.parser ?? new XMLParser(["guess"], "guess");
  }

  async setupState(state: State): Promise<State> {
    const secretWord = getSecretWordFromState(state);
    if (!state.gameState) {
      state.gameState = createInitialGameState(secretWord);
    } else {
      const current = ensureGameState(state.gameState);
      current.secretWord = secretWord.toLowerCase();
      state.gameState = current;
    }
    state.maxWrongGuesses = this.maxWrongGuesses;
    return state;
  }

  async onTurn({ messages, state }: ToolGameTurnArgs): Promise<ToolGameTurnResult> {
    if (!state.gameState) {
      await this.setupState(state);
    }

    const gameState = ensureGameState(state.gameState);

    const guessedLetter = this.extractGuess(messages);
    if (!guessedLetter) {
      return {
        reply:
          "Invalid guess! Please use the guess_letter tool with a single letter (e.g., guess_letter({letter: 'A'})).",
      };
    }

    if (gameState.guessedLetters.includes(guessedLetter)) {
      return {
        reply: `You already guessed '${guessedLetter}'. Try a different letter.`,
      };
    }

    gameState.guessedLetters.push(guessedLetter);

    if (!gameState.secretWord.toUpperCase().includes(guessedLetter)) {
      gameState.wrongGuesses += 1;
    }

    gameState.wordDisplay = revealWord(
      gameState.secretWord,
      gameState.guessedLetters
    );

    const status = getGameStatus(
      gameState.secretWord,
      gameState.guessedLetters,
      gameState.wrongGuesses,
      this.maxWrongGuesses
    );

    gameState.gameWon = status === "won";
    gameState.gameLost = status === "lost";

    const feedback = formatGameFeedback(
      gameState.secretWord,
      gameState.guessedLetters,
      gameState.wrongGuesses,
      this.maxWrongGuesses,
      status
    );

    state.gameState = gameState;
    return {
      messages: [
        {
          role: "user",
          content: feedback,
        },
      ],
      state,
    };
  }

  async isCompleted(_messages: Messages, state: State): Promise<boolean> {
    const gameState = state.gameState as HangmanGameState | undefined;
    return Boolean(gameState && (gameState.gameWon || gameState.gameLost));
  }

  private extractGuess(messages: Messages): string | null {
    const parsed = this.parser.parseCompletion(messages);
    if (parsed?.guess) {
      const guess = String(parsed.guess).trim().toUpperCase();
      if (isValidLetter(guess)) {
        return guess;
      }
    }

    if (!Array.isArray(messages) || messages.length === 0) {
      return null;
    }

    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const msg = messages[i];
      if (
        typeof msg === "object" &&
        msg !== null &&
        "role" in msg &&
        msg.role === "assistant"
      ) {
        const toolGuess = this.extractGuessFromToolCall(msg);
        if (toolGuess) {
          return toolGuess;
        }
        const contentGuess = extractGuessFromContent(msg);
        if (contentGuess) {
          return contentGuess;
        }
      }
    }

    return null;
  }

  private extractGuessFromToolCall(message: ChatMessage): string | null {
    const rawCalls =
      (message as any).tool_calls ?? (message as any).toolCalls ?? [];
    if (!rawCalls || rawCalls.length === 0) {
      return null;
    }

    for (const toolCall of rawCalls) {
      const fnCall = (toolCall as any).function ?? toolCall;
      const callName = fnCall?.name ?? fnCall?.toolName;
      if (callName !== "guess_letter") {
        continue;
      }

      try {
        const rawArgs = fnCall?.arguments ?? fnCall?.args ?? {};
        const args =
          typeof rawArgs === "string"
            ? (JSON.parse(rawArgs) as { letter?: string })
            : (rawArgs as { letter?: string });
        const letter = args.letter?.toUpperCase();
        if (letter && isValidLetter(letter)) {
          return letter;
        }
      } catch (_error) {
        // ignore malformed payloads
      }
    }

    return null;
  }
}

export function createHangmanDataset(
  numExamples: number,
  wordList: string[]
): DatasetExample[] {
  return generateDatasetExamples(numExamples, wordList);
}

export function generateDatasetExamples(
  numExamples: number,
  wordList: string[]
): DatasetExample[] {
  const examples: DatasetExample[] = [];

  for (let i = 0; i < numExamples; i += 1) {
    const word = wordList[Math.floor(Math.random() * wordList.length)];
    examples.push({
      prompt: [
        {
          role: "user",
          content: `Play Hangman! I'm thinking of a ${word.length}-letter word. Guess one letter at a time to reveal it.`,
        },
      ],
      answer: word,
      example_id: i,
      task: "hangman",
      info: {},
    });
  }

  return examples;
}

function revealWord(secretWord: string, guessedLetters: string[] | Set<string>): string {
  const guessedSet = Array.isArray(guessedLetters)
    ? new Set(guessedLetters)
    : guessedLetters;

  return secretWord
    .split("")
    .map((letter) =>
      guessedSet.has(letter.toUpperCase()) ? letter.toUpperCase() : "_"
    )
    .join(" ");
}

function isValidLetter(letter: string): boolean {
  return /^[A-Z]$/.test(letter.toUpperCase());
}

function extractGuessFromContent(message: ChatMessage): string | null {
  const content = message.content || "";
  const quotedLetter = content.match(/letter[^A-Za-z]*"([A-Za-z])"/i);
  if (quotedLetter) {
    return quotedLetter[1].toUpperCase();
  }
  const singleLetter = content
    .split(/\s+/)
    .map((part) => part.replace(/[^A-Za-z]/g, ""))
    .find((part) => part.length === 1 && /[A-Za-z]/.test(part) && part.toUpperCase() !== "I");
  return singleLetter ? singleLetter.toUpperCase() : null;
}

function getGameStatus(
  secretWord: string,
  guessedLetters: string[] | Set<string>,
  wrongGuesses: number,
  maxWrongGuesses: number
): "won" | "lost" | "playing" {
  const guessedSet = Array.isArray(guessedLetters)
    ? new Set(guessedLetters)
    : guessedLetters;

  const allLettersGuessed = secretWord
    .toUpperCase()
    .split("")
    .every((letter) => guessedSet.has(letter));

  if (allLettersGuessed) {
    return "won";
  }
  if (wrongGuesses >= maxWrongGuesses) {
    return "lost";
  }
  return "playing";
}

function formatGameFeedback(
  secretWord: string,
  guessedLetters: string[] | Set<string>,
  wrongGuesses: number,
  maxWrongGuesses: number,
  status: "won" | "lost" | "playing"
): string {
  const guessedArray = Array.isArray(guessedLetters)
    ? guessedLetters
    : Array.from(guessedLetters);
  const wordDisplay = revealWord(secretWord, guessedArray);
  const wrongLetters = guessedArray.filter(
    (letter) => !secretWord.toUpperCase().includes(letter)
  );
  const correctLetters = guessedArray.filter((letter) =>
    secretWord.toUpperCase().includes(letter)
  );

  let feedback = `Word: ${wordDisplay}\n`;
  feedback += `Wrong guesses: ${wrongGuesses}/${maxWrongGuesses}`;

  if (wrongLetters.length > 0) {
    feedback += ` (${wrongLetters.join(", ")})`;
  }
  feedback += "\n";

  if (correctLetters.length > 0) {
    feedback += `Guessed letters: ${correctLetters.join(", ")}\n`;
  }

  const guessedSet = new Set(guessedArray.map((l) => l.toUpperCase()));
  const allLetters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
  const available = allLetters.filter((l) => !guessedSet.has(l));
  feedback += `Available: ${available.join(" ")}\n`;

  if (status === "won") {
    feedback += `\n🎉 Congratulations! You guessed the word: ${secretWord.toUpperCase()}\n`;
    feedback += `Word: ${secretWord.toUpperCase().split("").join(" ")}\n`;
  } else if (status === "lost") {
    feedback += `\n💀 Game Over! The word was: ${secretWord.toUpperCase()}\n`;
    feedback += `Word: ${wordDisplay}\n`;
  } else {
    feedback += "\nGuess a letter:\n";
  }

  return feedback;
}

function createInitialGameState(secretWord: string): HangmanGameState {
  return {
    secretWord: secretWord.toLowerCase(),
    guessedLetters: [],
    wrongGuesses: 0,
    gameWon: false,
    gameLost: false,
    wordDisplay: "_ ".repeat(secretWord.length).trim(),
  };
}

function ensureGameState(value: unknown): HangmanGameState {
  if (!value) {
    throw new Error("Game state not initialized");
  }

  const gameState = value as HangmanGameState;
  if (!Array.isArray(gameState.guessedLetters)) {
    gameState.guessedLetters = Array.from(
      (gameState.guessedLetters as unknown as Set<string> | string[]) ?? []
    );
  }
  return gameState;
}

function getSecretWordFromState(state: State): string {
  const answer = state.answer as string;
  if (!answer) {
    throw new Error("No secret word provided in state.answer");
  }
  return answer;
}
