import { defineConfig } from "hardhat/config";
import hardhatViem from "@nomicfoundation/hardhat-viem";
import hardhatViemAssertions from "@nomicfoundation/hardhat-viem-assertions";
import hardhatNodeTestRunner from "@nomicfoundation/hardhat-node-test-runner";
import hardhatNetworkHelpers from "@nomicfoundation/hardhat-network-helpers";

// ─────────────────────────────────────────────────────────────────────────────
// Hardhat 3 config — Pinion OS fork tests
//
// KEY DIFFERENCES from Hardhat 2:
//   ✗  type: "hardhat"      → does NOT exist in Hardhat 3
//   ✗  networks.hardhat: {} → Hardhat 2 only; causes HHE15 in Hardhat 3
//   ✓  type: "edr-simulated" → correct Hardhat 3 value for in-process simulations
//   ✓  type: "http"          → correct Hardhat 3 value for external JSON-RPC nodes
//   ✓  The built-in "default" network is always edr-simulated; no need to declare it
//
// Run:
//   export BASE_RPC_URL=https://mainnet.base.org
//   npx hardhat test test/PinionOsForkTest.ts --network baseFork
// ─────────────────────────────────────────────────────────────────────────────

export default defineConfig({
  plugins: [
    hardhatViem,
    hardhatViemAssertions,
    hardhatNodeTestRunner,
    hardhatNetworkHelpers,
  ],

  solidity: {
    version: "0.8.28",
  },

  networks: {
    // ── Base mainnet fork ─────────────────────────────────────────────────────
    // type: "edr-simulated" = in-process EDR simulation that forks a remote chain.
    // This is the only correct value for simulated networks in Hardhat 3.
    // Do NOT use type: "hardhat" — that key does not exist in Hardhat 3.
    baseFork: {
      type: "edr-simulated",
      forking: {
        url: process.env.BASE_RPC_URL ?? "https://mainnet.base.org",
        blockNumber: 28_000_000, // pin for reproducibility
      },
    },
  },

  paths: {
    sources:   "./contracts",
    tests:     "./tests",
    artifacts: "./artifacts",
  },
});