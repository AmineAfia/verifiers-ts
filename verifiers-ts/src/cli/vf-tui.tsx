#!/usr/bin/env node

/**
 * Native TypeScript implementation of vf-tui CLI
 * React-based TUI using ink for browsing evaluation results with tree view
 */

import React, { useState, useEffect, useMemo } from "react";
import { render, useInput, Box, Text } from "ink";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

type RunInfo = {
  envId: string;
  model: string;
  runId: string;
  path: string;
  metadata: Record<string, any>;
};

type TreeNode = {
  id: string;
  label: string;
  type: "env" | "model" | "run";
  runInfo?: RunInfo;
  children: TreeNode[];
  expanded: boolean;
};

function parseEnvAndModel(dirName: string): { envId: string; model: string } | null {
  const parts = dirName.split("--");
  if (parts.length < 2) {
    return null;
  }
  const envId = parts[0];
  const model = parts.slice(1).join("/");
  return { envId, model };
}

function discoverResults(
  outputsDir: string = "./outputs"
): Map<string, Map<string, RunInfo[]>> {
  const discovered = new Map<string, Map<string, RunInfo[]>>();
  const evalsDir = path.join(outputsDir, "evals");

  if (!fs.existsSync(evalsDir)) {
    return discovered;
  }

  const envModelDirs = fs.readdirSync(evalsDir, { withFileTypes: true });
  for (const envModelDir of envModelDirs) {
    if (!envModelDir.isDirectory()) {
      continue;
    }

    const parsed = parseEnvAndModel(envModelDir.name);
    if (!parsed) {
      continue;
    }

    const { envId, model } = parsed;
    const envModelPath = path.join(evalsDir, envModelDir.name);

    const runDirs = fs.readdirSync(envModelPath, { withFileTypes: true });
    const runs: RunInfo[] = [];

    for (const runDir of runDirs) {
      if (!runDir.isDirectory()) {
        continue;
      }

      const runPath = path.join(envModelPath, runDir.name);
      const metadataPath = path.join(runPath, "metadata.json");
      const resultsPath = path.join(runPath, "results.jsonl");

      if (fs.existsSync(metadataPath) && fs.existsSync(resultsPath)) {
        try {
          const metadataContent = fs.readFileSync(metadataPath, "utf-8");
          const metadata = JSON.parse(metadataContent);

          runs.push({
            envId,
            model,
            runId: runDir.name,
            path: runPath,
            metadata,
          });
        } catch (error) {
          continue;
        }
      }
    }

    runs.sort((a, b) => {
      const dateA = a.metadata.date || "";
      const dateB = b.metadata.date || "";
      return dateB.localeCompare(dateA);
    });

    if (runs.length > 0) {
      if (!discovered.has(envId)) {
        discovered.set(envId, new Map());
      }
      discovered.get(envId)!.set(model, runs);
    }
  }

  return discovered;
}

function buildTree(discovered: Map<string, Map<string, RunInfo[]>>): TreeNode[] {
  const tree: TreeNode[] = [];

  for (const [envId, models] of discovered.entries()) {
    const modelNodes: TreeNode[] = [];
    
    for (const [model, runs] of models.entries()) {
      const runNodes: TreeNode[] = runs.map((run) => ({
        id: `${envId}-${model}-${run.runId}`,
        label: `${run.metadata.date || ""} ${run.metadata.time || ""}`.trim() || run.runId,
        type: "run",
        runInfo: run,
        children: [],
        expanded: false,
      }));

      modelNodes.push({
        id: `${envId}-${model}`,
        label: `${model} (${runs.length} run${runs.length !== 1 ? "s" : ""})`,
        type: "model",
        children: runNodes,
        expanded: false,
      });
    }

    tree.push({
      id: envId,
      label: `${envId} (${models.size} model${models.size !== 1 ? "s" : ""})`,
      type: "env",
      children: modelNodes,
      expanded: true, // Expand environments by default
    });
  }

  return tree.sort((a, b) => a.label.localeCompare(b.label));
}

function flattenTree(nodes: TreeNode[], expandedOnly: boolean = true): TreeNode[] {
  const result: TreeNode[] = [];
  
  for (const node of nodes) {
    result.push(node);
    if (node.expanded || !expandedOnly) {
      result.push(...flattenTree(node.children, expandedOnly));
    }
  }
  
  return result;
}

function PrimeIntellectLogo() {
  // ASCII art logo matching the PRIME Intellect design exactly
  // PRIME: blocky, angular, pixelated futuristic font (all caps)
  const primeAscii = [
    "██████╗ ██████╗ ██╗███╗   ███╗███████╗",
    "██╔══██╗██╔══██╗██║████╗ ████║██╔════╝",
    "██████╔╝██████╔╝██║██╔████╔██║█████╗  ",
    "██╔═══╝ ██╔══██╗██║██║╚██╔╝██║██╔══╝  ",
    "██║     ██║  ██║██║██║ ╚═╝ ██║███████╗",
    "╚═╝     ╚═╝  ╚═╝╚═╝╚═╝     ╚═╝╚══════╝"
  ];
  
  // Intellect: italicized serif style (capital I, rest lowercase)
  // Simulated italic by progressively offsetting each line to create slant effect
  const intellectAscii = [
    " ██╗███╗   ██╗████████╗███████╗██╗     ███████╗ ██████╗████████╗",
    "  ██║████╗  ██║╚══██╔══╝██╔════╝██║     ██╔════╝██╔════╝╚══██╔══╝",
    "   ██║██╔██╗ ██║   ██║   █████╗  ██║     █████╗  ██║        ██║   ",
    "    ██║██║╚██╗██║   ██║   ██╔══╝  ██║     ██╔══╝  ██║        ██║   ",
    "     ██║██║ ╚████║   ██║   ███████╗███████╗███████╗╚██████╗   ██║   ",
    "      ╚═╝╚═╝  ╚═══╝   ╚═╝   ╚══════╝╚══════╝╚══════╝ ╚═════╝   ╚═╝   "
  ];

  return (
    <Box flexDirection="column">
      <Box flexDirection="row" alignItems="flex-start">
        <Box flexDirection="column" marginRight={1}>
          {primeAscii.map((line, idx) => (
            <Text key={idx}>{line}</Text>
          ))}
        </Box>
        <Box flexDirection="column">
          {intellectAscii.map((line, idx) => (
            <Text key={idx}>{line}</Text>
          ))}
        </Box>
        <Box flexDirection="column" justifyContent="center" marginLeft={1} paddingTop={2}>
          <Text dimColor>(not official)</Text>
        </Box>
      </Box>
    </Box>
  );
}

function loadRunResults(run: RunInfo): Record<string, any>[] {
  const resultsPath = path.join(run.path, "results.jsonl");
  const results: Record<string, any>[] = [];

  if (!fs.existsSync(resultsPath)) {
    return results;
  }

  const content = fs.readFileSync(resultsPath, "utf-8");
  const lines = content.split("\n");

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    try {
      results.push(JSON.parse(trimmed));
    } catch (error) {
      continue;
    }
  }

  return results;
}

function formatMessages(messages: unknown): string {
  if (typeof messages === "string") {
    return messages;
  }
  if (Array.isArray(messages)) {
    return messages
      .map((msg, idx) => {
        if (typeof msg === "object" && msg !== null) {
          const role = (msg as { role?: string }).role || "unknown";
          const content = (msg as { content?: string }).content || "";
          // Add separator between messages for better readability
          const separator = idx > 0 ? "\n" : "";
          return `${separator}${role}: ${content}`;
        }
        return String(msg);
      })
      .join("\n");
  }
  return String(messages);
}

function wrapText(text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  const words = text.split(/\s+/);
  let currentLine = "";

  for (const word of words) {
    if (currentLine.length + word.length + 1 <= maxWidth) {
      currentLine += (currentLine ? " " : "") + word;
    } else {
      if (currentLine) {
        lines.push(currentLine);
      }
      // If word itself is longer than maxWidth, split it
      if (word.length > maxWidth) {
        for (let i = 0; i < word.length; i += maxWidth) {
          lines.push(word.substring(i, i + maxWidth));
        }
        currentLine = "";
      } else {
        currentLine = word;
      }
    }
  }
  if (currentLine) {
    lines.push(currentLine);
  }
  return lines;
}

function formatPromptOrCompletion(promptOrCompletion: unknown): string {
  return formatMessages(promptOrCompletion);
}

function useMouseWheel(
  onScrollUp: () => void,
  onScrollDown: () => void,
  enabled: boolean
) {
  useEffect(() => {
    if (!enabled) {
      return;
    }

    const stdin = process.stdin;
    const wasRaw = stdin.isRaw;
    const wasPaused = stdin.isPaused();

    // Enable mouse tracking
    process.stdout.write("\x1b[?1000h"); // Enable basic mouse events
    process.stdout.write("\x1b[?1006h"); // Enable SGR mouse mode

    const handleData = (data: string) => {
      // Mouse wheel events in SGR mode:
      // Scroll up: \x1b[<64;x;yM
      // Scroll down: \x1b[<65;x;yM
      const scrollUpMatch = data.match(/\x1b\[<64;(\d+);(\d+)([mM])/);
      const scrollDownMatch = data.match(/\x1b\[<65;(\d+);(\d+)([mM])/);

      if (scrollUpMatch) {
        onScrollUp();
      } else if (scrollDownMatch) {
        onScrollDown();
      }
    };

    stdin.on("data", handleData);

    return () => {
      stdin.removeListener("data", handleData);
      // Disable mouse tracking
      process.stdout.write("\x1b[?1000l");
      process.stdout.write("\x1b[?1006l");
    };
  }, [enabled, onScrollUp, onScrollDown]);
}

type VerifiersTUIProps = {
  outputsDir: string;
};

function VerifiersTUI({ outputsDir }: VerifiersTUIProps) {
  const [discovered, setDiscovered] = useState<Map<string, Map<string, RunInfo[]>>>(new Map());
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [selectedRun, setSelectedRun] = useState<RunInfo | null>(null);
  const [currentRecordIdx, setCurrentRecordIdx] = useState(0);
  const [records, setRecords] = useState<Record<string, any>[]>([]);
  const [promptScroll, setPromptScroll] = useState(0);
  const [completionScroll, setCompletionScroll] = useState(0);

  useEffect(() => {
    const results = discoverResults(outputsDir);
    setDiscovered(results);
    const treeData = buildTree(results);
    setTree(treeData);
  }, [outputsDir]);

  useEffect(() => {
    if (selectedRun) {
      const loaded = loadRunResults(selectedRun);
      setRecords(loaded);
      setCurrentRecordIdx(0);
    }
  }, [selectedRun]);

  const visibleNodes = useMemo(() => flattenTree(tree, true), [tree]);

  // Mouse wheel handlers for completion panel
  const handleCompletionScrollUp = useMemo(
    () => () => {
      if (selectedRun && records.length > 0) {
        setCompletionScroll((scroll: number) => Math.max(0, scroll - 3));
      }
    },
    [selectedRun, records.length]
  );

  const handleCompletionScrollDown = useMemo(
    () => () => {
      if (selectedRun && records.length > 0) {
        setCompletionScroll((scroll: number) => {
          const record = records[currentRecordIdx];
          const completionText = formatPromptOrCompletion(record.completion);
          const completionLines = completionText.split("\n");
          const maxScroll = Math.max(0, completionLines.length - 13);
          return Math.min(maxScroll, scroll + 3);
        });
      }
    },
    [selectedRun, records.length, currentRecordIdx]
  );

  useMouseWheel(handleCompletionScrollUp, handleCompletionScrollDown, !!selectedRun);

  useInput((input: string, key: { 
    upArrow?: boolean; 
    downArrow?: boolean; 
    return?: boolean;
    backspace?: boolean;
    leftArrow?: boolean;
    rightArrow?: boolean;
  }) => {
    if (input === "q") {
      process.exit(0);
    }

    if (selectedRun) {
      // In view mode - scrolling controls
      if (input === "b" || key.backspace) {
        setSelectedRun(null);
        setRecords([]);
        setPromptScroll(0);
        setCompletionScroll(0);
      } else if (input === "h" || key.leftArrow) {
        setCurrentRecordIdx((idx: number) => {
          const newIdx = Math.max(0, idx - 1);
          setPromptScroll(0);
          setCompletionScroll(0);
          return newIdx;
        });
      } else if (input === "l" || key.rightArrow) {
        setCurrentRecordIdx((idx: number) => {
          const newIdx = Math.min(records.length - 1, idx + 1);
          setPromptScroll(0);
          setCompletionScroll(0);
          return newIdx;
        });
      } else if (input === "j") {
        // Scroll prompt down
        setPromptScroll((scroll: number) => {
          const record = records[currentRecordIdx];
          const promptText = formatPromptOrCompletion(record.prompt);
          const promptLines = promptText.split("\n");
          const maxScroll = Math.max(0, promptLines.length - 13);
          return Math.min(maxScroll, scroll + 1);
        });
      } else if (input === "k") {
        // Scroll prompt up
        setPromptScroll((scroll: number) => Math.max(0, scroll - 1));
      } else if (input === "J" || input === "n") {
        // Scroll completion down (shift+j or n)
        setCompletionScroll((scroll: number) => {
          const record = records[currentRecordIdx];
          const completionText = formatPromptOrCompletion(record.completion);
          const completionLines = completionText.split("\n");
          const maxScroll = Math.max(0, completionLines.length - 13);
          return Math.min(maxScroll, scroll + 1);
        });
      } else if (input === "K" || input === "p") {
        // Scroll completion up (shift+k or p)
        setCompletionScroll((scroll: number) => Math.max(0, scroll - 1));
      } else if (input === "N") {
        // Shift+n - scroll completion down by 5 lines
        setCompletionScroll((scroll: number) => {
          const record = records[currentRecordIdx];
          const completionText = formatPromptOrCompletion(record.completion);
          const completionLines = completionText.split("\n");
          const maxScroll = Math.max(0, completionLines.length - 13);
          return Math.min(maxScroll, scroll + 5);
        });
      } else if (input === "P") {
        // Shift+p - scroll completion up by 5 lines
        setCompletionScroll((scroll: number) => Math.max(0, scroll - 5));
      }
      return;
    }

    // In tree view mode
    if (key.upArrow) {
      setSelectedIndex((idx) => Math.max(0, idx - 1));
    } else if (key.downArrow) {
      setSelectedIndex((idx) => Math.min(visibleNodes.length - 1, idx + 1));
    } else if (key.return || input === " ") {
      const node = visibleNodes[selectedIndex];
      if (node.type === "run" && node.runInfo) {
        setSelectedRun(node.runInfo);
      } else {
        // Toggle expansion
        const toggleNode = (nodes: TreeNode[]): TreeNode[] => {
          return nodes.map((n) => {
            if (n.id === node.id) {
              return { ...n, expanded: !n.expanded };
            }
            if (n.children.length > 0) {
              return { ...n, children: toggleNode(n.children) };
            }
            return n;
          });
        };
        setTree(toggleNode(tree));
      }
    } else if (key.leftArrow || key.rightArrow) {
      const node = visibleNodes[selectedIndex];
      if (node.children.length > 0) {
        const toggleNode = (nodes: TreeNode[]): TreeNode[] => {
          return nodes.map((n) => {
            if (n.id === node.id) {
              return { ...n, expanded: !n.expanded };
            }
            if (n.children.length > 0) {
              return { ...n, children: toggleNode(n.children) };
            }
            return n;
          });
        };
        setTree(toggleNode(tree));
      }
    }
  });

  if (selectedRun) {
    return (
      <ViewRunScreen
        run={selectedRun}
        currentRecordIdx={currentRecordIdx}
        records={records}
        promptScroll={promptScroll}
        completionScroll={completionScroll}
        onBack={() => {
          setSelectedRun(null);
          setRecords([]);
          setPromptScroll(0);
          setCompletionScroll(0);
        }}
        onPrevRecord={() => {
          setCurrentRecordIdx((idx) => {
            const newIdx = Math.max(0, idx - 1);
            setPromptScroll(0);
            setCompletionScroll(0);
            return newIdx;
          });
        }}
        onNextRecord={() => {
          setCurrentRecordIdx((idx) => {
            const newIdx = Math.min(records.length - 1, idx + 1);
            setPromptScroll(0);
            setCompletionScroll(0);
            return newIdx;
          });
        }}
      />
    );
  }

  if (tree.length === 0) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text>No evaluation results found in {outputsDir}</Text>
        <Text>Run evaluations with: pnpm vf-eval {'<'}env-id{'>'} -s</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" height="100%">
      <Box borderStyle="round" borderColor="cyan" padding={1} marginBottom={1} flexShrink={0}>
        <PrimeIntellectLogo />
      </Box>
      <Box flexGrow={1} flexShrink={1}>
        <TreeView
          tree={tree}
          selectedIndex={selectedIndex}
          visibleNodes={visibleNodes}
        />
      </Box>
      <Box marginTop={1} flexShrink={0}>
        <Text dimColor>
          ↑↓ Navigate | Space/Enter Expand/Select | → Expand | ← Collapse | q Quit
        </Text>
      </Box>
    </Box>
  );
}

type TreeViewProps = {
  tree: TreeNode[];
  selectedIndex: number;
  visibleNodes: TreeNode[];
};

function TreeView({ tree, selectedIndex, visibleNodes }: TreeViewProps) {
  const renderNode = (node: TreeNode, depth: number, isSelected: boolean): React.ReactNode => {
    const prefix = "  ".repeat(depth);
    const icon = node.children.length > 0 ? (node.expanded ? "▼" : "▶") : " ";
    const indent = depth > 0 ? "  " : "";
    
    return (
      <Box key={node.id} flexDirection="row">
        <Text color={isSelected ? "cyan" : undefined}>
          {prefix}{indent}{icon} {node.label}
        </Text>
      </Box>
    );
  };

  return (
    <Box flexDirection="column" height="100%">
      {visibleNodes.map((node, idx) => {
        const depth = calculateDepth(tree, node.id, 0);
        return renderNode(node, depth, idx === selectedIndex);
      })}
    </Box>
  );
}

function calculateDepth(nodes: TreeNode[], targetId: string, currentDepth: number): number {
  for (const node of nodes) {
    if (node.id === targetId) {
      return currentDepth;
    }
    if (node.children.length > 0) {
      const found = calculateDepth(node.children, targetId, currentDepth + 1);
      if (found !== -1) {
        return found;
      }
    }
  }
  return -1;
}

type ViewRunScreenProps = {
  run: RunInfo;
  currentRecordIdx: number;
  records: Record<string, any>[];
  promptScroll: number;
  completionScroll: number;
  onBack: () => void;
  onPrevRecord: () => void;
  onNextRecord: () => void;
};

function ViewRunScreen({
  run,
  currentRecordIdx,
  records,
  promptScroll,
  completionScroll,
  onBack,
  onPrevRecord,
  onNextRecord,
}: ViewRunScreenProps) {
  const panelHeight = 13; // Visible lines per panel (increased by 30% from 10)

  if (records.length === 0) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text>No records found in this run.</Text>
        <Box marginTop={1}>
          <Text dimColor>Press 'b' to go back, 'q' to quit</Text>
        </Box>
      </Box>
    );
  }

  const record = records[currentRecordIdx];
  const meta = run.metadata;
  const samplingArgs = meta.sampling_args || {};
  const avgReward = meta.avg_reward;
  const avgRewardStr =
    typeof avgReward === "number" ? avgReward.toFixed(3) : "N/A";

  const formatSamplingParam = (value: any): string => {
    return value != null ? String(value) : "N/A";
  };

  const temperatureStr = formatSamplingParam(samplingArgs.temperature);
  const maxTokensStr = formatSamplingParam(samplingArgs.max_tokens);

  const promptText = formatPromptOrCompletion(record.prompt);
  const completionText = formatPromptOrCompletion(record.completion);

  // Split text into lines for scrolling, with word wrapping
  // Estimate panel width (50% of screen, minus padding/borders, roughly 40 chars)
  const estimatedPanelWidth = 40;
  const promptLinesRaw = promptText.split("\n");
  const completionLinesRaw = completionText.split("\n");
  
  // Wrap long lines
  const promptLines: string[] = [];
  for (const line of promptLinesRaw) {
    if (line.length > estimatedPanelWidth) {
      promptLines.push(...wrapText(line, estimatedPanelWidth));
    } else {
      promptLines.push(line);
    }
  }
  
  const completionLines: string[] = [];
  for (const line of completionLinesRaw) {
    if (line.length > estimatedPanelWidth) {
      completionLines.push(...wrapText(line, estimatedPanelWidth));
    } else {
      completionLines.push(line);
    }
  }

  // Calculate visible lines based on scroll position
  const visiblePromptLines = promptLines.slice(promptScroll, promptScroll + panelHeight);
  const visibleCompletionLines = completionLines.slice(completionScroll, completionScroll + panelHeight);

  const promptMaxScroll = Math.max(0, promptLines.length - panelHeight);
  const completionMaxScroll = Math.max(0, completionLines.length - panelHeight);
  
  // Calculate scroll percentages for visual indicators
  const promptScrollPercent = promptMaxScroll > 0 ? promptScroll / promptMaxScroll : 0;
  const completionScrollPercent = completionMaxScroll > 0 ? completionScroll / completionMaxScroll : 0;

  const details: string[] = [];
  if (record.reward != null) {
    details.push(`Reward: ${typeof record.reward === "number" ? record.reward.toFixed(3) : record.reward}`);
  }
  if (record.answer) {
    details.push(`Answer: ${record.answer}`);
  }
  if (record.task && record.task !== "default") {
    details.push(`Task: ${record.task}`);
  }
  if (record.metrics && Object.keys(record.metrics).length > 0) {
    const metricsStr = Object.entries(record.metrics)
      .map(([k, v]) => `${k}=${typeof v === "number" ? v.toFixed(3) : v}`)
      .join(", ");
    details.push(`Metrics: ${metricsStr}`);
  }
  if (record.info && Object.keys(record.info).length > 0) {
    try {
      details.push(`Info: ${JSON.stringify(record.info, null, 2)}`);
    } catch {
      details.push(`Info: ${String(record.info)}`);
    }
  }

  return (
    <Box flexDirection="column">
      {/* Metadata Panel */}
      <Box
        borderStyle="round"
        borderColor="cyan"
        padding={1}
        marginBottom={1}
      >
        <Box flexDirection="row">
          {/* Column 1 */}
          <Box width="33%" flexDirection="column">
            <Text>
              <Text bold>Environment: </Text>
              {run.envId}
            </Text>
            <Text>
              <Text bold>Model: </Text>
              {run.model}
            </Text>
            <Text>
              <Text bold>Run ID: </Text>
              {run.runId}
            </Text>
            <Text>
              <Text bold>Date: </Text>
              {`${meta.date || ""} ${meta.time || ""}`.trim() || "N/A"}
            </Text>
          </Box>
          {/* Column 2 */}
          <Box width="34%" flexDirection="column">
            <Text>
              <Text bold>Record: </Text>
              {currentRecordIdx + 1}/{records.length}
            </Text>
            <Text>
              <Text bold>Examples: </Text>
              {meta.num_examples || "N/A"}
            </Text>
            <Text>
              <Text bold>Rollouts/ex: </Text>
              {meta.rollouts_per_example || "N/A"}
            </Text>
            <Text>
              <Text bold>Avg reward: </Text>
              {avgRewardStr}
            </Text>
          </Box>
          {/* Column 3 */}
          <Box width="33%" flexDirection="column">
            <Text>
              <Text bold>Max tokens: </Text>
              {maxTokensStr}
            </Text>
            <Text>
              <Text bold>Temperature: </Text>
              {temperatureStr}
            </Text>
          </Box>
        </Box>
      </Box>

      {/* Two-column layout for Prompt and Completion */}
      <Box flexDirection="row" marginBottom={1}>
        <Box
          borderStyle="round"
          borderColor="green"
          padding={1}
          width="50%"
          marginRight={1}
          flexDirection="column"
        >
          <Box marginBottom={1} flexDirection="row" justifyContent="space-between">
            <Text bold>Prompt</Text>
            {promptLines.length > panelHeight && (
              <Box flexDirection="row">
                <Text dimColor>
                  {promptScroll + 1}-{Math.min(promptScroll + panelHeight, promptLines.length)}/{promptLines.length}
                </Text>
                <Text dimColor> </Text>
                {/* Visual scroll indicator */}
                <Text dimColor>
                  [{Math.round(promptScrollPercent * 10)}█{10 - Math.round(promptScrollPercent * 10)}]
                </Text>
              </Box>
            )}
          </Box>
          <Box height={panelHeight} flexDirection="column">
            {visiblePromptLines.map((line, idx) => {
              // Color code by role if line starts with a role
              const roleMatch = line.match(/^(\w+):\s*(.*)$/);
              if (roleMatch) {
                const [, role, content] = roleMatch;
                const roleColor = role === "assistant" ? "cyan" : role === "user" ? "green" : "white";
                return (
                  <Text key={idx}>
                    <Text bold color={roleColor}>{role}:</Text> <Text>{content}</Text>
                  </Text>
                );
              }
              return <Text key={idx}>{line || " "}</Text>;
            })}
          </Box>
          {promptScroll > 0 && (
            <Box>
              <Text dimColor>↑ Scroll up (k)</Text>
            </Box>
          )}
          {promptScroll < promptMaxScroll && (
            <Box>
              <Text dimColor>↓ Scroll down (j)</Text>
            </Box>
          )}
        </Box>
        <Box
          borderStyle="round"
          borderColor="yellow"
          padding={1}
          width="50%"
          flexDirection="column"
        >
          <Box marginBottom={1} flexDirection="row" justifyContent="space-between">
            <Text bold>Completion</Text>
            {completionLines.length > panelHeight && (
              <Box flexDirection="row">
                <Text dimColor>
                  {completionScroll + 1}-{Math.min(completionScroll + panelHeight, completionLines.length)}/{completionLines.length}
                </Text>
                <Text dimColor> </Text>
                {/* Visual scroll indicator */}
                <Text dimColor>
                  [{Math.round(completionScrollPercent * 10)}█{10 - Math.round(completionScrollPercent * 10)}]
                </Text>
              </Box>
            )}
          </Box>
          <Box height={panelHeight} flexDirection="column">
            {visibleCompletionLines.map((line, idx) => {
              // Color code by role if line starts with a role
              const roleMatch = line.match(/^(\w+):\s*(.*)$/);
              if (roleMatch) {
                const [, role, content] = roleMatch;
                const roleColor = role === "assistant" ? "cyan" : role === "user" ? "green" : "yellow";
                return (
                  <Text key={idx}>
                    <Text bold color={roleColor}>{role}:</Text> <Text>{content}</Text>
                  </Text>
                );
              }
              return <Text key={idx}>{line || " "}</Text>;
            })}
          </Box>
        </Box>
      </Box>

      {/* Details Panel */}
      <Box
        borderStyle="round"
        borderColor="magenta"
        padding={1}
      >
        {details.length > 0 ? (
          <Text>{details.join("\n")}</Text>
        ) : (
          <Text dimColor>No additional details</Text>
        )}
      </Box>

      {/* Footer */}
      <Box marginTop={1}>
        <Text dimColor>
          Navigation: 'b' back | 'h'/'←' prev | 'l'/'→' next | 'j'/'k' scroll prompt | 'n'/'p' scroll completion (N/P for page) | mouse wheel works too | 'q' quit
        </Text>
      </Box>
    </Box>
  );
}

function main() {
  const args = process.argv.slice(2);
  const outputsDir = args[0] || process.env.VF_OUTPUTS_DIR || "./outputs";

  render(<VerifiersTUI outputsDir={outputsDir} />);
}

main();
