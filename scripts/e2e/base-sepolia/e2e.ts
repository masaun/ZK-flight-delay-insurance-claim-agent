import { createPublicClient, createWalletClient, http, toHex, type Hex } from "viem";
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
 * Strip the 4-byte length prefix that bb.js prepends to raw proof bytes,
 * then encode as a 0x-prefixed hex string.
 *
 * bb.js (NoirJS UltraHonk backend) prepends 4 bytes representing the number
 * of 32-byte field elements in the proof.  The on-chain verifier expects raw
 * proof bytes with no prefix, so we strip it before encoding.
 */
function proofToHex(proof: Uint8Array | string): Hex {
  if (typeof proof === "string") {
    return proof.startsWith("0x") ? (proof as Hex) : (`0x${proof}` as Hex);
  }
  // Strip the 4-byte length prefix added by bb.js
  const raw = proof.length > 4 ? proof.slice(4) : proof;
  return toHex(raw);
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
function buildPublicInputs(proofResult: ProofResult): Hex[] {
  const { publicOutputs } = proofResult;

  // Exactly 2 elements: the circuit's public outputs (NOT the private inputs
  // re-stated, and NOT the pairing points which live in the proof bytes).
  return [
    toBytes32(BigInt(publicOutputs.policyTreeRoot)),
    toBytes32(BigInt(publicOutputs.nullifierHash)),
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
  console.log(`   Raw proof size     : ${proofBytes.length} bytes`);
  console.log(`   Stripped size      : ${proofBytes.length > 4 ? proofBytes.length - 4 : proofBytes.length} bytes\n`);

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
  console.log(`→ Checking policy #${policyId} claim status on-chain…`);
  const policy = await publicClient.readContract({
    address: FLIGHT_DELAY_INSURANCE_ADDRESS,
    abi: FLIGHT_DELAY_INSURANCE_ABI,
    functionName: "policies",
    args: [BigInt(policyId)],
  });

  if (policy.claimed) {
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

  const { publicClient, walletClient } = buildClients(rpcUrl);

  // ── Step 1: Generate ZK proof off-chain ──
  const { proofResult, policyId } = await generateZKProofOffChain();

  // ── Step 2: Verify proof on-chain (read-only) ──
  const proofIsValid = await verifyZKProofOnChain(proofResult, publicClient);
  if (!proofIsValid) {
    console.error("✗ On-chain verification failed. Aborting claim submission.\n");
    process.exit(1);
  }

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