/**
 * @file  PinionOsForkTest.ts
 * @title Hardhat 3 · Base mainnet fork test for Pinion OS x402 payment flow
 *
 * Mirrors the Foundry PinionOsForkTest.t.sol test suite, rewritten using:
 *   - Hardhat 3 (hre.network.connect)
 *   - viem  (public / wallet clients, EIP-712 signing)
 *   - node:test  (describe / it — Hardhat 3's recommended test runner)
 *   - hardhat-network-helpers  (setBalance, setStorageAt, time)
 *   - hardhat-viem-assertions  (revertWith)
 *
 * Skills tested (mirrors the Pinion OS TypeScript example):
 *   pinion.skills.wallet()        → x402 $0.01 USDC payment via EIP-3009
 *   pinion.skills.balance(addr)   → ETH + USDC balance reads
 *   pinion.skills.price("ETH")    → $0.01 USDC payment
 *   pinion.skills.chat(msg)       → $0.01 USDC payment
 *   pinion.skills.trade(...)      → $0.01 USDC payment
 *   pinion.skills.fund(addr)      → $0.01 USDC payment
 *   pinion.skills.unlimited()     → $100 USDC one-time payment
 *
 * Run:
 *   export BASE_RPC_URL=https://mainnet.base.org
 *   npx hardhat test test/PinionOsForkTest.ts --network baseFork
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
  encodePacked,
  hexToBytes,
} from "viem";

// ─────────────────────────────────────────────────────────────────────────────
// Constants — Base mainnet
// ─────────────────────────────────────────────────────────────────────────────

/** Native USDC on Base (Circle, 6 decimals) */
const USDC_ADDRESS: Address = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

/** Base mainnet chain ID */
const BASE_CHAIN_ID = 8453n;

/** Pinion skill cost: $0.01 USDC = 10_000 (6 decimals) */
const PINION_SKILL_COST = 10_000n;

/** Pinion unlimited plan: $100 USDC = 100_000_000 (6 decimals) */
const PINION_UNLIMITED_COST = 100_000_000n;

/**
 * Pinion payment recipient.
 * Replace with the real pinionos.com payTo address when known.
 */
const PINION_PAYTO: Address = "0xf9c9A7735aaB3C665197725A3aFC095fE2635d09";

/**
 * Test user private key (Hardhat/Anvil default account #0 — safe for tests).
 * mirrors `new Wallet(privateKey)` in the TypeScript example.
 */
const USER_PRIV_KEY: Hex =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

// ─────────────────────────────────────────────────────────────────────────────
// Minimal USDC ABI — only the EIP-3009 surface we need
// ─────────────────────────────────────────────────────────────────────────────
const USDC_ABI = [
  // ERC-20
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  // EIP-3009: TransferWithAuthorization
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
  // EIP-3009: authorizationState
  {
    name: "authorizationState",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "authorizer", type: "address" },
      { name: "nonce",      type: "bytes32" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build an EIP-3009 TransferWithAuthorization digest.
 * Domain: USDC on Base mainnet (name="USD Coin", version="2", chainId=8453).
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

  // EIP-712 domain typehash
  const DOMAIN_TYPEHASH = keccak256(
    new TextEncoder().encode(
      "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
    )
  );

  // TransferWithAuthorization typehash (Circle FiatToken V2)
  const TRANSFER_TYPEHASH = keccak256(
    new TextEncoder().encode(
      "TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
    )
  );

  // Domain separator
  const domainSeparator = keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "uint256" },
        { type: "address" },
      ],
      [
        DOMAIN_TYPEHASH,
        keccak256(new TextEncoder().encode("USD Coin")),
        keccak256(new TextEncoder().encode("2")),
        BASE_CHAIN_ID,
        USDC_ADDRESS,
      ]
    )
  );

  // Struct hash
  const structHash = keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32" },
        { type: "address" },
        { type: "address" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "bytes32" },
      ],
      [TRANSFER_TYPEHASH, from, to, value, validAfter, validBefore, nonce]
    )
  );

  // EIP-191 + EIP-712 final digest: \x19\x01 ++ domainSeparator ++ structHash
  return keccak256(concat(["0x1901", domainSeparator, structHash]));
}

/**
 * Sign an EIP-3009 digest with a raw private key using viem's walletClient.
 * Returns split (v, r, s) components.
 */
async function signEIP3009(
  walletClient: WalletClient,
  digest: Hex
): Promise<{ v: number; r: Hex; s: Hex }> {
  // viem sign() returns a 65-byte compact signature: r(32) + s(32) + v(1)
  const sig = await walletClient.signMessage({
    account: walletClient.account!,
    message: { raw: hexToBytes(digest) },
  });
  // sig is 0x + 130 hex chars (65 bytes)
  const r = `0x${sig.slice(2, 66)}`   as Hex;
  const s = `0x${sig.slice(66, 130)}` as Hex;
  const v = parseInt(sig.slice(130, 132), 16);
  return { v, r, s };
}

/**
 * Seed a wallet with USDC by impersonating the Circle treasury on the fork.
 * Mirrors Foundry's `deal(address(USDC), user, amount, true)`.
 *
 * Strategy: impersonate a known USDC whale on Base and transfer to recipient.
 */
async function dealUSDC(
  networkHelpers: Awaited<ReturnType<typeof hre.network.connect>>["networkHelpers"],
  publicClient: PublicClient,
  walletClient: WalletClient,
  recipient: Address,
  amount: bigint
) {
  // Well-funded USDC whale on Base (visible on-chain)
  const whale: Address = "0x20FE51A9229EEf2cF8Ad9E89d91CAb9312cF3b7A";

  await networkHelpers.impersonateAccount(whale);
  await networkHelpers.setBalance(whale, parseEther("10"));

  // Use the wallet client impersonating the whale
  await walletClient.writeContract({
    address: USDC_ADDRESS,
    abi: [
      {
        name: "transfer",
        type: "function",
        stateMutability: "nonpayable",
        inputs: [
          { name: "to",    type: "address" },
          { name: "value", type: "uint256" },
        ],
        outputs: [{ name: "", type: "bool" }],
      },
    ],
    functionName: "transfer",
    args: [recipient, amount],
    account: whale,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Test suite
// ─────────────────────────────────────────────────────────────────────────────

// Connect to the Base mainnet fork defined in hardhat.config.ts as "baseFork"
// Each test file gets its own isolated network connection in Hardhat 3.
const { viem, networkHelpers } = await hre.network.connect("baseFork");

describe("PinionOsForkTest — Base mainnet fork (Hardhat 3 / viem)", async () => {

  // ── Shared state across tests ─────────────────────────────────────────────
  let userAddress:    Address;
  let userWallet:     WalletClient;
  let publicClient:   PublicClient;

  before(async () => {
    // Build clients
    publicClient = await viem.getPublicClient();

    // Import the test private key as a viem wallet account
    // (mirrors `new Wallet(privateKey)` in the TypeScript example)
    const { privateKeyToAccount } = await import("viem/accounts");
    const account = privateKeyToAccount(USER_PRIV_KEY);
    userAddress   = account.address;

    userWallet = await viem.getWalletClient(userAddress);

    // Fund with ETH (mirrors needing ETH on Base for gas)
    await networkHelpers.setBalance(userAddress, parseEther("1"));

    // Fund with 200 USDC via whale impersonation
    // (mirrors Foundry's `deal(address(USDC), user, 200_000_000, true)`)
    await dealUSDC(networkHelpers, publicClient, userWallet, userAddress, 200_000_000n);

    // Confirm setup
    const ethBal  = await publicClient.getBalance({ address: userAddress });
    const usdcBal = await publicClient.readContract({
      address: USDC_ADDRESS, abi: USDC_ABI, functionName: "balanceOf",
      args: [userAddress],
    });
    console.log("=== setUp complete ===");
    console.log("User address  :", userAddress);
    console.log("ETH balance   :", ethBal.toString());
    console.log("USDC balance  :", usdcBal.toString());
  });

  // ── Helper: simulate a single $0.01 Pinion x402 payment ──────────────────
  async function simulatePinionSkillPayment(nonceIndex: number) {
    const nonce       = toHex(nonceIndex, { size: 32 }) as Hex;
    const validBefore = BigInt(Math.floor(Date.now() / 1000) + 3600);

    const digest = buildEIP3009Digest({
      from:        userAddress,
      to:          PINION_PAYTO,
      value:       PINION_SKILL_COST,
      validAfter:  0n,
      validBefore,
      nonce,
    });

    const { v, r, s } = await signEIP3009(userWallet, digest);

    // Impersonate PINION_PAYTO — it calls transferWithAuthorization
    await networkHelpers.impersonateAccount(PINION_PAYTO);
    await networkHelpers.setBalance(PINION_PAYTO, parseEther("1"));

    await publicClient.simulateContract({
      address: USDC_ADDRESS,
      abi: USDC_ABI,
      functionName: "transferWithAuthorization",
      args: [userAddress, PINION_PAYTO, PINION_SKILL_COST, 0n, validBefore, nonce, v, r, s],
      account: PINION_PAYTO,
    }).then(({ request }) =>
      userWallet.writeContract({ ...request, account: PINION_PAYTO })
    );
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Test 1 — balance skill
  //   pinion.skills.balance(userAddress)
  // ────────────────────────────────────────────────────────────────────────────
  it("Test 1 — balance skill: reads correct ETH and USDC balances", async () => {
    const ethBal = await publicClient.getBalance({ address: userAddress });
    assert.equal(ethBal, parseEther("1"), "ETH balance should be 1 ETH as seeded");

    const usdcBal = await publicClient.readContract({
      address: USDC_ADDRESS, abi: USDC_ABI,
      functionName: "balanceOf", args: [userAddress],
    });
    assert.equal(usdcBal, 200_000_000n, "USDC balance should be 200 USDC as seeded");

    console.log("✅ Balance skill | ETH:", ethBal, "USDC:", usdcBal);
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Test 2 — wallet skill: EIP-3009 payment of $0.01 USDC
  //   pinion.skills.wallet()
  // ────────────────────────────────────────────────────────────────────────────
  it("Test 2 — wallet skill: $0.01 USDC payment settles via EIP-3009", async () => {
    const nonce       = toHex(1, { size: 32 }) as Hex;
    const validBefore = BigInt(Math.floor(Date.now() / 1000) + 3600);

    const userUsdcBefore  = await publicClient.readContract({
      address: USDC_ADDRESS, abi: USDC_ABI,
      functionName: "balanceOf", args: [userAddress],
    });
    const paytoUsdcBefore = await publicClient.readContract({
      address: USDC_ADDRESS, abi: USDC_ABI,
      functionName: "balanceOf", args: [PINION_PAYTO],
    });

    const digest = buildEIP3009Digest({
      from: userAddress, to: PINION_PAYTO,
      value: PINION_SKILL_COST, validAfter: 0n, validBefore, nonce,
    });
    const { v, r, s } = await signEIP3009(userWallet, digest);

    await networkHelpers.impersonateAccount(PINION_PAYTO);
    await networkHelpers.setBalance(PINION_PAYTO, parseEther("1"));

    const { request } = await publicClient.simulateContract({
      address: USDC_ADDRESS, abi: USDC_ABI,
      functionName: "transferWithAuthorization",
      args: [userAddress, PINION_PAYTO, PINION_SKILL_COST, 0n, validBefore, nonce, v, r, s],
      account: PINION_PAYTO,
    });
    await userWallet.writeContract({ ...request, account: PINION_PAYTO });

    const userUsdcAfter  = await publicClient.readContract({
      address: USDC_ADDRESS, abi: USDC_ABI,
      functionName: "balanceOf", args: [userAddress],
    });
    const paytoUsdcAfter = await publicClient.readContract({
      address: USDC_ADDRESS, abi: USDC_ABI,
      functionName: "balanceOf", args: [PINION_PAYTO],
    });

    assert.equal(
      userUsdcAfter, userUsdcBefore - PINION_SKILL_COST,
      "User USDC should decrease by skill cost"
    );
    assert.equal(
      paytoUsdcAfter, paytoUsdcBefore + PINION_SKILL_COST,
      "Pinion payTo should receive skill cost"
    );

    // Nonce must be consumed (replay protection)
    const nonceUsed = await publicClient.readContract({
      address: USDC_ADDRESS, abi: USDC_ABI,
      functionName: "authorizationState", args: [userAddress, nonce],
    });
    assert.equal(nonceUsed, true, "Authorization nonce must be consumed after use");

    console.log("✅ Wallet skill | $0.01 USDC settled, nonce consumed");
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Test 3 — wallet skill replay protection
  // ────────────────────────────────────────────────────────────────────────────
  it("Test 3 — wallet skill: EIP-3009 nonce cannot be replayed", async () => {
    const nonce       = toHex(42, { size: 32 }) as Hex;
    const validBefore = BigInt(Math.floor(Date.now() / 1000) + 3600);

    const digest = buildEIP3009Digest({
      from: userAddress, to: PINION_PAYTO,
      value: PINION_SKILL_COST, validAfter: 0n, validBefore, nonce,
    });
    const { v, r, s } = await signEIP3009(userWallet, digest);

    await networkHelpers.impersonateAccount(PINION_PAYTO);
    await networkHelpers.setBalance(PINION_PAYTO, parseEther("1"));

    // First payment — must succeed
    const { request } = await publicClient.simulateContract({
      address: USDC_ADDRESS, abi: USDC_ABI,
      functionName: "transferWithAuthorization",
      args: [userAddress, PINION_PAYTO, PINION_SKILL_COST, 0n, validBefore, nonce, v, r, s],
      account: PINION_PAYTO,
    });
    await userWallet.writeContract({ ...request, account: PINION_PAYTO });

    // Second attempt with same nonce — must revert
    await assert.rejects(
      () => publicClient.simulateContract({
        address: USDC_ADDRESS, abi: USDC_ABI,
        functionName: "transferWithAuthorization",
        args: [userAddress, PINION_PAYTO, PINION_SKILL_COST, 0n, validBefore, nonce, v, r, s],
        account: PINION_PAYTO,
      }),
      "Replay with same nonce should revert"
    );

    console.log("✅ Wallet skill | replay attempt correctly rejected");
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Test 4 — chat skill: $0.01 USDC payment
  //   pinion.skills.chat("what is x402?")
  // ────────────────────────────────────────────────────────────────────────────
  it("Test 4 — chat skill: deducts $0.01 USDC", async () => {
    const balanceBefore = await publicClient.readContract({
      address: USDC_ADDRESS, abi: USDC_ABI,
      functionName: "balanceOf", args: [userAddress],
    });

    await simulatePinionSkillPayment(100);

    const balanceAfter = await publicClient.readContract({
      address: USDC_ADDRESS, abi: USDC_ABI,
      functionName: "balanceOf", args: [userAddress],
    });
    assert.equal(balanceAfter, balanceBefore - PINION_SKILL_COST, "Chat skill deducts $0.01 USDC");

    console.log("✅ Chat skill | $0.01 USDC deducted");
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Test 5 — price skill: $0.01 USDC payment
  //   pinion.skills.price("ETH")
  // ────────────────────────────────────────────────────────────────────────────
  it("Test 5 — price skill: deducts $0.01 USDC", async () => {
    const balanceBefore = await publicClient.readContract({
      address: USDC_ADDRESS, abi: USDC_ABI,
      functionName: "balanceOf", args: [userAddress],
    });

    await simulatePinionSkillPayment(200);

    const balanceAfter = await publicClient.readContract({
      address: USDC_ADDRESS, abi: USDC_ABI,
      functionName: "balanceOf", args: [userAddress],
    });
    assert.equal(balanceAfter, balanceBefore - PINION_SKILL_COST, "Price skill deducts $0.01 USDC");

    console.log("✅ Price skill | $0.01 USDC deducted");
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Test 6 — trade skill: $0.01 USDC payment
  //   pinion.skills.trade("USDC", "ETH", "10")
  // ────────────────────────────────────────────────────────────────────────────
  it("Test 6 — trade skill: deducts $0.01 USDC", async () => {
    const balanceBefore = await publicClient.readContract({
      address: USDC_ADDRESS, abi: USDC_ABI,
      functionName: "balanceOf", args: [userAddress],
    });

    await simulatePinionSkillPayment(300);

    const balanceAfter = await publicClient.readContract({
      address: USDC_ADDRESS, abi: USDC_ABI,
      functionName: "balanceOf", args: [userAddress],
    });
    assert.equal(balanceAfter, balanceBefore - PINION_SKILL_COST, "Trade skill deducts $0.01 USDC");

    console.log("✅ Trade skill | $0.01 USDC deducted");
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Test 7 — fund skill: $0.01 USDC payment
  //   pinion.skills.fund(userAddress)
  // ────────────────────────────────────────────────────────────────────────────
  it("Test 7 — fund skill: deducts $0.01 USDC", async () => {
    const balanceBefore = await publicClient.readContract({
      address: USDC_ADDRESS, abi: USDC_ABI,
      functionName: "balanceOf", args: [userAddress],
    });

    await simulatePinionSkillPayment(400);

    const balanceAfter = await publicClient.readContract({
      address: USDC_ADDRESS, abi: USDC_ABI,
      functionName: "balanceOf", args: [userAddress],
    });
    assert.equal(balanceAfter, balanceBefore - PINION_SKILL_COST, "Fund skill deducts $0.01 USDC");

    console.log("✅ Fund skill | $0.01 USDC deducted");
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Test 8 — unlimited plan: $100 USDC one-time payment
  //   pinion.skills.unlimited()
  // ────────────────────────────────────────────────────────────────────────────
  it("Test 8 — unlimited plan: settles exactly $100 USDC", async () => {
    const nonce       = toHex(9999, { size: 32 }) as Hex;
    const validBefore = BigInt(Math.floor(Date.now() / 1000) + 3600);

    const userUsdcBefore  = await publicClient.readContract({
      address: USDC_ADDRESS, abi: USDC_ABI,
      functionName: "balanceOf", args: [userAddress],
    });
    const paytoUsdcBefore = await publicClient.readContract({
      address: USDC_ADDRESS, abi: USDC_ABI,
      functionName: "balanceOf", args: [PINION_PAYTO],
    });

    const digest = buildEIP3009Digest({
      from: userAddress, to: PINION_PAYTO,
      value: PINION_UNLIMITED_COST, validAfter: 0n, validBefore, nonce,
    });
    const { v, r, s } = await signEIP3009(userWallet, digest);

    await networkHelpers.impersonateAccount(PINION_PAYTO);
    await networkHelpers.setBalance(PINION_PAYTO, parseEther("1"));

    const { request } = await publicClient.simulateContract({
      address: USDC_ADDRESS, abi: USDC_ABI,
      functionName: "transferWithAuthorization",
      args: [userAddress, PINION_PAYTO, PINION_UNLIMITED_COST, 0n, validBefore, nonce, v, r, s],
      account: PINION_PAYTO,
    });
    await userWallet.writeContract({ ...request, account: PINION_PAYTO });

    const userUsdcAfter  = await publicClient.readContract({
      address: USDC_ADDRESS, abi: USDC_ABI,
      functionName: "balanceOf", args: [userAddress],
    });
    const paytoUsdcAfter = await publicClient.readContract({
      address: USDC_ADDRESS, abi: USDC_ABI,
      functionName: "balanceOf", args: [PINION_PAYTO],
    });

    assert.equal(
      userUsdcAfter, userUsdcBefore - PINION_UNLIMITED_COST,
      "Unlimited plan must deduct exactly $100 USDC"
    );
    assert.equal(
      paytoUsdcAfter, paytoUsdcBefore + PINION_UNLIMITED_COST,
      "Pinion payTo must receive exactly $100 USDC"
    );

    console.log("✅ Unlimited plan | $100 USDC settled");
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Test 9 — insufficient funds guard
  //   Mirrors: error: 'insufficient_funds' in the 402 response
  // ────────────────────────────────────────────────────────────────────────────
  it("Test 9 — insufficient funds: payment reverts with 0 USDC", async () => {
    const { privateKeyToAccount } = await import("viem/accounts");
    const brokeKey: Hex =
      "0xbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbad0";
    const brokeAccount = privateKeyToAccount(brokeKey);
    const brokeAddress = brokeAccount.address;

    await networkHelpers.setBalance(brokeAddress, parseEther("1"));
    // No USDC for brokeAddress

    const nonce       = toHex(500, { size: 32 }) as Hex;
    const validBefore = BigInt(Math.floor(Date.now() / 1000) + 3600);

    const digest = buildEIP3009Digest({
      from: brokeAddress, to: PINION_PAYTO,
      value: PINION_SKILL_COST, validAfter: 0n, validBefore, nonce,
    });

    // Sign with broke key (need a temp wallet client)
    const brokeWallet = await viem.getWalletClient(brokeAddress);
    await networkHelpers.impersonateAccount(brokeAddress);
    const { v, r, s } = await signEIP3009(brokeWallet, digest);

    await networkHelpers.impersonateAccount(PINION_PAYTO);

    await assert.rejects(
      () => publicClient.simulateContract({
        address: USDC_ADDRESS, abi: USDC_ABI,
        functionName: "transferWithAuthorization",
        args: [brokeAddress, PINION_PAYTO, PINION_SKILL_COST, 0n, validBefore, nonce, v, r, s],
        account: PINION_PAYTO,
      }),
      "Payment from broke user should revert"
    );

    console.log("✅ Insufficient funds | payment correctly rejected");
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Test 10 — expired authorization
  // ────────────────────────────────────────────────────────────────────────────
  it("Test 10 — expired authorization: validBefore in the past reverts", async () => {
    const nonce      = toHex(600, { size: 32 }) as Hex;
    const expiredTs  = BigInt(Math.floor(Date.now() / 1000) - 1); // already expired

    const digest = buildEIP3009Digest({
      from: userAddress, to: PINION_PAYTO,
      value: PINION_SKILL_COST, validAfter: 0n, validBefore: expiredTs, nonce,
    });
    const { v, r, s } = await signEIP3009(userWallet, digest);

    await networkHelpers.impersonateAccount(PINION_PAYTO);

    await assert.rejects(
      () => publicClient.simulateContract({
        address: USDC_ADDRESS, abi: USDC_ABI,
        functionName: "transferWithAuthorization",
        args: [userAddress, PINION_PAYTO, PINION_SKILL_COST, 0n, expiredTs, nonce, v, r, s],
        account: PINION_PAYTO,
      }),
      "Expired authorization should revert"
    );

    console.log("✅ Expired authorization | correctly rejected");
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Test 11 — full example flow (cumulative cost)
  //   mirrors entire main() function: wallet + price + chat + trade + fund
  //   = 5 × $0.01 = $0.05 USDC
  // ────────────────────────────────────────────────────────────────────────────
  it("Test 11 — full example flow: 5 skills = $0.05 USDC total", async () => {
    const usdcBefore = await publicClient.readContract({
      address: USDC_ADDRESS, abi: USDC_ABI,
      functionName: "balanceOf", args: [userAddress],
    });

    const SKILL_COUNT = 5n;
    for (let i = 1n; i <= SKILL_COUNT; i++) {
      await simulatePinionSkillPayment(Number(i * 1000n));
    }

    const usdcAfter = await publicClient.readContract({
      address: USDC_ADDRESS, abi: USDC_ABI,
      functionName: "balanceOf", args: [userAddress],
    });

    const expected = SKILL_COUNT * PINION_SKILL_COST; // 50_000 = $0.05
    assert.equal(
      usdcAfter, usdcBefore - expected,
      "Full example flow should cost $0.05 USDC total"
    );

    console.log("✅ Full example flow | total deducted:", expected.toString(), "units (=$0.05)");
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Test 12 — time manipulation: validAfter window
  //   EIP-3009 allows setting validAfter; payment can't be used before it.
  //   Mirrors Foundry's `vm.warp(...)`.
  // ────────────────────────────────────────────────────────────────────────────
  it("Test 12 — validAfter: payment blocked before window, succeeds after time.increase", async () => {
    const nonce       = toHex(700, { size: 32 }) as Hex;
    const now         = BigInt(Math.floor(Date.now() / 1000));
    const validAfter  = now + 3600n; // 1 hour in the future
    const validBefore = now + 7200n; // 2 hours in the future

    const digest = buildEIP3009Digest({
      from: userAddress, to: PINION_PAYTO,
      value: PINION_SKILL_COST, validAfter, validBefore, nonce,
    });
    const { v, r, s } = await signEIP3009(userWallet, digest);

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
      "Payment before validAfter should revert"
    );

    // Warp time past validAfter (mirrors Foundry's vm.warp)
    await networkHelpers.time.increase(3601); // +1 hour + 1 second

    // After validAfter — must succeed
    const { request } = await publicClient.simulateContract({
      address: USDC_ADDRESS, abi: USDC_ABI,
      functionName: "transferWithAuthorization",
      args: [userAddress, PINION_PAYTO, PINION_SKILL_COST, validAfter, validBefore, nonce, v, r, s],
      account: PINION_PAYTO,
    });
    await userWallet.writeContract({ ...request, account: PINION_PAYTO });

    const nonceUsed = await publicClient.readContract({
      address: USDC_ADDRESS, abi: USDC_ABI,
      functionName: "authorizationState", args: [userAddress, nonce],
    });
    assert.equal(nonceUsed, true, "Nonce should be consumed after successful payment");

    console.log("✅ validAfter | blocked before window, succeeded after time.increase");
  });
});