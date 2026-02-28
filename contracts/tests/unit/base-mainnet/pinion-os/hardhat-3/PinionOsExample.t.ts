/**
 * @file  PinionOsExample.t.ts
 * @title Hardhat 3 · Base mainnet fork test for Pinion OS x402 payment flow
 *
 * Run:
 *   export BASE_RPC_URL=https://mainnet.base.org
 *   npx hardhat test tests/unit/base-mainnet/pinion-os/hardhat-3/PinionOsExample.t.ts --network baseFork
 */

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";

import hre from "hardhat";
import {
  type PublicClient,
  type Address,
  type Hex,
  toHex,
  parseEther,
} from "viem";

// ─────────────────────────────────────────────────────────────────────────────
// Constants — Base mainnet
// ─────────────────────────────────────────────────────────────────────────────

const USDC_ADDRESS: Address = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const PINION_SKILL_COST      = 10_000n;       // $0.01 USDC (6 decimals)
const PINION_UNLIMITED_COST  = 100_000_000n;  // $100 USDC (6 decimals)
const PINION_PAYTO: Address  = "0xf9c9A7735aaB3C665197725A3aFC095fE2635d09";
const USER_PRIV_KEY: Hex     =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

// ─────────────────────────────────────────────────────────────────────────────
// EIP-712 typed data definition for USDC TransferWithAuthorization
// ─────────────────────────────────────────────────────────────────────────────

const USDC_DOMAIN = {
  name:              "USD Coin",
  version:           "2",
  chainId:           8453,          // Base mainnet
  verifyingContract: USDC_ADDRESS,
} as const;

const TRANSFER_WITH_AUTHORIZATION_TYPES = {
  TransferWithAuthorization: [
    { name: "from",        type: "address" },
    { name: "to",          type: "address" },
    { name: "value",       type: "uint256" },
    { name: "validAfter",  type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce",       type: "bytes32" },
  ],
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Minimal USDC ABI
// ─────────────────────────────────────────────────────────────────────────────

const USDC_ABI = [
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs:  [{ name: "account", type: "address" }],
    outputs: [{ name: "",        type: "uint256"  }],
  },
  {
    name: "transfer",
    type: "function",
    stateMutability: "nonpayable",
    inputs:  [{ name: "to", type: "address" }, { name: "value", type: "uint256" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    name: "transferWithAuthorization",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "from",        type: "address" },
      { name: "to",          type: "address" },
      { name: "value",       type: "uint256" },
      { name: "validAfter",  type: "uint256" },
      { name: "validBefore", type: "uint256" },
      { name: "nonce",       type: "bytes32" },
      { name: "v",           type: "uint8"   },
      { name: "r",           type: "bytes32" },
      { name: "s",           type: "bytes32" },
    ],
    outputs: [],
  },
  {
    name: "authorizationState",
    type: "function",
    stateMutability: "view",
    inputs:  [{ name: "authorizer", type: "address" }, { name: "nonce", type: "bytes32" }],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

// ─────────────────────────────────────────────────────────────────────────────
// EIP-3009 signing helper
//
// KEY FIX: Use account.signTypedData() instead of any manual digest construction.
//
// All previous approaches failed because we manually computed the EIP-712 digest
// and then tried to sign it raw — any subtle difference in encoding (padding,
// name hash, version hash) causes "FiatTokenV2: invalid signature".
//
// signTypedData() is the CORRECT approach:
//  - viem handles the entire domain separator + struct hash + \x19\x01 encoding
//  - It calls the USDC contract's actual EIP-712 domain specification
//  - The output (v, r, s) is exactly what transferWithAuthorization expects
// ─────────────────────────────────────────────────────────────────────────────

async function signTransferWithAuthorization(params: {
  privateKey:  Hex;
  from:        Address;
  to:          Address;
  value:       bigint;
  validAfter:  bigint;
  validBefore: bigint;
  nonce:       Hex;
}): Promise<{ v: number; r: Hex; s: Hex }> {
  const { privateKeyToAccount } = await import("viem/accounts");
  const account = privateKeyToAccount(params.privateKey);

  // signTypedData: viem computes \x19\x01 + domainSeparator + structHash internally
  const sig = await account.signTypedData({
    domain: USDC_DOMAIN,
    types:  TRANSFER_WITH_AUTHORIZATION_TYPES,
    primaryType: "TransferWithAuthorization",
    message: {
      from:        params.from,
      to:          params.to,
      value:       params.value,
      validAfter:  params.validAfter,
      validBefore: params.validBefore,
      nonce:       params.nonce,
    },
  });

  // sig is 0x + 130 hex chars: r(32) + s(32) + v(1)
  const r = `0x${sig.slice(2, 66)}`   as Hex;
  const s = `0x${sig.slice(66, 130)}` as Hex;
  const v = parseInt(sig.slice(130, 132), 16);
  return { v, r, s };
}

// ─────────────────────────────────────────────────────────────────────────────
// Network (module-level, shared across all tests)
// ─────────────────────────────────────────────────────────────────────────────

const { viem, networkHelpers } = await hre.network.connect("baseFork");

// ─────────────────────────────────────────────────────────────────────────────
// Test suite
// ─────────────────────────────────────────────────────────────────────────────

describe("PinionOsForkTest — Base mainnet fork (Hardhat 3 / viem)", async () => {

  let userAddress:  Address;
  let publicClient: PublicClient;

  before(async () => {
    const { privateKeyToAccount } = await import("viem/accounts");
    userAddress  = privateKeyToAccount(USER_PRIV_KEY).address;
    publicClient = await viem.getPublicClient();

    await networkHelpers.setBalance(userAddress, parseEther("1"));

    // Seed 200 USDC via whale impersonation (mirrors Foundry's deal())
    const whale: Address = "0x20FE51A9229EEf2cF8Ad9E89d91CAb9312cF3b7A";
    await networkHelpers.impersonateAccount(whale);
    await networkHelpers.setBalance(whale, parseEther("10"));
    const whaleWallet = await viem.getWalletClient(whale);

    const { request } = await publicClient.simulateContract({
      address: USDC_ADDRESS, abi: USDC_ABI,
      functionName: "transfer", args: [userAddress, 200_000_000n],
      account: whale,
    });
    await whaleWallet.writeContract(request);

    const ethBal  = await publicClient.getBalance({ address: userAddress });
    const usdcBal = await publicClient.readContract({
      address: USDC_ADDRESS, abi: USDC_ABI,
      functionName: "balanceOf", args: [userAddress],
    });
    console.log("=== setUp complete ===");
    console.log("User address  :", userAddress);
    console.log("ETH balance   :", ethBal.toString());
    console.log("USDC balance  :", usdcBal.toString());
  });

  // ── Helper: simulate a single Pinion x402 skill payment ($0.01 USDC) ─────
  async function simulatePinionSkillPayment(nonceIndex: number): Promise<void> {
    const nonce       = toHex(nonceIndex, { size: 32 }) as Hex;
    const validBefore = BigInt(Math.floor(Date.now() / 1000) + 3600);

    const { v, r, s } = await signTransferWithAuthorization({
      privateKey: USER_PRIV_KEY,
      from: userAddress, to: PINION_PAYTO,
      value: PINION_SKILL_COST, validAfter: 0n, validBefore, nonce,
    });

    await networkHelpers.impersonateAccount(PINION_PAYTO);
    await networkHelpers.setBalance(PINION_PAYTO, parseEther("1"));

    const { request } = await publicClient.simulateContract({
      address: USDC_ADDRESS, abi: USDC_ABI,
      functionName: "transferWithAuthorization",
      args: [userAddress, PINION_PAYTO, PINION_SKILL_COST, 0n, validBefore, nonce, v, r, s],
      account: PINION_PAYTO,
    });
    const paytoWallet = await viem.getWalletClient(PINION_PAYTO);
    await paytoWallet.writeContract(request);
  }

  // ── Test 1 ────────────────────────────────────────────────────────────────
  it("Test 1 — balance skill: reads correct ETH and USDC balances", async () => {
    const ethBal = await publicClient.getBalance({ address: userAddress });
    assert.equal(ethBal, parseEther("1"));

    const usdcBal = await publicClient.readContract({
      address: USDC_ADDRESS, abi: USDC_ABI,
      functionName: "balanceOf", args: [userAddress],
    });
    assert.equal(usdcBal, 200_000_000n);

    console.log("✅ Balance skill | ETH:", ethBal, "USDC:", usdcBal);
  });

  // ── Test 2 ────────────────────────────────────────────────────────────────
  it("Test 2 — wallet skill: $0.01 USDC payment settles via EIP-3009", async () => {
    const nonce       = toHex(1, { size: 32 }) as Hex;
    const validBefore = BigInt(Math.floor(Date.now() / 1000) + 3600);

    const uBefore = await publicClient.readContract({
      address: USDC_ADDRESS, abi: USDC_ABI, functionName: "balanceOf", args: [userAddress],
    });
    const pBefore = await publicClient.readContract({
      address: USDC_ADDRESS, abi: USDC_ABI, functionName: "balanceOf", args: [PINION_PAYTO],
    });

    const { v, r, s } = await signTransferWithAuthorization({
      privateKey: USER_PRIV_KEY,
      from: userAddress, to: PINION_PAYTO,
      value: PINION_SKILL_COST, validAfter: 0n, validBefore, nonce,
    });

    await networkHelpers.impersonateAccount(PINION_PAYTO);
    await networkHelpers.setBalance(PINION_PAYTO, parseEther("1"));

    const { request } = await publicClient.simulateContract({
      address: USDC_ADDRESS, abi: USDC_ABI,
      functionName: "transferWithAuthorization",
      args: [userAddress, PINION_PAYTO, PINION_SKILL_COST, 0n, validBefore, nonce, v, r, s],
      account: PINION_PAYTO,
    });
    await (await viem.getWalletClient(PINION_PAYTO)).writeContract(request);

    const uAfter = await publicClient.readContract({
      address: USDC_ADDRESS, abi: USDC_ABI, functionName: "balanceOf", args: [userAddress],
    });
    const pAfter = await publicClient.readContract({
      address: USDC_ADDRESS, abi: USDC_ABI, functionName: "balanceOf", args: [PINION_PAYTO],
    });

    assert.equal(uAfter, uBefore - PINION_SKILL_COST, "User USDC decreases");
    assert.equal(pAfter, pBefore + PINION_SKILL_COST, "payTo USDC increases");

    const nonceUsed = await publicClient.readContract({
      address: USDC_ADDRESS, abi: USDC_ABI,
      functionName: "authorizationState", args: [userAddress, nonce],
    });
    assert.equal(nonceUsed, true, "Nonce consumed");

    console.log("✅ Wallet skill | $0.01 settled, nonce consumed");
  });

  // ── Test 3 ────────────────────────────────────────────────────────────────
  it("Test 3 — wallet skill: EIP-3009 nonce cannot be replayed", async () => {
    const nonce       = toHex(42, { size: 32 }) as Hex;
    const validBefore = BigInt(Math.floor(Date.now() / 1000) + 3600);

    const { v, r, s } = await signTransferWithAuthorization({
      privateKey: USER_PRIV_KEY,
      from: userAddress, to: PINION_PAYTO,
      value: PINION_SKILL_COST, validAfter: 0n, validBefore, nonce,
    });

    await networkHelpers.impersonateAccount(PINION_PAYTO);
    await networkHelpers.setBalance(PINION_PAYTO, parseEther("1"));
    const paytoWallet = await viem.getWalletClient(PINION_PAYTO);

    const { request } = await publicClient.simulateContract({
      address: USDC_ADDRESS, abi: USDC_ABI,
      functionName: "transferWithAuthorization",
      args: [userAddress, PINION_PAYTO, PINION_SKILL_COST, 0n, validBefore, nonce, v, r, s],
      account: PINION_PAYTO,
    });
    await paytoWallet.writeContract(request);

    await assert.rejects(() => publicClient.simulateContract({
      address: USDC_ADDRESS, abi: USDC_ABI,
      functionName: "transferWithAuthorization",
      args: [userAddress, PINION_PAYTO, PINION_SKILL_COST, 0n, validBefore, nonce, v, r, s],
      account: PINION_PAYTO,
    }), "Replay must revert");

    console.log("✅ Replay correctly rejected");
  });

  // ── Tests 4–7 ─────────────────────────────────────────────────────────────
  it("Test 4 — chat skill: deducts $0.01 USDC", async () => {
    const before = await publicClient.readContract({ address: USDC_ADDRESS, abi: USDC_ABI, functionName: "balanceOf", args: [userAddress] });
    await simulatePinionSkillPayment(100);
    const after = await publicClient.readContract({ address: USDC_ADDRESS, abi: USDC_ABI, functionName: "balanceOf", args: [userAddress] });
    assert.equal(after, before - PINION_SKILL_COST);
    console.log("✅ Chat skill | $0.01 deducted");
  });

  it("Test 5 — price skill: deducts $0.01 USDC", async () => {
    const before = await publicClient.readContract({ address: USDC_ADDRESS, abi: USDC_ABI, functionName: "balanceOf", args: [userAddress] });
    await simulatePinionSkillPayment(200);
    const after = await publicClient.readContract({ address: USDC_ADDRESS, abi: USDC_ABI, functionName: "balanceOf", args: [userAddress] });
    assert.equal(after, before - PINION_SKILL_COST);
    console.log("✅ Price skill | $0.01 deducted");
  });

  it("Test 6 — trade skill: deducts $0.01 USDC", async () => {
    const before = await publicClient.readContract({ address: USDC_ADDRESS, abi: USDC_ABI, functionName: "balanceOf", args: [userAddress] });
    await simulatePinionSkillPayment(300);
    const after = await publicClient.readContract({ address: USDC_ADDRESS, abi: USDC_ABI, functionName: "balanceOf", args: [userAddress] });
    assert.equal(after, before - PINION_SKILL_COST);
    console.log("✅ Trade skill | $0.01 deducted");
  });

  it("Test 7 — fund skill: deducts $0.01 USDC", async () => {
    const before = await publicClient.readContract({ address: USDC_ADDRESS, abi: USDC_ABI, functionName: "balanceOf", args: [userAddress] });
    await simulatePinionSkillPayment(400);
    const after = await publicClient.readContract({ address: USDC_ADDRESS, abi: USDC_ABI, functionName: "balanceOf", args: [userAddress] });
    assert.equal(after, before - PINION_SKILL_COST);
    console.log("✅ Fund skill | $0.01 deducted");
  });

  // ── Test 8 ────────────────────────────────────────────────────────────────
  it("Test 8 — unlimited plan: settles exactly $100 USDC", async () => {
    const nonce       = toHex(9999, { size: 32 }) as Hex;
    const validBefore = BigInt(Math.floor(Date.now() / 1000) + 3600);

    const uBefore = await publicClient.readContract({ address: USDC_ADDRESS, abi: USDC_ABI, functionName: "balanceOf", args: [userAddress] });
    const pBefore = await publicClient.readContract({ address: USDC_ADDRESS, abi: USDC_ABI, functionName: "balanceOf", args: [PINION_PAYTO] });

    const { v, r, s } = await signTransferWithAuthorization({
      privateKey: USER_PRIV_KEY,
      from: userAddress, to: PINION_PAYTO,
      value: PINION_UNLIMITED_COST, validAfter: 0n, validBefore, nonce,
    });

    await networkHelpers.impersonateAccount(PINION_PAYTO);
    await networkHelpers.setBalance(PINION_PAYTO, parseEther("1"));

    const { request } = await publicClient.simulateContract({
      address: USDC_ADDRESS, abi: USDC_ABI,
      functionName: "transferWithAuthorization",
      args: [userAddress, PINION_PAYTO, PINION_UNLIMITED_COST, 0n, validBefore, nonce, v, r, s],
      account: PINION_PAYTO,
    });
    await (await viem.getWalletClient(PINION_PAYTO)).writeContract(request);

    const uAfter = await publicClient.readContract({ address: USDC_ADDRESS, abi: USDC_ABI, functionName: "balanceOf", args: [userAddress] });
    const pAfter = await publicClient.readContract({ address: USDC_ADDRESS, abi: USDC_ABI, functionName: "balanceOf", args: [PINION_PAYTO] });

    assert.equal(uAfter, uBefore - PINION_UNLIMITED_COST);
    assert.equal(pAfter, pBefore + PINION_UNLIMITED_COST);

    console.log("✅ Unlimited plan | $100 settled");
  });

  // ── Test 9 ────────────────────────────────────────────────────────────────
  it("Test 9 — insufficient funds: payment reverts with 0 USDC", async () => {
    const brokeKey: Hex =
      "0xbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbad0";
    const { privateKeyToAccount } = await import("viem/accounts");
    const brokeAddress = privateKeyToAccount(brokeKey).address;

    await networkHelpers.setBalance(brokeAddress, parseEther("1"));

    const nonce       = toHex(500, { size: 32 }) as Hex;
    const validBefore = BigInt(Math.floor(Date.now() / 1000) + 3600);

    const { v, r, s } = await signTransferWithAuthorization({
      privateKey: brokeKey,
      from: brokeAddress, to: PINION_PAYTO,
      value: PINION_SKILL_COST, validAfter: 0n, validBefore, nonce,
    });

    await networkHelpers.impersonateAccount(PINION_PAYTO);

    await assert.rejects(() => publicClient.simulateContract({
      address: USDC_ADDRESS, abi: USDC_ABI,
      functionName: "transferWithAuthorization",
      args: [brokeAddress, PINION_PAYTO, PINION_SKILL_COST, 0n, validBefore, nonce, v, r, s],
      account: PINION_PAYTO,
    }), "Must revert with 0 balance");

    console.log("✅ Insufficient funds | correctly rejected");
  });

  // ── Test 10 ───────────────────────────────────────────────────────────────
  it("Test 10 — expired authorization: validBefore in the past reverts", async () => {
    const nonce     = toHex(600, { size: 32 }) as Hex;
    const expiredTs = BigInt(Math.floor(Date.now() / 1000) - 10);

    const { v, r, s } = await signTransferWithAuthorization({
      privateKey: USER_PRIV_KEY,
      from: userAddress, to: PINION_PAYTO,
      value: PINION_SKILL_COST, validAfter: 0n, validBefore: expiredTs, nonce,
    });

    await networkHelpers.impersonateAccount(PINION_PAYTO);

    await assert.rejects(() => publicClient.simulateContract({
      address: USDC_ADDRESS, abi: USDC_ABI,
      functionName: "transferWithAuthorization",
      args: [userAddress, PINION_PAYTO, PINION_SKILL_COST, 0n, expiredTs, nonce, v, r, s],
      account: PINION_PAYTO,
    }), "Expired must revert");

    console.log("✅ Expired authorization | correctly rejected");
  });

  // ── Test 11 ───────────────────────────────────────────────────────────────
  it("Test 11 — full example flow: 5 skills = $0.05 USDC total", async () => {
    const usdcBefore = await publicClient.readContract({
      address: USDC_ADDRESS, abi: USDC_ABI, functionName: "balanceOf", args: [userAddress],
    });

    for (let i = 1; i <= 5; i++) {
      await simulatePinionSkillPayment(i * 1000);
    }

    const usdcAfter = await publicClient.readContract({
      address: USDC_ADDRESS, abi: USDC_ABI, functionName: "balanceOf", args: [userAddress],
    });

    assert.equal(usdcAfter, usdcBefore - 5n * PINION_SKILL_COST);
    console.log("✅ Full flow | 50000 units deducted (=$0.05)");
  });

  // ── Test 12 ───────────────────────────────────────────────────────────────
  it("Test 12 — validAfter: blocked before window, succeeds after time.increase", async () => {
    const nonce = toHex(700, { size: 32 }) as Hex;

    // Use EVM block.timestamp — NOT Date.now() — as baseline
    const block      = await publicClient.getBlock();
    const evmNow     = block.timestamp;
    const validAfter  = evmNow + 3600n;
    const validBefore = evmNow + 7200n;

    const { v, r, s } = await signTransferWithAuthorization({
      privateKey: USER_PRIV_KEY,
      from: userAddress, to: PINION_PAYTO,
      value: PINION_SKILL_COST, validAfter, validBefore, nonce,
    });

    await networkHelpers.impersonateAccount(PINION_PAYTO);
    await networkHelpers.setBalance(PINION_PAYTO, parseEther("1"));

    // Before validAfter — must revert
    await assert.rejects(() => publicClient.simulateContract({
      address: USDC_ADDRESS, abi: USDC_ABI,
      functionName: "transferWithAuthorization",
      args: [userAddress, PINION_PAYTO, PINION_SKILL_COST, validAfter, validBefore, nonce, v, r, s],
      account: PINION_PAYTO,
    }), "Must revert before validAfter");

    // Advance EVM time past validAfter
    await networkHelpers.time.increase(3601);

    // After validAfter — must succeed
    const { request } = await publicClient.simulateContract({
      address: USDC_ADDRESS, abi: USDC_ABI,
      functionName: "transferWithAuthorization",
      args: [userAddress, PINION_PAYTO, PINION_SKILL_COST, validAfter, validBefore, nonce, v, r, s],
      account: PINION_PAYTO,
    });
    await (await viem.getWalletClient(PINION_PAYTO)).writeContract(request);

    const nonceUsed = await publicClient.readContract({
      address: USDC_ADDRESS, abi: USDC_ABI,
      functionName: "authorizationState", args: [userAddress, nonce],
    });
    assert.equal(nonceUsed, true);

    console.log("✅ validAfter | blocked before window, succeeded after time.increase");
  });
});