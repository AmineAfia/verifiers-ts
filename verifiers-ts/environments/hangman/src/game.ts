import type { Messages, ChatMessage, Dataset, State } from "verifiers-ts";
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
  "apple", "banana", "orange", "grape", "mango",
  "hello", "world", "python", "coding", "system",
  "jazz", "quark", "xylophone", "rhythm", "symbol",
  "window", "laptop", "keyboard", "monitor", "screen",
  "coffee", "garden", "forest", "river", "mountain",
  "planet", "galaxy", "universe", "nebula", "quasar",
  "puzzle", "riddle", "mystery", "secret", "hidden",
  "castle", "knight", "dragon", "wizard", "sword",
  "music", "dance", "theater", "comedy", "drama",
  "ocean", "island", "beach", "coral", "whale",
  "elephant", "giraffe", "monkey", "tiger", "lion",
];

export function generateWordList(): string[] {
  return DEFAULT_WORD_LIST.slice();
}

export function revealWord(secretWord: string, guessedLetters: string[] | Set<string>): string {
  const guessedSet = Array.isArray(guessedLetters)
    ? new Set(guessedLetters)
    : guessedLetters;
  return secretWord
    .split("")
    .map((letter) => (guessedSet.has(letter.toUpperCase()) ? letter.toUpperCase() : "_"))
    .join(" ");
}

export function isValidLetter(letter: string): boolean {
  return /^[A-Z]$/.test(letter.toUpperCase());
}

export function extractGuess(messages: Messages, parser: XMLParser): string | null {
  const parsed = parser.parseCompletion(messages);
  if (parsed?.guess) {
    const guess = String(parsed.guess).trim().toUpperCase();
    if (isValidLetter(guess)) {
      return guess;
    }
  }

  if (Array.isArray(messages)) {
    const lastMessage = messages[messages.length - 1];
    if (
      typeof lastMessage === "object" &&
      lastMessage !== null &&
      "role" in lastMessage &&
      lastMessage.role === "assistant" &&
      "content" in lastMessage
    ) {
      const content = (lastMessage as ChatMessage).content || "";
      const letterMatch = content.match(/\b([A-Z])\b/i);
      if (letterMatch) {
        return letterMatch[1].toUpperCase();
      }
    }
  }

  return null;
}

export function getGameStatus(
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

export function formatGameFeedback(
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

export function createInitialGameState(secretWord: string): HangmanGameState {
  return {
    secretWord: secretWord.toLowerCase(),
    guessedLetters: [],
    wrongGuesses: 0,
    gameWon: false,
    gameLost: false,
    wordDisplay: "_ ".repeat(secretWord.length).trim(),
  };
}

export function ensureGameState(value: unknown): HangmanGameState {
  const gameState = (value as HangmanGameState) || createInitialGameState("");
  if (!Array.isArray(gameState.guessedLetters)) {
    gameState.guessedLetters = Array.from(gameState.guessedLetters as unknown as Set<string> | string[]);
  }
  return gameState;
}

export function generateDataset(
  numExamples: number,
  wordList: string[]
): Dataset {
  const prompts: Messages[] = [];
  const answers: string[] = [];
  const exampleIds: number[] = [];
  const tasks: string[] = [];
  const info: Record<string, unknown>[] = [];

  for (let i = 0; i < numExamples; i++) {
    const word = wordList[Math.floor(Math.random() * wordList.length)];
    prompts.push([
      {
        role: "user",
        content: `Play Hangman! I'm thinking of a ${word.length}-letter word. Guess one letter at a time to reveal it.`,
      },
    ]);
    answers.push(word);
    exampleIds.push(i);
    tasks.push("hangman");
    info.push({});
  }

  return {
    column_names: ["prompt", "answer", "example_id", "task", "info"],
    prompt: prompts,
    answer: answers,
    example_id: exampleIds,
    task: tasks,
    info: info,
  } as Dataset;
}

export function getSecretWordFromState(state: State): string {
  const answer = state.answer as string;
  if (!answer) {
    throw new Error("No secret word provided in state.answer");
  }
  return answer;
}

// Hook factories used by index.ts
export function createSetupStateHook() {
  return async (state: State): Promise<State> => {
    const secretWord = getSecretWordFromState(state);
    if (!state.gameState) {
      state.gameState = createInitialGameState(secretWord);
    } else {
      const existingState = ensureGameState(state.gameState);
      existingState.secretWord = secretWord.toLowerCase();
      state.gameState = existingState;
    }
    return state;
  };
}

export function createIsCompletedHook() {
  return async (_messages: Messages, state: State): Promise<boolean> => {
    const gameState = state.gameState as HangmanGameState | undefined;
    return Boolean(gameState && (gameState.gameWon || gameState.gameLost));
  };
}

export function createEnvResponseHook(params: { parser: XMLParser; maxWrongGuesses: number }) {
  const { parser, maxWrongGuesses } = params;
  return async (
    messages: Messages,
    state: State
  ): Promise<[Messages, State]> => {
    const gameState = state.gameState as HangmanGameState;
    if (!gameState) {
      throw new Error("Game state not initialized");
    }

    let guessedLetter: string | null = null;

    if (Array.isArray(messages)) {
      for (let i = messages.length - 1; i >= 0; i--) {
        const msg = messages[i];
        if (
          typeof msg === "object" &&
          msg !== null &&
          "role" in msg &&
          (msg as ChatMessage).role === "assistant" &&
          "tool_calls" in msg
        ) {
          const toolCalls = (msg as { tool_calls?: unknown[] }).tool_calls || [];
          const guessCall = toolCalls.find(
            (tc: unknown) =>
              typeof tc === "object" &&
              tc !== null &&
              "function" in tc &&
              typeof (tc as { function?: { name?: string } }).function?.name === "string" &&
              (tc as { function: { name: string } }).function.name === "guess_letter"
          );

          if (guessCall) {
            try {
              const funcCall = guessCall as {
                function: { arguments: string | Record<string, unknown> };
              };
              const args =
                typeof funcCall.function.arguments === "string"
                  ? (JSON.parse(funcCall.function.arguments) as { letter?: string })
                  : (funcCall.function.arguments as { letter?: string });
              guessedLetter = args.letter?.toUpperCase() || null;
              if (guessedLetter) break;
            } catch (_error) {
              // continue
            }
          }
        }
      }
    }

    if (!guessedLetter) {
      guessedLetter = extractGuess(messages, parser);
    }

    if (!guessedLetter || !isValidLetter(guessedLetter)) {
      const errorMsg =
        "Invalid guess! Please use the guess_letter tool with a single letter (e.g., guess_letter({letter: 'A'})).";
      return [[{ role: "user", content: errorMsg }], state];
    }

    if (gameState.guessedLetters.includes(guessedLetter)) {
      const alreadyGuessedMsg = `You already guessed '${guessedLetter}'. Try a different letter.`;
      return [[{ role: "user", content: alreadyGuessedMsg }], state];
    }

    gameState.guessedLetters.push(guessedLetter);

    const secretWordUpper = gameState.secretWord.toUpperCase();
    if (!secretWordUpper.includes(guessedLetter)) {
      gameState.wrongGuesses++;
    }

    gameState.wordDisplay = revealWord(
      gameState.secretWord,
      gameState.guessedLetters
    );

    const status = getGameStatus(
      gameState.secretWord,
      gameState.guessedLetters,
      gameState.wrongGuesses,
      maxWrongGuesses
    );

    gameState.gameWon = status === "won";
    gameState.gameLost = status === "lost";

    const feedback = formatGameFeedback(
      gameState.secretWord,
      gameState.guessedLetters,
      gameState.wrongGuesses,
      maxWrongGuesses,
      status
    );

    return [[{ role: "user", content: feedback }], state];
  };
}

