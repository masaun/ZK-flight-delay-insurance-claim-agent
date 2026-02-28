import { defineConfig } from "hardhat/config";
import hardhatViem from "@nomicfoundation/hardhat-viem";
import hardhatViemAssertions from "@nomicfoundation/hardhat-viem-assertions";
import hardhatNodeTestRunner from "@nomicfoundation/hardhat-node-test-runner";
import hardhatNetworkHelpers from "@nomicfoundation/hardhat-network-helpers";

// ─────────────────────────────────────────────────────────────────────────────
// Hardhat 3 config — Pinion OS fork tests
//
// KEY FIXES applied here:
//
// FIX 1 — blockNumber removed (hardfork history error)
//   EDR error: "No known hardfork for execution on historical block 28000000
//   in chain with id 8453. The node was not configured with a hardfork
//   activation history."
//   Root cause: EDR doesn't know Base's OP-stack hardfork schedule. Pinning
//   blockNumber forces EDR to execute AT that exact block, which requires the
//   full hardfork activation history for chainId 8453 — not available in EDR.
//   Fix: remove blockNumber entirely. EDR forks from "latest" which it handles
//   correctly. Tests remain deterministic enough for payment-flow checks.
//
// FIX 2 — chainType: "l2" added
//   Tells EDR this is an OP-stack L2. Without this, EDR applies Ethereum L1
//   hardfork rules to Base, which can cause subtle execution differences.
//
// Run:
//   export BASE_RPC_URL=https://mainnet.base.org
//   npx hardhat test tests/unit/base-mainnet/pinion-os/hardhat-3/PinionOsExample.t.ts --network baseFork
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
    baseFork: {
      type: "edr-simulated",
      chainType: "op",   // ✅ Base is OP-stack
      forking: {
        url: process.env.BASE_RPC_URL ?? "https://mainnet.base.org",
        // no blockNumber
      },
    },
  },

  paths: {
    sources: "./contracts",
    tests: "./tests",
    artifacts: "./artifacts",
  },
});