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
  encodeAbiParameters,
  keccak256,
  concat,
  toHex,
  parseEther,
  toBytes,
} from "viem";

// ─────────────────────────────────────────────────────────────────────────────
// Constants — Base mainnet
// ─────────────────────────────────────────────────────────────────────────────

const USDC_ADDRESS: Address = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const BASE_CHAIN_ID          = 8453n;
const PINION_SKILL_COST      = 10_000n;       // $0.01 USDC (6 decimals)
const PINION_UNLIMITED_COST  = 100_000_000n;  // $100 USDC (6 decimals)
const PINION_PAYTO: Address  = "0xf9c9A7735aaB3C665197725A3aFC095fE2635d09";
const USER_PRIV_KEY: Hex     =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

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
// EIP-712 / EIP-3009 helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build a raw EIP-712 digest for TransferWithAuthorization.
 * Returns the final 32-byte hash ready for raw secp256k1 signing.
 * No EIP-191 prefix is added here — that must NOT be added for EIP-3009.
 */
function buildEIP3009Digest(params: {
  from:        Address;
  to:          Address;
  value:       bigint;
  validAfter:  bigint;
  validBefore: bigint;
  nonce:       Hex;
}): Hex {
  const { from, to, value, validAfter, validBefore, nonce } = params;

  const enc = (s: string) => toBytes(s);

  const DOMAIN_TYPEHASH = keccak256(enc(
    "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
  ));
  const TRANSFER_TYPEHASH = keccak256(enc(
    "TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
  ));

  const domainSeparator = keccak256(encodeAbiParameters(
    [
      { type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" },
      { type: "uint256" }, { type: "address" },
    ],
    [
      DOMAIN_TYPEHASH,
      keccak256(enc("USD Coin")),
      keccak256(enc("2")),
      BASE_CHAIN_ID,
      USDC_ADDRESS,
    ]
  ));

  const structHash = keccak256(encodeAbiParameters(
    [
      { type: "bytes32" }, { type: "address" }, { type: "address" },
      { type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "bytes32" },
    ],
    [TRANSFER_TYPEHASH, from, to, value, validAfter, validBefore, nonce]
  ));

  // \x19\x01 + domainSeparator + structHash
  return keccak256(concat(["0x1901", domainSeparator, structHash]));
}

/**
 * Sign a raw EIP-712 digest using viem's bare `sign()` from viem/accounts.
 *
 * CRITICAL: Do NOT use walletClient.signMessage() here.
 * signMessage() prepends the EIP-191 "\x19Ethereum Signed Message:\n32" prefix,
 * which produces a double-hashed digest that Circle's FiatTokenV2 rejects with
 * "invalid signature". The sign() function from viem/accounts does a raw
 * secp256k1 sign with no prefix — exactly what EIP-3009 requires.
 */
async function signEIP3009(
  privateKey: Hex,
  digest: Hex
): Promise<{ v: number; r: Hex; s: Hex }> {
  const { sign } = await import("viem/accounts");
  const sig = await sign({ hash: digest, privateKey });
  return { v: Number(sig.v), r: sig.r, s: sig.s };
}

// ─────────────────────────────────────────────────────────────────────────────
// Network connection (module-level, shared across all tests in this file)
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

    // Fund user with ETH for gas
    await networkHelpers.setBalance(userAddress, parseEther("1"));

    // Seed 200 USDC via whale impersonation (mirrors Foundry's deal())
    // The whale transfer uses simulateContract + a wallet client for the whale,
    // NOT viem.getWalletClient(whale) — that would require the node to own the key.
    // impersonateAccount() tells the node to accept txs from this address.
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

    const digest = buildEIP3009Digest({
      from: userAddress, to: PINION_PAYTO,
      value: PINION_SKILL_COST, validAfter: 0n, validBefore, nonce,
    });
    const { v, r, s } = await signEIP3009(USER_PRIV_KEY, digest);

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

  // ── Test 1 — balance skill ────────────────────────────────────────────────
  it("Test 1 — balance skill: reads correct ETH and USDC balances", async () => {
    const ethBal = await publicClient.getBalance({ address: userAddress });
    assert.equal(ethBal, parseEther("1"), "ETH balance should be 1 ETH");

    const usdcBal = await publicClient.readContract({
      address: USDC_ADDRESS, abi: USDC_ABI,
      functionName: "balanceOf", args: [userAddress],
    });
    assert.equal(usdcBal, 200_000_000n, "USDC balance should be 200 USDC");

    console.log("✅ Balance skill | ETH:", ethBal, "USDC:", usdcBal);
  });

  // ── Test 2 — wallet skill: EIP-3009 $0.01 payment ────────────────────────
  it("Test 2 — wallet skill: $0.01 USDC payment settles via EIP-3009", async () => {
    const nonce       = toHex(1, { size: 32 }) as Hex;
    const validBefore = BigInt(Math.floor(Date.now() / 1000) + 3600);

    const uBefore = await publicClient.readContract({
      address: USDC_ADDRESS, abi: USDC_ABI, functionName: "balanceOf", args: [userAddress],
    });
    const pBefore = await publicClient.readContract({
      address: USDC_ADDRESS, abi: USDC_ABI, functionName: "balanceOf", args: [PINION_PAYTO],
    });

    const digest = buildEIP3009Digest({
      from: userAddress, to: PINION_PAYTO,
      value: PINION_SKILL_COST, validAfter: 0n, validBefore, nonce,
    });
    const { v, r, s } = await signEIP3009(USER_PRIV_KEY, digest);

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

    const uAfter = await publicClient.readContract({
      address: USDC_ADDRESS, abi: USDC_ABI, functionName: "balanceOf", args: [userAddress],
    });
    const pAfter = await publicClient.readContract({
      address: USDC_ADDRESS, abi: USDC_ABI, functionName: "balanceOf", args: [PINION_PAYTO],
    });

    assert.equal(uAfter, uBefore - PINION_SKILL_COST, "User USDC decreases by $0.01");
    assert.equal(pAfter, pBefore + PINION_SKILL_COST, "payTo USDC increases by $0.01");

    const nonceUsed = await publicClient.readContract({
      address: USDC_ADDRESS, abi: USDC_ABI,
      functionName: "authorizationState", args: [userAddress, nonce],
    });
    assert.equal(nonceUsed, true, "Nonce must be consumed");

    console.log("✅ Wallet skill | $0.01 USDC settled, nonce consumed");
  });

  // ── Test 3 — replay protection ────────────────────────────────────────────
  it("Test 3 — wallet skill: EIP-3009 nonce cannot be replayed", async () => {
    const nonce       = toHex(42, { size: 32 }) as Hex;
    const validBefore = BigInt(Math.floor(Date.now() / 1000) + 3600);

    const digest = buildEIP3009Digest({
      from: userAddress, to: PINION_PAYTO,
      value: PINION_SKILL_COST, validAfter: 0n, validBefore, nonce,
    });
    const { v, r, s } = await signEIP3009(USER_PRIV_KEY, digest);

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

    await assert.rejects(
      () => publicClient.simulateContract({
        address: USDC_ADDRESS, abi: USDC_ABI,
        functionName: "transferWithAuthorization",
        args: [userAddress, PINION_PAYTO, PINION_SKILL_COST, 0n, validBefore, nonce, v, r, s],
        account: PINION_PAYTO,
      }),
      "Replay with same nonce must revert"
    );

    console.log("✅ Wallet skill | replay correctly rejected");
  });

  // ── Tests 4–7 — per-skill payment deductions ─────────────────────────────
  it("Test 4 — chat skill: deducts $0.01 USDC", async () => {
    const before = await publicClient.readContract({
      address: USDC_ADDRESS, abi: USDC_ABI, functionName: "balanceOf", args: [userAddress],
    });
    await simulatePinionSkillPayment(100);
    const after = await publicClient.readContract({
      address: USDC_ADDRESS, abi: USDC_ABI, functionName: "balanceOf", args: [userAddress],
    });
    assert.equal(after, before - PINION_SKILL_COST, "Chat skill deducts $0.01");
    console.log("✅ Chat skill | $0.01 USDC deducted");
  });

  it("Test 5 — price skill: deducts $0.01 USDC", async () => {
    const before = await publicClient.readContract({
      address: USDC_ADDRESS, abi: USDC_ABI, functionName: "balanceOf", args: [userAddress],
    });
    await simulatePinionSkillPayment(200);
    const after = await publicClient.readContract({
      address: USDC_ADDRESS, abi: USDC_ABI, functionName: "balanceOf", args: [userAddress],
    });
    assert.equal(after, before - PINION_SKILL_COST, "Price skill deducts $0.01");
    console.log("✅ Price skill | $0.01 USDC deducted");
  });

  it("Test 6 — trade skill: deducts $0.01 USDC", async () => {
    const before = await publicClient.readContract({
      address: USDC_ADDRESS, abi: USDC_ABI, functionName: "balanceOf", args: [userAddress],
    });
    await simulatePinionSkillPayment(300);
    const after = await publicClient.readContract({
      address: USDC_ADDRESS, abi: USDC_ABI, functionName: "balanceOf", args: [userAddress],
    });
    assert.equal(after, before - PINION_SKILL_COST, "Trade skill deducts $0.01");
    console.log("✅ Trade skill | $0.01 USDC deducted");
  });

  it("Test 7 — fund skill: deducts $0.01 USDC", async () => {
    const before = await publicClient.readContract({
      address: USDC_ADDRESS, abi: USDC_ABI, functionName: "balanceOf", args: [userAddress],
    });
    await simulatePinionSkillPayment(400);
    const after = await publicClient.readContract({
      address: USDC_ADDRESS, abi: USDC_ABI, functionName: "balanceOf", args: [userAddress],
    });
    assert.equal(after, before - PINION_SKILL_COST, "Fund skill deducts $0.01");
    console.log("✅ Fund skill | $0.01 USDC deducted");
  });

  // ── Test 8 — unlimited plan: $100 USDC ───────────────────────────────────
  it("Test 8 — unlimited plan: settles exactly $100 USDC", async () => {
    const nonce       = toHex(9999, { size: 32 }) as Hex;
    const validBefore = BigInt(Math.floor(Date.now() / 1000) + 3600);

    const uBefore = await publicClient.readContract({
      address: USDC_ADDRESS, abi: USDC_ABI, functionName: "balanceOf", args: [userAddress],
    });
    const pBefore = await publicClient.readContract({
      address: USDC_ADDRESS, abi: USDC_ABI, functionName: "balanceOf", args: [PINION_PAYTO],
    });

    const digest = buildEIP3009Digest({
      from: userAddress, to: PINION_PAYTO,
      value: PINION_UNLIMITED_COST, validAfter: 0n, validBefore, nonce,
    });
    const { v, r, s } = await signEIP3009(USER_PRIV_KEY, digest);

    await networkHelpers.impersonateAccount(PINION_PAYTO);
    await networkHelpers.setBalance(PINION_PAYTO, parseEther("1"));

    const { request } = await publicClient.simulateContract({
      address: USDC_ADDRESS, abi: USDC_ABI,
      functionName: "transferWithAuthorization",
      args: [userAddress, PINION_PAYTO, PINION_UNLIMITED_COST, 0n, validBefore, nonce, v, r, s],
      account: PINION_PAYTO,
    });
    const paytoWallet = await viem.getWalletClient(PINION_PAYTO);
    await paytoWallet.writeContract(request);

    const uAfter = await publicClient.readContract({
      address: USDC_ADDRESS, abi: USDC_ABI, functionName: "balanceOf", args: [userAddress],
    });
    const pAfter = await publicClient.readContract({
      address: USDC_ADDRESS, abi: USDC_ABI, functionName: "balanceOf", args: [PINION_PAYTO],
    });

    assert.equal(uAfter, uBefore - PINION_UNLIMITED_COST, "User pays $100");
    assert.equal(pAfter, pBefore + PINION_UNLIMITED_COST, "payTo receives $100");

    console.log("✅ Unlimited plan | $100 USDC settled");
  });

  // ── Test 9 — insufficient funds ───────────────────────────────────────────
  // Sign directly with the private key — do NOT call viem.getWalletClient()
  // for an arbitrary key the node doesn't own (causes "Unknown account" error).
  it("Test 9 — insufficient funds: payment reverts with 0 USDC", async () => {
    const brokeKey: Hex =
      "0xbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbad0";
    const { privateKeyToAccount } = await import("viem/accounts");
    const brokeAddress = privateKeyToAccount(brokeKey).address;

    await networkHelpers.setBalance(brokeAddress, parseEther("1"));

    const nonce       = toHex(500, { size: 32 }) as Hex;
    const validBefore = BigInt(Math.floor(Date.now() / 1000) + 3600);

    const digest = buildEIP3009Digest({
      from: brokeAddress, to: PINION_PAYTO,
      value: PINION_SKILL_COST, validAfter: 0n, validBefore, nonce,
    });
    const { v, r, s } = await signEIP3009(brokeKey, digest);

    await networkHelpers.impersonateAccount(PINION_PAYTO);

    await assert.rejects(
      () => publicClient.simulateContract({
        address: USDC_ADDRESS, abi: USDC_ABI,
        functionName: "transferWithAuthorization",
        args: [brokeAddress, PINION_PAYTO, PINION_SKILL_COST, 0n, validBefore, nonce, v, r, s],
        account: PINION_PAYTO,
      }),
      "Payment from broke user must revert"
    );

    console.log("✅ Insufficient funds | correctly rejected");
  });

  // ── Test 10 — expired authorization ──────────────────────────────────────
  it("Test 10 — expired authorization: validBefore in the past reverts", async () => {
    const nonce     = toHex(600, { size: 32 }) as Hex;
    const expiredTs = BigInt(Math.floor(Date.now() / 1000) - 10);

    const digest = buildEIP3009Digest({
      from: userAddress, to: PINION_PAYTO,
      value: PINION_SKILL_COST, validAfter: 0n, validBefore: expiredTs, nonce,
    });
    const { v, r, s } = await signEIP3009(USER_PRIV_KEY, digest);

    await networkHelpers.impersonateAccount(PINION_PAYTO);

    await assert.rejects(
      () => publicClient.simulateContract({
        address: USDC_ADDRESS, abi: USDC_ABI,
        functionName: "transferWithAuthorization",
        args: [userAddress, PINION_PAYTO, PINION_SKILL_COST, 0n, expiredTs, nonce, v, r, s],
        account: PINION_PAYTO,
      }),
      "Expired authorization must revert"
    );

    console.log("✅ Expired authorization | correctly rejected");
  });

  // ── Test 11 — full example flow: 5 skills = $0.05 USDC ───────────────────
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

    assert.equal(usdcAfter, usdcBefore - 5n * PINION_SKILL_COST, "5 skills = $0.05 total");
    console.log("✅ Full flow | total deducted: 50000 units (=$0.05)");
  });

  // ── Test 12 — validAfter window ───────────────────────────────────────────
  // Use EVM block.timestamp as baseline — NOT Date.now().
  // Date.now() is wall-clock time (Feb 2026). The forked EVM block.timestamp
  // is the chain's latest block time (Base mainnet, ~now). After time.increase()
  // the EVM advances from block.timestamp, not from wall-clock — so signing
  // against Date.now() would make validAfter far in the EVM's future.
  it("Test 12 — validAfter: blocked before window, succeeds after time.increase", async () => {
    const nonce = toHex(700, { size: 32 }) as Hex;

    const block      = await publicClient.getBlock();
    const evmNow     = block.timestamp;        // EVM time, NOT Date.now()
    const validAfter  = evmNow + 3600n;
    const validBefore = evmNow + 7200n;

    const digest = buildEIP3009Digest({
      from: userAddress, to: PINION_PAYTO,
      value: PINION_SKILL_COST, validAfter, validBefore, nonce,
    });
    const { v, r, s } = await signEIP3009(USER_PRIV_KEY, digest);

    await networkHelpers.impersonateAccount(PINION_PAYTO);
    await networkHelpers.setBalance(PINION_PAYTO, parseEther("1"));

    // Before validAfter — must revert
    await assert.rejects(
      () => publicClient.simulateContract({
        address: USDC_ADDRESS, abi: USDC_ABI,
        functionName: "transferWithAuthorization",
        args: [userAddress, PINION_PAYTO, PINION_SKILL_COST, validAfter, validBefore, nonce, v, r, s],
        account: PINION_PAYTO,
      }),
      "Must revert before validAfter"
    );

    // Advance EVM time past validAfter (mirrors Foundry's vm.warp)
    await networkHelpers.time.increase(3601);

    // After validAfter — must succeed
    const { request } = await publicClient.simulateContract({
      address: USDC_ADDRESS, abi: USDC_ABI,
      functionName: "transferWithAuthorization",
      args: [userAddress, PINION_PAYTO, PINION_SKILL_COST, validAfter, validBefore, nonce, v, r, s],
      account: PINION_PAYTO,
    });
    const paytoWallet = await viem.getWalletClient(PINION_PAYTO);
    await paytoWallet.writeContract(request);

    const nonceUsed = await publicClient.readContract({
      address: USDC_ADDRESS, abi: USDC_ABI,
      functionName: "authorizationState", args: [userAddress, nonce],
    });
    assert.equal(nonceUsed, true, "Nonce consumed after valid window");

    console.log("✅ validAfter | blocked before window, succeeded after time.increase");
  });
});