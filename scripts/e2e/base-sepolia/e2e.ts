import { createPublicClient, createWalletClient, http, toHex, type Hex } from "viem";

// ─────────────────────────────────────────────
// Library version notes
// @aztec/bb.js           ^3.0.0-devnet.6-patch.1
// @noir-lang/noir_js      1.0.0-beta.18
//
// UltraHonkBackend.generateProof() returns:
//   { proof: Uint8Array, publicInputs: string[] }
//
//   proof        – raw bytes, NO length prefix.  Encode directly as `bytes`.
//   publicInputs – decimal string per field element, circuit declaration order.
// ─────────────────────────────────────────────
import { baseSepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { IMT } from "@zk-kit/imt";
import {
  createMerkleTree,
  insertLeaf,
  getMerkleRoot,
  generatePolicyCommitment,
  generatePassengerHash,
  generateNullifier,
  generateNullifierHash,
} from "../../circuits/zk-libs/merkle-tree/imt.ts";
import {
  generateProof,
  generateRandomInt,
  FlightDelayPrivateInputs,
  FlightDelayPublicInputs,
  ProofResult,
} from "../../circuits/zk-prover/zk-prover.ts";

// @dev - Node modules for file system and path handling, used to load .env files from the contracts directory
import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

// ─────────────────────────────────────────────
// Load .env files
// ─────────────────────────────────────────────
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const envPath = resolve(__dirname, "../../../contracts/.env");

const result = config({ path: envPath });
if (result.error) {
  console.error("❌ Error loading .env file:", result.error);
  throw result.error;
}

// ─────────────────────────────────────────────
// Contract Addresses (BASE Sepolia)
// ─────────────────────────────────────────────
const HONK_VERIFIER_ADDRESS =
  (process.env.HONK_VERIFIER_ON_BASE_SEPOLIA as Hex) ?? "";
const FLIGHT_DELAY_INSURANCE_VERIFIER_ADDRESS =
  (process.env.FLIGHT_DELAY_INSURANCE_VERIFIER_ON_BASE_SEPOLIA as Hex) ?? "";
const FLIGHT_DELAY_INSURANCE_ADDRESS =
  (process.env.FLIGHT_DELAY_INSURANCE_ON_BASE_SEPOLIA as Hex) ?? "";

// ─────────────────────────────────────────────
// Minimal ABIs
// ─────────────────────────────────────────────

/**
 * HonkVerifier.sol
 *
 * Key constraint from the deployed contract:
 *   NUMBER_OF_PUBLIC_INPUTS = 18  (includes 16 pairing point limbs)
 *   verify() enforces: publicInputs.length == publicInputsSize - PAIRING_POINTS_SIZE
 *                                           == 18 - 16 == 2
 *
 * So the on-chain verify() call must receive exactly 2 public inputs.
 * The 16 pairing-point limbs live inside the proof bytes themselves and
 * are NOT passed in the publicInputs array.
 *
 * The 2 remaining public inputs are whatever your Noir circuit declares
 * as `pub` (excluding pairing points).  Inspect your compiled circuit ABI
 * to confirm the exact order; the values below assume:
 *   publicInputs[0] = policyTreeRoot  (output)
 *   publicInputs[1] = nullifierHash   (output)
 *
 * Errors emitted by the verifier on revert:
 *   ProofLengthWrongWithLogN(uint256 logN, uint256 actual, uint256 expected) → adjust proof stripping
 *   PublicInputsLengthWrong()  → wrong number of elements in publicInputs[]
 *   SumcheckFailed()           → proof bytes are malformed / wrong inputs
 *   ShpleminiFailed()          → pairing check failed
 */
const HONK_VERIFIER_ABI = [
  {
    name: "verify",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "proof", type: "bytes" },
      { name: "publicInputs", type: "bytes32[]" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  // Custom errors – add to ABI so viem can decode revert reasons
  { name: "ProofLengthWrong",            type: "error", inputs: [] },
  { name: "ProofLengthWrongWithLogN",    type: "error", inputs: [
      { name: "logN",           type: "uint256" },
      { name: "actualLength",   type: "uint256" },
      { name: "expectedLength", type: "uint256" },
  ]},
  { name: "PublicInputsLengthWrong",     type: "error", inputs: [] },
  { name: "SumcheckFailed",             type: "error", inputs: [] },
  { name: "ShpleminiFailed",            type: "error", inputs: [] },
  { name: "GeminiChallengeInSubgroup",  type: "error", inputs: [] },
  { name: "ConsistencyCheckFailed",     type: "error", inputs: [] },
] as const;

/**
 * FlightDelayInsuranceVerifier.sol
 *
 * function verifyFlightDelayInsuranceProof(
 *     bytes calldata proof,
 *     bytes32[] calldata publicInputs
 * ) external view returns (bool)
 *
 * This contract simply delegates to HonkVerifier.verify(), so it expects
 * exactly the same proof bytes and publicInputs array.
 */
const FLIGHT_DELAY_INSURANCE_VERIFIER_ABI = [
  {
    name: "verifyFlightDelayInsuranceProof",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "proof", type: "bytes" },
      { name: "publicInputs", type: "bytes32[]" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

/**
 * FlightDelayInsurance.sol
 *
 * function buyPolicy(
 *     bytes32 policyTreeRoot,
 *     uint256 policyId,
 *     uint256 coverageStart,
 *     uint256 coverageEnd
 * ) external payable
 *
 * function claim(
 *     uint256 policyId,
 *     bytes calldata proof,
 *     bytes32[] calldata publicInputs
 * ) external
 *
 * NOTE: There is NO submitClaim / isNullifierUsed in this contract.
 *       Double-spend protection must be checked via the `policies` mapping
 *       (Policy.claimed == true after the first successful claim).
 */
const FLIGHT_DELAY_INSURANCE_ABI = [
  {
    name: "buyPolicy",
    type: "function",
    stateMutability: "payable",
    inputs: [
      { name: "policyTreeRoot", type: "bytes32" },
      { name: "policyId",       type: "uint256" },
      { name: "coverageStart",  type: "uint256" },
      { name: "coverageEnd",    type: "uint256" },
    ],
    outputs: [],
  },
  {
    name: "claim",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "policyId",     type: "uint256" },
      { name: "proof",        type: "bytes" },
      { name: "publicInputs", type: "bytes32[]" },
    ],
    outputs: [],
  },
  {
    // Read the Policy struct to check `claimed` status (double-spend guard)
    name: "policies",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "policyId", type: "uint256" }],
    outputs: [
      { name: "holder",        type: "address"  },
      { name: "payoutAmount",  type: "uint256"  },
      { name: "coverageStart", type: "uint256"  },
      { name: "coverageEnd",   type: "uint256"  },
      { name: "claimed",       type: "bool"     },
    ],
  },
  {
    name: "policyTreeRoots",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "policyId", type: "uint256" }],
    outputs: [{ name: "", type: "bytes32" }],
  },
] as const;

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function toBytes32(value: bigint | string): Hex {
  const bn = typeof value === "string" ? BigInt(value) : value;
  return toHex(bn, { size: 32 });
}

/**
 * Encode proof bytes for on-chain calldata.
 *
 * @aztec/bb.js ^3.0.0-devnet.6-patch.1 returns a plain Uint8Array with
 * NO length prefix.  We mirror the pattern used in the reference e2e script
 * (doc 6): Buffer.from(proof).toString('hex') — this is the proven-correct
 * encoding for this exact library version.
 *
 * Expected size: calculateProofSize(LOG_N=13) * 32 = 246 * 32 = 7872 bytes.
 */
function proofToHex(proof: Uint8Array | string): Hex {
  if (typeof proof === "string") {
    return (proof.startsWith("0x") ? proof : `0x${proof}`) as Hex;
  }
  return `0x${Buffer.from(proof).toString("hex")}` as Hex;
}

/**
 * Build the publicInputs array that the on-chain HonkVerifier.verify() expects.
 *
 * IMPORTANT – element count must equal: NUMBER_OF_PUBLIC_INPUTS - PAIRING_POINTS_SIZE
 *                                     = 18 - 16 = 2
 *
 * The on-chain verifier will revert with PublicInputsLengthWrong() if this
 * count is wrong.
 *
 * The pairing-point limbs (16 × Fr) are embedded inside the proof bytes and
 * must NOT appear here.
 *
 * Public outputs are committed to inside the proof itself; only the values
 * the circuit exposes as `pub` return values need to be listed here.
 * Adjust the two slots below to match the exact order your Noir circuit
 * declares its public outputs (check circuits/target/<name>.json → abi).
 */
/**
 * Convert a single public-input field element (decimal string or bigint) to a
 * 0x-prefixed bytes32 hex string.
 *
 * Mirrors the pattern from the reference e2e (doc 6):
 *   BigInt(input).toString(16).padStart(64, "0")
 */
function fieldToBytes32(value: string | bigint): Hex {
  return `0x${BigInt(value).toString(16).padStart(64, "0")}` as Hex;
}

function buildPublicInputs(proofResult: ProofResult): Hex[] {
  const { publicOutputs } = proofResult;

  // Exactly 2 elements — must equal NUMBER_OF_PUBLIC_INPUTS - PAIRING_POINTS_SIZE
  // = 18 - 16 = 2.  The verifier reverts with PublicInputsLengthWrong() otherwise.
  //
  // Order must match the circuit's `pub` return declarations.
  // Verify against circuits/target/<name>.json → abi.parameters[*].visibility=="public"
  return [
    fieldToBytes32(publicOutputs.policyTreeRoot),
    fieldToBytes32(publicOutputs.nullifierHash),
  ];
}

// ─────────────────────────────────────────────
// Viem clients
// ─────────────────────────────────────────────

function buildClients(rpcUrl: string) {
  const privateKey = process.env.USER_PRIVATE_KEY as Hex;
  if (!privateKey) {
    throw new Error("USER_PRIVATE_KEY env var is required for on-chain transactions");
  }

  const account = privateKeyToAccount(privateKey);

  const publicClient = createPublicClient({
    chain: baseSepolia,
    transport: http(rpcUrl),
  });

  const walletClient = createWalletClient({
    account,
    chain: baseSepolia,
    transport: http(rpcUrl),
  });

  return { publicClient, walletClient, account };
}

// ─────────────────────────────────────────────
// Step 1 – Off-chain ZKP Generation
// ─────────────────────────────────────────────

async function generateZKProofOffChain(): Promise<{
  proofResult: ProofResult;
  tree: IMT;
  policyId: number;
  publicInputsForBuy: { policyTreeRoot: bigint; coverageStart: number; coverageEnd: number };
}> {
  console.log("\n╔══════════════════════════════════════════╗");
  console.log("║  STEP 1: Off-Chain ZKP Generation        ║");
  console.log("╚══════════════════════════════════════════╝\n");

  const tree = createMerkleTree();
  const salt = generateRandomInt();
  const policyId = 1;

  const passengerNameHash = BigInt(
    "0x" + Buffer.from("Alice Johnson").toString("hex").padStart(64, "0").slice(0, 64)
  );
  const ticketNumberHash = BigInt(
    "0x" + Buffer.from("TK-20240315-001").toString("hex").padStart(64, "0").slice(0, 64)
  );
  const flightNumberHash = BigInt(
    "0x" + Buffer.from("BA-0285").toString("hex").padStart(64, "0").slice(0, 64)
  );

  const passengerHash = generatePassengerHash(ticketNumberHash, flightNumberHash, passengerNameHash);
  const commitment = generatePolicyCommitment(policyId, passengerHash, salt);
  insertLeaf(tree, commitment);

  for (let i = 0; i < 3; i++) {
    insertLeaf(tree, generateRandomInt());
  }

  const policyTreeRoot = getMerkleRoot(tree);
  const coverageStart = 1735700000;
  const coverageEnd   = 1735800000;

  console.log(`   Policy ID          : ${policyId}`);
  console.log(`   Salt               : ${salt}`);
  console.log(`   Passenger Hash     : ${passengerHash}`);
  console.log(`   Policy Commitment  : 0x${commitment.toString(16).slice(0, 16)}...`);
  console.log(`   Merkle Root        : ${policyTreeRoot}\n`);

  const scheduledArrival = 1735725600; // 2025-01-01T10:00:00Z
  const actualArrival    = 1735731000; // 2025-01-01T11:30:00Z  (+90 min)

  const privateInputs: FlightDelayPrivateInputs = {
    passengerNameHash,
    ticketNumberHash,
    flightNumberHash,
    salt,
    passengerHash,
    scheduledArrival,
    actualArrival,
  };

  const publicInputs: FlightDelayPublicInputs = {
    policyTreeRoot,
    policyId,
    coverageStart,
    coverageEnd,
    delayThreshold: 3600, // 60-minute threshold
  };

  console.log("→ Circuit inputs:");
  console.log(`   Scheduled Arrival  : ${new Date(scheduledArrival * 1000).toISOString()}`);
  console.log(`   Actual Arrival     : ${new Date(actualArrival    * 1000).toISOString()}`);
  console.log(`   Delay              : ${(actualArrival - scheduledArrival) / 60} minutes`);
  console.log(`   Delay Threshold    : ${publicInputs.delayThreshold / 60} minutes\n`);

  console.log("→ Generating ZK proof (this may take 30–120 seconds)…\n");
  const proofResult = await generateProof(privateInputs, publicInputs, tree);

  const proofBytes = proofResult.proof.proof as Uint8Array;
  console.log("\n✓ ZK proof generated!");
  console.log(`   Nullifier Hash     : ${proofResult.publicOutputs.nullifierHash}`);
  console.log(`   Proof size         : ${proofBytes.length} bytes (expected 7872 for LOG_N=13)\n`);

  return {
    proofResult,
    tree,
    policyId,
    publicInputsForBuy: { policyTreeRoot, coverageStart, coverageEnd },
  };
}

// ─────────────────────────────────────────────
// Step 2 – On-Chain ZKP Verification (read-only)
// ─────────────────────────────────────────────

async function verifyZKProofOnChain(
  proofResult: ProofResult,
  publicClient: ReturnType<typeof createPublicClient>
): Promise<boolean> {
  console.log("\n╔══════════════════════════════════════════╗");
  console.log("║  STEP 2: On-Chain ZKP Verification       ║");
  console.log("╚══════════════════════════════════════════╝\n");

  const proofHex       = proofToHex(proofResult.proof.proof as Uint8Array);
  const publicInputsHex = buildPublicInputs(proofResult);

  console.log(`   Public inputs sent (${publicInputsHex.length} elements):`);
  publicInputsHex.forEach((v, i) => console.log(`     [${i}] ${v}`));
  console.log();

  console.log(`→ Calling HonkVerifier.verify() at ${HONK_VERIFIER_ADDRESS}…`);
  const isValidHonk = await publicClient.readContract({
    address: HONK_VERIFIER_ADDRESS,
    abi: HONK_VERIFIER_ABI,
    functionName: "verify",
    args: [proofHex, publicInputsHex],
  });
  console.log(`   HonkVerifier result          : ${isValidHonk ? "✓ VALID" : "✗ INVALID"}`);

  console.log(
    `\n→ Calling FlightDelayInsuranceVerifier.verifyFlightDelayInsuranceProof() at ${FLIGHT_DELAY_INSURANCE_VERIFIER_ADDRESS}…`
  );
  const isValidDomain = await publicClient.readContract({
    address: FLIGHT_DELAY_INSURANCE_VERIFIER_ADDRESS,
    abi: FLIGHT_DELAY_INSURANCE_VERIFIER_ABI,
    functionName: "verifyFlightDelayInsuranceProof",
    args: [proofHex, publicInputsHex],
  });
  console.log(`   FlightDelayInsuranceVerifier : ${isValidDomain ? "✓ VALID" : "✗ INVALID"}\n`);

  return isValidHonk && isValidDomain;
}

// ─────────────────────────────────────────────
// Step 2.5 – Buy Policy On-Chain (if not already purchased)
// ─────────────────────────────────────────────

/**
 * Calls FlightDelayInsurance.buyPolicy() so that msg.sender is registered as
 * the policy holder before claim() is called.
 *
 * Idempotent: if policies[policyId].holder already equals the wallet address
 * the step is skipped to avoid the "policy already exists" revert.
 *
 * buyPolicy() is payable — the value sent becomes the premium.  The contract
 * stores payoutAmount = msg.value * 3, so send at least 1 wei.  For a
 * testnet E2E we send a small fixed amount (0.001 ETH).
 */
async function buyPolicyOnChain(
  policyId: number,
  policyTreeRoot: bigint,
  coverageStart: number,
  coverageEnd: number,
  account: ReturnType<typeof privateKeyToAccount>,
  publicClient: ReturnType<typeof createPublicClient>,
  walletClient: ReturnType<typeof createWalletClient>
): Promise<void> {
  console.log("\n╔══════════════════════════════════════════╗");
  console.log("║  STEP 2.5: Buy Policy On-Chain           ║");
  console.log("╚══════════════════════════════════════════╝\n");

  // Check whether this wallet already owns the policy.
  // viem returns Solidity struct/tuple outputs as a plain array when the
  // function is defined with named outputs — index into it positionally:
  //   [0] holder, [1] payoutAmount, [2] coverageStart, [3] coverageEnd, [4] claimed
  const existingRaw = await publicClient.readContract({
    address: FLIGHT_DELAY_INSURANCE_ADDRESS,
    abi: FLIGHT_DELAY_INSURANCE_ABI,
    functionName: "policies",
    args: [BigInt(policyId)],
  }) as readonly [string, bigint, bigint, bigint, boolean];

  const [existingHolder] = existingRaw;
  const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

  if (existingHolder.toLowerCase() !== ZERO_ADDRESS && existingHolder.toLowerCase() === account.address.toLowerCase()) {
    console.log(`   Policy #${policyId} already owned by this wallet — skipping buyPolicy().\n`);
    return;
  }

  if (existingHolder.toLowerCase() !== ZERO_ADDRESS) {
    throw new Error(
      `Policy #${policyId} is already owned by a different address (${existingHolder}). ` +
      `Use a different policyId or the wallet that purchased this policy.`
    );
  }

  const policyTreeRootBytes32 = `0x${policyTreeRoot.toString(16).padStart(64, "0")}` as Hex;
  const premium = 1_000_000_000_000_000n; // 0.001 ETH in wei

  console.log(`→ Calling FlightDelayInsurance.buyPolicy() at ${FLIGHT_DELAY_INSURANCE_ADDRESS}…`);
  console.log(`   Policy ID      : ${policyId}`);
  console.log(`   Policy Root    : ${policyTreeRootBytes32.slice(0, 18)}…`);
  console.log(`   Coverage Start : ${new Date(coverageStart * 1000).toISOString()}`);
  console.log(`   Coverage End   : ${new Date(coverageEnd   * 1000).toISOString()}`);
  console.log(`   Premium (value): ${premium} wei (0.001 ETH)\n`);

  const txHash = await walletClient.writeContract({
    address: FLIGHT_DELAY_INSURANCE_ADDRESS,
    abi: FLIGHT_DELAY_INSURANCE_ABI,
    functionName: "buyPolicy",
    args: [policyTreeRootBytes32, BigInt(policyId), BigInt(coverageStart), BigInt(coverageEnd)],
    value: premium,
  });

  console.log(`   Transaction submitted: ${txHash}`);
  console.log("   Waiting for confirmation…");

  const receipt = await publicClient.waitForTransactionReceipt({
    hash: txHash,
    confirmations: 1,
  });

  if (receipt.status === "success") {
    console.log(`\n✓ Policy purchased successfully!`);
    console.log(`   Block    : ${receipt.blockNumber}`);
    console.log(`   Gas Used : ${receipt.gasUsed}`);
    console.log(`   Explorer : https://sepolia.basescan.org/tx/${txHash}\n`);
  } else {
    throw new Error(`buyPolicy() transaction reverted. Hash: ${txHash}`);
  }
}

// ─────────────────────────────────────────────
// Step 3 – Submit Claim On-Chain
// ─────────────────────────────────────────────

async function submitClaimOnChain(
  proofResult: ProofResult,
  policyId: number,
  publicClient: ReturnType<typeof createPublicClient>,
  walletClient: ReturnType<typeof createWalletClient>
): Promise<void> {
  console.log("\n╔══════════════════════════════════════════╗");
  console.log("║  STEP 3: Submit Claim On-Chain           ║");
  console.log("╚══════════════════════════════════════════╝\n");

  const proofHex        = proofToHex(proofResult.proof.proof as Uint8Array);
  const publicInputsHex = buildPublicInputs(proofResult);

  // Double-spend guard: read Policy.claimed via the `policies` mapping
  // viem returns tuple outputs as a positional array: [holder, payoutAmount, coverageStart, coverageEnd, claimed]
  console.log(`→ Checking policy #${policyId} claim status on-chain…`);
  const policyRaw = await publicClient.readContract({
    address: FLIGHT_DELAY_INSURANCE_ADDRESS,
    abi: FLIGHT_DELAY_INSURANCE_ABI,
    functionName: "policies",
    args: [BigInt(policyId)],
  }) as readonly [string, bigint, bigint, bigint, boolean];

  const [, , , , alreadyClaimed] = policyRaw;

  if (alreadyClaimed) {
    console.log("⚠  Policy already claimed – skipping.\n");
    return;
  }
  console.log("   Policy not yet claimed – proceeding.\n");

  console.log(`→ Calling FlightDelayInsurance.claim() at ${FLIGHT_DELAY_INSURANCE_ADDRESS}…`);
  const txHash = await walletClient.writeContract({
    address: FLIGHT_DELAY_INSURANCE_ADDRESS,
    abi: FLIGHT_DELAY_INSURANCE_ABI,
    functionName: "claim",
    args: [BigInt(policyId), proofHex, publicInputsHex],
  });

  console.log(`   Transaction submitted: ${txHash}`);
  console.log("   Waiting for confirmation…");

  const receipt = await publicClient.waitForTransactionReceipt({
    hash: txHash,
    confirmations: 1,
  });

  if (receipt.status === "success") {
    console.log(`\n✓ Claim submitted successfully!`);
    console.log(`   Block    : ${receipt.blockNumber}`);
    console.log(`   Gas Used : ${receipt.gasUsed}`);
    console.log(`   Explorer : https://sepolia.basescan.org/tx/${txHash}\n`);
  } else {
    throw new Error(`Transaction reverted. Hash: ${txHash}`);
  }
}

// ─────────────────────────────────────────────
// Main E2E Runner
// ─────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("╔══════════════════════════════════════════════════╗");
  console.log("║   Flight Delay Insurance – E2E Test              ║");
  console.log("║   Off-Chain ZKP Generation → On-Chain Verify     ║");
  console.log("╚══════════════════════════════════════════════════╝");

  const missingEnv: string[] = [];
  if (!HONK_VERIFIER_ADDRESS)                      missingEnv.push("HONK_VERIFIER_ON_BASE_SEPOLIA");
  if (!FLIGHT_DELAY_INSURANCE_VERIFIER_ADDRESS)    missingEnv.push("FLIGHT_DELAY_INSURANCE_VERIFIER_ON_BASE_SEPOLIA");
  if (!FLIGHT_DELAY_INSURANCE_ADDRESS)             missingEnv.push("FLIGHT_DELAY_INSURANCE_ON_BASE_SEPOLIA");
  if (!process.env.USER_PRIVATE_KEY)               missingEnv.push("USER_PRIVATE_KEY");

  if (missingEnv.length > 0) {
    console.error("\n✗ Missing required environment variables:");
    missingEnv.forEach((v) => console.error(`   - ${v}`));
    process.exit(1);
  }

  const rpcUrl = process.env.BASE_SEPOLIA_RPC_URL ?? "https://sepolia.base.org";

  console.log(`\n   Network     : BASE Sepolia`);
  console.log(`   RPC URL     : ${rpcUrl}`);
  console.log(`   HonkVerifier: ${HONK_VERIFIER_ADDRESS}`);
  console.log(`   FDI Verifier: ${FLIGHT_DELAY_INSURANCE_VERIFIER_ADDRESS}`);
  console.log(`   FDI Contract: ${FLIGHT_DELAY_INSURANCE_ADDRESS}\n`);

  const { publicClient, walletClient, account } = buildClients(rpcUrl);

  // ── Step 1: Generate ZK proof off-chain ──
  const { proofResult, policyId, publicInputsForBuy } = await generateZKProofOffChain();

  // ── Step 2: Verify proof on-chain (read-only) ──
  const proofIsValid = await verifyZKProofOnChain(proofResult, publicClient);
  if (!proofIsValid) {
    console.error("✗ On-chain verification failed. Aborting claim submission.\n");
    process.exit(1);
  }

  // ── Step 2.5: Buy the policy so this wallet is registered as holder ──
  await buyPolicyOnChain(
    policyId,
    publicInputsForBuy.policyTreeRoot,
    publicInputsForBuy.coverageStart,
    publicInputsForBuy.coverageEnd,
    account,
    publicClient,
    walletClient,
  );

  // ── Step 3: Submit claim on-chain ──
  await submitClaimOnChain(proofResult, policyId, publicClient, walletClient);

  console.log("╔══════════════════════════════════════════════════╗");
  console.log("║  E2E Test Completed Successfully ✓               ║");
  console.log("╚══════════════════════════════════════════════════╝\n");
}

main().catch((err) => {
  console.error("\n✗ E2E test failed:", err);
  process.exit(1);
});