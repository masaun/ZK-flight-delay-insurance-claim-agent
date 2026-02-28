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
  toBytes,
  parseEther,
} from "viem";

// ─────────────────────────────────────────────────────────────────────────────
// Constants — Base mainnet
// ─────────────────────────────────────────────────────────────────────────────

const USDC_ADDRESS: Address  = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const PINION_SKILL_COST      = 10_000n;
const PINION_UNLIMITED_COST  = 100_000_000n;
const PINION_PAYTO: Address  = "0xf9c9A7735aaB3C665197725A3aFC095fE2635d09";
const USER_PRIV_KEY: Hex     =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

// ─────────────────────────────────────────────────────────────────────────────
// USDC ABI
// ─────────────────────────────────────────────────────────────────────────────

const USDC_ABI = [
  {
    name: "DOMAIN_SEPARATOR",
    type: "function",
    stateMutability: "view",
    inputs:  [],
    outputs: [{ name: "", type: "bytes32" }],
  },
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs:  [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
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
// EIP-3009 helpers
//
// APPROACH: Compute domainSeparator using the ACTUAL chainId reported by the
// fork's EVM (from publicClient.getChainId()), not a hard-coded constant.
//
// FiatTokenV2_2 uses _domainSeparatorV4() which calls _buildDomainSeparator()
// which uses `block.chainid` at execution time. The DOMAIN_SEPARATOR() view
// function returns a cached value from construction — but the internal
// verification path recomputes with live block.chainid if chainId changed.
// By using the fork's actual chainId in our signing, both sides match.
// ─────────────────────────────────────────────────────────────────────────────

const TRANSFER_TYPEHASH: Hex = keccak256(
  toBytes(
    "TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
  )
);

const DOMAIN_TYPEHASH: Hex = keccak256(
  toBytes(
    "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
  )
);

function buildDomainSeparator(chainId: bigint): Hex {
  return keccak256(encodeAbiParameters(
    [
      { type: "bytes32" },
      { type: "bytes32" },
      { type: "bytes32" },
      { type: "uint256" },
      { type: "address" },
    ],
    [
      DOMAIN_TYPEHASH,
      keccak256(toBytes("USD Coin")),
      keccak256(toBytes("2")),
      chainId,
      USDC_ADDRESS,
    ]
  ));
}

function buildDigest(params: {
  domainSeparator: Hex;
  from:        Address;
  to:          Address;
  value:       bigint;
  validAfter:  bigint;
  validBefore: bigint;
  nonce:       Hex;
}): Hex {
  const { domainSeparator, from, to, value, validAfter, validBefore, nonce } = params;

  const structHash = keccak256(encodeAbiParameters(
    [
      { type: "bytes32" }, { type: "address" }, { type: "address" },
      { type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "bytes32" },
    ],
    [TRANSFER_TYPEHASH, from, to, value, validAfter, validBefore, nonce]
  ));

  return keccak256(concat(["0x1901", domainSeparator, structHash]));
}

async function signDigest(
  privateKey: Hex,
  digest: Hex
): Promise<{ v: number; r: Hex; s: Hex }> {
  const { sign } = await import("viem/accounts");
  const sig = await sign({ hash: digest, privateKey });
  return { v: Number(sig.v), r: sig.r, s: sig.s };
}

// ─────────────────────────────────────────────────────────────────────────────
// Network
// ─────────────────────────────────────────────────────────────────────────────

const { viem, networkHelpers } = await hre.network.connect("baseFork");

// ─────────────────────────────────────────────────────────────────────────────
// Test suite
// ─────────────────────────────────────────────────────────────────────────────

describe("PinionOsForkTest — Base mainnet fork (Hardhat 3 / viem)", async () => {

  let userAddress:  Address;
  let publicClient: PublicClient;
  let domainSeparator: Hex;

  before(async () => {
    const { privateKeyToAccount } = await import("viem/accounts");
    userAddress  = privateKeyToAccount(USER_PRIV_KEY).address;
    publicClient = await viem.getPublicClient();

    // ── Diagnose: print what chainId the fork actually reports ─────────────
    const forkChainId = await publicClient.getChainId();
    console.log("Fork chainId (EVM block.chainid):", forkChainId);

    // ── Read the cached DOMAIN_SEPARATOR from the contract ─────────────────
    const cachedDS = await publicClient.readContract({
      address: USDC_ADDRESS, abi: USDC_ABI, functionName: "DOMAIN_SEPARATOR",
    }) as Hex;
    console.log("DOMAIN_SEPARATOR (cached/view)  :", cachedDS);

    // ── Build what the contract will compute at verification time ──────────
    // FiatTokenV2_2 uses block.chainid dynamically. If the fork chainId
    // differs from 8453 (the chainId at deploy), the recomputed separator
    // won't match the cached one. We must sign against the live chainId.
    const computedDS = buildDomainSeparator(BigInt(forkChainId));
    console.log("domainSeparator (computed live) :", computedDS);

    if (cachedDS === computedDS) {
      console.log("✅ Domain separators MATCH — chainId is consistent");
      domainSeparator = cachedDS;
    } else {
      console.log("⚠️  Domain separators DIVERGE — using computed (live chainId) for signing");
      // The contract verifies with block.chainid dynamically, so use computed
      domainSeparator = computedDS;
    }

    // ── Seed user ──────────────────────────────────────────────────────────
    await networkHelpers.setBalance(userAddress, parseEther("1"));

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

  async function simulatePinionSkillPayment(nonceIndex: number): Promise<void> {
    const nonce       = toHex(nonceIndex, { size: 32 }) as Hex;
    const validBefore = BigInt(Math.floor(Date.now() / 1000) + 3600);

    const digest = buildDigest({
      domainSeparator,
      from: userAddress, to: PINION_PAYTO,
      value: PINION_SKILL_COST, validAfter: 0n, validBefore, nonce,
    });
    const { v, r, s } = await signDigest(USER_PRIV_KEY, digest);

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

  it("Test 2 — wallet skill: $0.01 USDC payment settles via EIP-3009", async () => {
    const nonce       = toHex(1, { size: 32 }) as Hex;
    const validBefore = BigInt(Math.floor(Date.now() / 1000) + 3600);

    const uBefore = await publicClient.readContract({ address: USDC_ADDRESS, abi: USDC_ABI, functionName: "balanceOf", args: [userAddress] });
    const pBefore = await publicClient.readContract({ address: USDC_ADDRESS, abi: USDC_ABI, functionName: "balanceOf", args: [PINION_PAYTO] });

    const digest = buildDigest({ domainSeparator, from: userAddress, to: PINION_PAYTO, value: PINION_SKILL_COST, validAfter: 0n, validBefore, nonce });
    const { v, r, s } = await signDigest(USER_PRIV_KEY, digest);

    await networkHelpers.impersonateAccount(PINION_PAYTO);
    await networkHelpers.setBalance(PINION_PAYTO, parseEther("1"));

    const { request } = await publicClient.simulateContract({
      address: USDC_ADDRESS, abi: USDC_ABI,
      functionName: "transferWithAuthorization",
      args: [userAddress, PINION_PAYTO, PINION_SKILL_COST, 0n, validBefore, nonce, v, r, s],
      account: PINION_PAYTO,
    });
    await (await viem.getWalletClient(PINION_PAYTO)).writeContract(request);

    const uAfter = await publicClient.readContract({ address: USDC_ADDRESS, abi: USDC_ABI, functionName: "balanceOf", args: [userAddress] });
    const pAfter = await publicClient.readContract({ address: USDC_ADDRESS, abi: USDC_ABI, functionName: "balanceOf", args: [PINION_PAYTO] });
    assert.equal(uAfter, uBefore - PINION_SKILL_COST);
    assert.equal(pAfter, pBefore + PINION_SKILL_COST);

    const nonceUsed = await publicClient.readContract({ address: USDC_ADDRESS, abi: USDC_ABI, functionName: "authorizationState", args: [userAddress, nonce] });
    assert.equal(nonceUsed, true);
    console.log("✅ Wallet skill | $0.01 settled, nonce consumed");
  });

  it("Test 3 — wallet skill: EIP-3009 nonce cannot be replayed", async () => {
    const nonce       = toHex(42, { size: 32 }) as Hex;
    const validBefore = BigInt(Math.floor(Date.now() / 1000) + 3600);
    const digest = buildDigest({ domainSeparator, from: userAddress, to: PINION_PAYTO, value: PINION_SKILL_COST, validAfter: 0n, validBefore, nonce });
    const { v, r, s } = await signDigest(USER_PRIV_KEY, digest);

    await networkHelpers.impersonateAccount(PINION_PAYTO);
    await networkHelpers.setBalance(PINION_PAYTO, parseEther("1"));
    const paytoWallet = await viem.getWalletClient(PINION_PAYTO);
    const { request } = await publicClient.simulateContract({
      address: USDC_ADDRESS, abi: USDC_ABI, functionName: "transferWithAuthorization",
      args: [userAddress, PINION_PAYTO, PINION_SKILL_COST, 0n, validBefore, nonce, v, r, s], account: PINION_PAYTO,
    });
    await paytoWallet.writeContract(request);
    await assert.rejects(() => publicClient.simulateContract({
      address: USDC_ADDRESS, abi: USDC_ABI, functionName: "transferWithAuthorization",
      args: [userAddress, PINION_PAYTO, PINION_SKILL_COST, 0n, validBefore, nonce, v, r, s], account: PINION_PAYTO,
    }));
    console.log("✅ Replay correctly rejected");
  });

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

  it("Test 8 — unlimited plan: settles exactly $100 USDC", async () => {
    const nonce       = toHex(9999, { size: 32 }) as Hex;
    const validBefore = BigInt(Math.floor(Date.now() / 1000) + 3600);
    const uBefore = await publicClient.readContract({ address: USDC_ADDRESS, abi: USDC_ABI, functionName: "balanceOf", args: [userAddress] });
    const pBefore = await publicClient.readContract({ address: USDC_ADDRESS, abi: USDC_ABI, functionName: "balanceOf", args: [PINION_PAYTO] });
    const digest = buildDigest({ domainSeparator, from: userAddress, to: PINION_PAYTO, value: PINION_UNLIMITED_COST, validAfter: 0n, validBefore, nonce });
    const { v, r, s } = await signDigest(USER_PRIV_KEY, digest);
    await networkHelpers.impersonateAccount(PINION_PAYTO);
    await networkHelpers.setBalance(PINION_PAYTO, parseEther("1"));
    const { request } = await publicClient.simulateContract({
      address: USDC_ADDRESS, abi: USDC_ABI, functionName: "transferWithAuthorization",
      args: [userAddress, PINION_PAYTO, PINION_UNLIMITED_COST, 0n, validBefore, nonce, v, r, s], account: PINION_PAYTO,
    });
    await (await viem.getWalletClient(PINION_PAYTO)).writeContract(request);
    const uAfter = await publicClient.readContract({ address: USDC_ADDRESS, abi: USDC_ABI, functionName: "balanceOf", args: [userAddress] });
    const pAfter = await publicClient.readContract({ address: USDC_ADDRESS, abi: USDC_ABI, functionName: "balanceOf", args: [PINION_PAYTO] });
    assert.equal(uAfter, uBefore - PINION_UNLIMITED_COST);
    assert.equal(pAfter, pBefore + PINION_UNLIMITED_COST);
    console.log("✅ Unlimited plan | $100 settled");
  });

  it("Test 9 — insufficient funds: payment reverts with 0 USDC", async () => {
    const brokeKey: Hex = "0xbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbad0";
    const { privateKeyToAccount } = await import("viem/accounts");
    const brokeAddress = privateKeyToAccount(brokeKey).address;
    const nonce       = toHex(500, { size: 32 }) as Hex;
    const validBefore = BigInt(Math.floor(Date.now() / 1000) + 3600);
    const digest = buildDigest({ domainSeparator, from: brokeAddress, to: PINION_PAYTO, value: PINION_SKILL_COST, validAfter: 0n, validBefore, nonce });
    const { v, r, s } = await signDigest(brokeKey, digest);
    await networkHelpers.impersonateAccount(PINION_PAYTO);
    await assert.rejects(() => publicClient.simulateContract({
      address: USDC_ADDRESS, abi: USDC_ABI, functionName: "transferWithAuthorization",
      args: [brokeAddress, PINION_PAYTO, PINION_SKILL_COST, 0n, validBefore, nonce, v, r, s], account: PINION_PAYTO,
    }));
    console.log("✅ Insufficient funds | correctly rejected");
  });

  it("Test 10 — expired authorization: validBefore in the past reverts", async () => {
    const nonce     = toHex(600, { size: 32 }) as Hex;
    const expiredTs = BigInt(Math.floor(Date.now() / 1000) - 10);
    const digest = buildDigest({ domainSeparator, from: userAddress, to: PINION_PAYTO, value: PINION_SKILL_COST, validAfter: 0n, validBefore: expiredTs, nonce });
    const { v, r, s } = await signDigest(USER_PRIV_KEY, digest);
    await networkHelpers.impersonateAccount(PINION_PAYTO);
    await assert.rejects(() => publicClient.simulateContract({
      address: USDC_ADDRESS, abi: USDC_ABI, functionName: "transferWithAuthorization",
      args: [userAddress, PINION_PAYTO, PINION_SKILL_COST, 0n, expiredTs, nonce, v, r, s], account: PINION_PAYTO,
    }));
    console.log("✅ Expired authorization | correctly rejected");
  });

  it("Test 11 — full example flow: 5 skills = $0.05 USDC total", async () => {
    const usdcBefore = await publicClient.readContract({ address: USDC_ADDRESS, abi: USDC_ABI, functionName: "balanceOf", args: [userAddress] });
    for (let i = 1; i <= 5; i++) await simulatePinionSkillPayment(i * 1000);
    const usdcAfter = await publicClient.readContract({ address: USDC_ADDRESS, abi: USDC_ABI, functionName: "balanceOf", args: [userAddress] });
    assert.equal(usdcAfter, usdcBefore - 5n * PINION_SKILL_COST);
    console.log("✅ Full flow | 50000 units deducted (=$0.05)");
  });

  it("Test 12 — validAfter: blocked before window, succeeds after time.increase", async () => {
    const nonce = toHex(700, { size: 32 }) as Hex;
    const block      = await publicClient.getBlock();
    const evmNow     = block.timestamp;
    const validAfter  = evmNow + 3600n;
    const validBefore = evmNow + 7200n;
    const digest = buildDigest({ domainSeparator, from: userAddress, to: PINION_PAYTO, value: PINION_SKILL_COST, validAfter, validBefore, nonce });
    const { v, r, s } = await signDigest(USER_PRIV_KEY, digest);

    await networkHelpers.impersonateAccount(PINION_PAYTO);
    await networkHelpers.setBalance(PINION_PAYTO, parseEther("1"));

    await assert.rejects(() => publicClient.simulateContract({
      address: USDC_ADDRESS, abi: USDC_ABI, functionName: "transferWithAuthorization",
      args: [userAddress, PINION_PAYTO, PINION_SKILL_COST, validAfter, validBefore, nonce, v, r, s], account: PINION_PAYTO,
    }), "Must revert before validAfter");

    await networkHelpers.time.increase(3601);

    const { request } = await publicClient.simulateContract({
      address: USDC_ADDRESS, abi: USDC_ABI, functionName: "transferWithAuthorization",
      args: [userAddress, PINION_PAYTO, PINION_SKILL_COST, validAfter, validBefore, nonce, v, r, s], account: PINION_PAYTO,
    });
    await (await viem.getWalletClient(PINION_PAYTO)).writeContract(request);

    const nonceUsed = await publicClient.readContract({ address: USDC_ADDRESS, abi: USDC_ABI, functionName: "authorizationState", args: [userAddress, nonce] });
    assert.equal(nonceUsed, true);
    console.log("✅ validAfter | blocked before window, succeeded after time.increase");
  });
});