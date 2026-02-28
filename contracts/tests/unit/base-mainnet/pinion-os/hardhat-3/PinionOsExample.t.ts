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
  type WalletClient,
  type PublicClient,
  type Address,
  type Hex,
  encodeAbiParameters,
  keccak256,
  concat,
  toHex,
  parseEther,
  hexToBytes,
  toBytes,
} from "viem";

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const USDC_ADDRESS: Address  = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const BASE_CHAIN_ID           = 8453n;
const PINION_SKILL_COST       = 10_000n;       // $0.01 USDC (6 decimals)
const PINION_UNLIMITED_COST   = 100_000_000n;  // $100 USDC (6 decimals)
const PINION_PAYTO: Address   = "0xf9c9A7735aaB3C665197725A3aFC095fE2635d09";
const USER_PRIV_KEY: Hex      =
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
 * Does NOT add any EIP-191 prefix — the result is fed directly to a raw secp256k1 sign.
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

  const enc = (s: string) => toBytes(s);   // UTF-8 encode, no extra prefix

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

  // \x19\x01 + domainSeparator + structHash  (no extra keccak — this IS the final digest)
  return keccak256(concat(["0x1901", domainSeparator, structHash]));
}

/**
 * Sign a raw 32-byte digest WITHOUT any EIP-191 prefix.
 *
 * BUG FIXED: The previous version used walletClient.signMessage({ raw: ... })
 * which internally prepends "\x19Ethereum Signed Message:\n32", producing a
 * double-wrapped digest that Circle's FiatToken rejects with "invalid signature".
 *
 * Fix: use viem's `sign` action from `viem/accounts` which is a bare secp256k1
 * sign over the digest bytes — exactly what EIP-3009 expects.
 */
async function signEIP3009Digest(
  privateKey: Hex,
  digest: Hex
): Promise<{ v: number; r: Hex; s: Hex }> {
  const { sign } = await import("viem/accounts");

  // sign() does a raw secp256k1 sign — no EIP-191 prefix added
  const sig = await sign({ hash: digest, privateKey });

  return {
    v: Number(sig.v),
    r: sig.r,
    s: sig.s,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Test suite
// ─────────────────────────────────────────────────────────────────────────────

const { viem, networkHelpers } = await hre.network.connect("baseFork");

describe("PinionOsForkTest — Base mainnet fork (Hardhat 3 / viem)", async () => {

  let userAddress:  Address;
  let publicClient: PublicClient;

  before(async () => {
    publicClient = await viem.getPublicClient();

    const { privateKeyToAccount } = await import("viem/accounts");
    userAddress = privateKeyToAccount(USER_PRIV_KEY).address;

    // Fund user with ETH and USDC
    await networkHelpers.setBalance(userAddress, parseEther("1"));

    // Seed USDC via whale impersonation (mirrors Foundry's deal())
    const whale: Address = "0x20FE51A9229EEf2cF8Ad9E89d91CAb9312cF3b7A";
    await networkHelpers.impersonateAccount(whale);
    await networkHelpers.setBalance(whale, parseEther("10"));

    const { request: transferReq } = await publicClient.simulateContract({
      address: USDC_ADDRESS, abi: USDC_ABI,
      functionName: "transfer", args: [userAddress, 200_000_000n],
      account: whale,
    });
    const whaleWallet = await viem.getWalletClient(whale);
    await whaleWallet.writeContract(transferReq);

    const ethBal  = await publicClient.getBalance({ address: userAddress });
    const usdcBal = await publicClient.readContract({
      address: USDC_ADDRESS, abi: USDC_ABI, functionName: "balanceOf", args: [userAddress],
    });
    console.log("=== setUp complete ===");
    console.log("User address  :", userAddress);
    console.log("ETH balance   :", ethBal.toString());
    console.log("USDC balance  :", usdcBal.toString());
  });

  // ── Helper: simulate a single Pinion x402 skill payment ──────────────────
  async function simulatePinionSkillPayment(nonceIndex: number) {
    const nonce       = toHex(nonceIndex, { size: 32 }) as Hex;
    const validBefore = BigInt(Math.floor(Date.now() / 1000) + 3600);

    const digest = buildEIP3009Digest({
      from: userAddress, to: PINION_PAYTO,
      value: PINION_SKILL_COST, validAfter: 0n, validBefore, nonce,
    });

    // FIX: use raw sign(), NOT signMessage() which adds EIP-191 prefix
    const { v, r, s } = await signEIP3009Digest(USER_PRIV_KEY, digest);

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

  // ────────────────────────────────────────────────────────────────────────────
  // Test 1 — balance skill
  // ────────────────────────────────────────────────────────────────────────────
  it("Test 1 — balance skill: reads correct ETH and USDC balances", async () => {
    const ethBal = await publicClient.getBalance({ address: userAddress });
    assert.equal(ethBal, parseEther("1"), "ETH balance should be 1 ETH");

    const usdcBal = await publicClient.readContract({
      address: USDC_ADDRESS, abi: USDC_ABI, functionName: "balanceOf", args: [userAddress],
    });
    assert.equal(usdcBal, 200_000_000n, "USDC balance should be 200 USDC");

    console.log("✅ Balance skill | ETH:", ethBal, "USDC:", usdcBal);
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Test 2 — wallet skill: EIP-3009 payment of $0.01 USDC
  // ────────────────────────────────────────────────────────────────────────────
  it("Test 2 — wallet skill: $0.01 USDC payment settles via EIP-3009", async () => {
    const nonce       = toHex(1, { size: 32 }) as Hex;
    const validBefore = BigInt(Math.floor(Date.now() / 1000) + 3600);

    const userUsdcBefore  = await publicClient.readContract({
      address: USDC_ADDRESS, abi: USDC_ABI, functionName: "balanceOf", args: [userAddress],
    });
    const paytoUsdcBefore = await publicClient.readContract({
      address: USDC_ADDRESS, abi: USDC_ABI, functionName: "balanceOf", args: [PINION_PAYTO],
    });

    const digest = buildEIP3009Digest({
      from: userAddress, to: PINION_PAYTO,
      value: PINION_SKILL_COST, validAfter: 0n, validBefore, nonce,
    });
    const { v, r, s } = await signEIP3009Digest(USER_PRIV_KEY, digest);

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

    const userUsdcAfter  = await publicClient.readContract({
      address: USDC_ADDRESS, abi: USDC_ABI, functionName: "balanceOf", args: [userAddress],
    });
    const paytoUsdcAfter = await publicClient.readContract({
      address: USDC_ADDRESS, abi: USDC_ABI, functionName: "balanceOf", args: [PINION_PAYTO],
    });

    assert.equal(userUsdcAfter,  userUsdcBefore  - PINION_SKILL_COST, "User USDC decreases");
    assert.equal(paytoUsdcAfter, paytoUsdcBefore + PINION_SKILL_COST, "payTo USDC increases");

    const nonceUsed = await publicClient.readContract({
      address: USDC_ADDRESS, abi: USDC_ABI,
      functionName: "authorizationState", args: [userAddress, nonce],
    });
    assert.equal(nonceUsed, true, "Nonce must be consumed");

    console.log("✅ Wallet skill | $0.01 USDC settled, nonce consumed");
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Test 3 — replay protection
  // ────────────────────────────────────────────────────────────────────────────
  it("Test 3 — wallet skill: EIP-3009 nonce cannot be replayed", async () => {
    const nonce       = toHex(42, { size: 32 }) as Hex;
    const validBefore = BigInt(Math.floor(Date.now() / 1000) + 3600);

    const digest = buildEIP3009Digest({
      from: userAddress, to: PINION_PAYTO,
      value: PINION_SKILL_COST, validAfter: 0n, validBefore, nonce,
    });
    const { v, r, s } = await signEIP3009Digest(USER_PRIV_KEY, digest);

    await networkHelpers.impersonateAccount(PINION_PAYTO);
    await networkHelpers.setBalance(PINION_PAYTO, parseEther("1"));
    const paytoWallet = await viem.getWalletClient(PINION_PAYTO);

    // First — succeeds
    const { request } = await publicClient.simulateContract({
      address: USDC_ADDRESS, abi: USDC_ABI,
      functionName: "transferWithAuthorization",
      args: [userAddress, PINION_PAYTO, PINION_SKILL_COST, 0n, validBefore, nonce, v, r, s],
      account: PINION_PAYTO,
    });
    await paytoWallet.writeContract(request);

    // Second — must revert with nonce already used
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

  // ────────────────────────────────────────────────────────────────────────────
  // Tests 4–7 — per-skill payment deductions
  // ────────────────────────────────────────────────────────────────────────────
  it("Test 4 — chat skill: deducts $0.01 USDC", async () => {
    const before = await publicClient.readContract({
      address: USDC_ADDRESS, abi: USDC_ABI, functionName: "balanceOf", args: [userAddress],
    });
    await simulatePinionSkillPayment(100);
    const after = await publicClient.readContract({
      address: USDC_ADDRESS, abi: USDC_ABI, functionName: "balanceOf", args: [userAddress],
    });
    assert.equal(after, before - PINION_SKILL_COST);
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
    assert.equal(after, before - PINION_SKILL_COST);
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
    assert.equal(after, before - PINION_SKILL_COST);
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
    assert.equal(after, before - PINION_SKILL_COST);
    console.log("✅ Fund skill | $0.01 USDC deducted");
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Test 8 — unlimited plan: $100 USDC
  // ────────────────────────────────────────────────────────────────────────────
  it("Test 8 — unlimited plan: settles exactly $100 USDC", async () => {
    const nonce       = toHex(9999, { size: 32 }) as Hex;
    const validBefore = BigInt(Math.floor(Date.now() / 1000) + 3600);

    const userUsdcBefore  = await publicClient.readContract({
      address: USDC_ADDRESS, abi: USDC_ABI, functionName: "balanceOf", args: [userAddress],
    });
    const paytoUsdcBefore = await publicClient.readContract({
      address: USDC_ADDRESS, abi: USDC_ABI, functionName: "balanceOf", args: [PINION_PAYTO],
    });

    const digest = buildEIP3009Digest({
      from: userAddress, to: PINION_PAYTO,
      value: PINION_UNLIMITED_COST, validAfter: 0n, validBefore, nonce,
    });
    const { v, r, s } = await signEIP3009Digest(USER_PRIV_KEY, digest);

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

    const userUsdcAfter  = await publicClient.readContract({
      address: USDC_ADDRESS, abi: USDC_ABI, functionName: "balanceOf", args: [userAddress],
    });
    const paytoUsdcAfter = await publicClient.readContract({
      address: USDC_ADDRESS, abi: USDC_ABI, functionName: "balanceOf", args: [PINION_PAYTO],
    });

    assert.equal(userUsdcAfter,  userUsdcBefore  - PINION_UNLIMITED_COST, "User pays $100");
    assert.equal(paytoUsdcAfter, paytoUsdcBefore + PINION_UNLIMITED_COST, "payTo receives $100");

    console.log("✅ Unlimited plan | $100 USDC settled");
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Test 9 — insufficient funds
  //
  // BUG FIXED: The previous version called viem.getWalletClient(brokeAddress)
  // which requires the address to already be an unlocked account in the node.
  // For an arbitrary private key, we must use privateKeyToAccount + sign directly.
  // ────────────────────────────────────────────────────────────────────────────
  it("Test 9 — insufficient funds: payment reverts with 0 USDC", async () => {
    const brokeKey: Hex =
      "0xbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbad0";

    const { privateKeyToAccount } = await import("viem/accounts");
    const brokeAddress = privateKeyToAccount(brokeKey).address;

    await networkHelpers.setBalance(brokeAddress, parseEther("1"));
    // No USDC for brokeAddress

    const nonce       = toHex(500, { size: 32 }) as Hex;
    const validBefore = BigInt(Math.floor(Date.now() / 1000) + 3600);

    const digest = buildEIP3009Digest({
      from: brokeAddress, to: PINION_PAYTO,
      value: PINION_SKILL_COST, validAfter: 0n, validBefore, nonce,
    });

    // FIX: sign directly with the broke private key — no wallet client needed
    const { v, r, s } = await signEIP3009Digest(brokeKey, digest);

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

  // ────────────────────────────────────────────────────────────────────────────
  // Test 10 — expired authorization
  // ────────────────────────────────────────────────────────────────────────────
  it("Test 10 — expired authorization: validBefore in the past reverts", async () => {
    const nonce     = toHex(600, { size: 32 }) as Hex;
    const expiredTs = BigInt(Math.floor(Date.now() / 1000) - 10);

    const digest = buildEIP3009Digest({
      from: userAddress, to: PINION_PAYTO,
      value: PINION_SKILL_COST, validAfter: 0n, validBefore: expiredTs, nonce,
    });
    const { v, r, s } = await signEIP3009Digest(USER_PRIV_KEY, digest);

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

  // ────────────────────────────────────────────────────────────────────────────
  // Test 11 — full example flow: 5 skills = $0.05 USDC
  // ────────────────────────────────────────────────────────────────────────────
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
    console.log("✅ Full flow | total deducted: 50000 USDC units (=$0.05)");
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Test 12 — validAfter: time window enforcement
  //
  // BUG FIXED: The previous version used Date.now() for validAfter, which is
  // wall-clock time. After networkHelpers.time.increase() the EVM block timestamp
  // advances, but the digest was signed against the old validAfter value computed
  // from Date.now() BEFORE time.increase(). We must use the EVM's block.timestamp
  // as the baseline, not Date.now(), so that validAfter and the post-warp block
  // timestamp are consistent.
  // ────────────────────────────────────────────────────────────────────────────
  it("Test 12 — validAfter: blocked before window, succeeds after time.increase", async () => {
    const nonce = toHex(700, { size: 32 }) as Hex;

    // FIX: use the EVM block timestamp as baseline — not Date.now()
    const block       = await publicClient.getBlock();
    const evmNow      = block.timestamp;                // current EVM time (bigint, seconds)
    const validAfter  = evmNow + 3600n;                 // 1 hour ahead in EVM time
    const validBefore = evmNow + 7200n;                 // 2 hours ahead in EVM time

    const digest = buildEIP3009Digest({
      from: userAddress, to: PINION_PAYTO,
      value: PINION_SKILL_COST, validAfter, validBefore, nonce,
    });
    const { v, r, s } = await signEIP3009Digest(USER_PRIV_KEY, digest);

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