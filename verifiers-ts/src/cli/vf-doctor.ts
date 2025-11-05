#!/usr/bin/env node

import process from "process";

function checkApiKey(): boolean {
  if (process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.trim()) {
    console.log("✓ OPENAI_API_KEY detected.");
    return true;
  }

  console.warn("⚠ OPENAI_API_KEY is not set. Structured runs will fail without a provider key.");
  return false;
}

function main() {
  console.log("verifiers-ts doctor");
  console.log("-------------------");

  const apiKeyOk = checkApiKey();

  if (!apiKeyOk) {
    process.exitCode = 1;
    console.log("\nSet the variable and retry:");
    console.log("  export OPENAI_API_KEY=sk-...");
  } else {
    console.log("\nAll essential checks passed. Happy verifying!");
  }
}

main();
