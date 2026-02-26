#!/usr/bin/env node
import { runAllTests } from "./zkp-generation.ts";

try {
  await runAllTests();
} catch (error) {
  console.error("Failed to run tests:", error);
  process.exit(1);
}
