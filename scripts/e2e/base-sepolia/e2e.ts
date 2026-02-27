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
// Load environment variables from contracts/.env
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const envPath = resolve(__dirname, "../../../contracts/.env");

//console.log("📂 Loading environment from:", envPath);
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
 * Minimal ABI for the HonkVerifier contract.
 * verify(bytes calldata proof, bytes32[] calldata publicInputs) external view returns (bool)
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
] as const;

/**
 * Minimal ABI for the FlightDelayInsuranceVerifier contract.
 * Wraps the HonkVerifier for domain-specific verification.
 */
const FLIGHT_DELAY_INSURANCE_VERIFIER_ABI = [
  {
    name: "verifyProof",
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
 * Minimal ABI for the FlightDelayInsurance main contract.
 * submitClaim(bytes proof, bytes32[] publicInputs, bytes32 nullifierHash) external
 */
const FLIGHT_DELAY_INSURANCE_ABI = [
  {
    name: "submitClaim",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "proof", type: "bytes" },
      { name: "publicInputs", type: "bytes32[]" },
      { name: "nullifierHash", type: "bytes32" },
    ],
    outputs: [],
  },
  {
    name: "isNullifierUsed",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "nullifierHash", type: "bytes32" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    name: "ClaimSubmitted",
    type: "event",
    inputs: [
      { name: "nullifierHash", type: "bytes32", indexed: true },
      { name: "policyTreeRoot", type: "bytes32", indexed: false },
    ],
  },
] as const;

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

/**
 * Converts a BigInt proof/public-input value to a 0x-prefixed 32-byte hex string
 * suitable for ABI-encoding as bytes32.
 */
function toBytes32(value: bigint | string): Hex {
  const bn = typeof value === "string" ? BigInt(value) : value;
  return toHex(bn, { size: 32 });
}

/**
 * Serialises the raw proof bytes (Uint8Array) returned by bb.js into a
 * 0x-prefixed hex string for calldata.
 */
function proofToHex(proof: Uint8Array | string): Hex {
  if (typeof proof === "string") {
    return proof.startsWith("0x") ? (proof as Hex) : (`0x${proof}` as Hex);
  }
  return toHex(proof);
}

/**
 * Builds the publicInputs array (bytes32[]) that the on-chain verifier
 * expects from a ProofResult.
 *
 * The order must match the order in which Noir exposes public inputs /
 * public outputs in the compiled circuit.  Adjust if your circuit layout
 * differs.
 */
function buildPublicInputs(proofResult: ProofResult): Hex[] {
  const { publicInputs, publicOutputs } = proofResult;

  return [
    // Public inputs (provided by the caller)
    toBytes32(BigInt(publicInputs.policyTreeRoot)),
    toBytes32(BigInt(publicInputs.policyId)),
    toBytes32(BigInt(publicInputs.coverageStart)),
    toBytes32(BigInt(publicInputs.coverageEnd)),
    toBytes32(BigInt(publicInputs.delayThreshold)),
    // Public outputs (emitted by the circuit)
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
}> {
  console.log("\n╔══════════════════════════════════════════╗");
  console.log("║  STEP 1: Off-Chain ZKP Generation        ║");
  console.log("╚══════════════════════════════════════════╝\n");

  // 1a. Build a Merkle tree and insert a policy commitment
  console.log("→ Building Merkle tree and inserting policy commitment...");
  const tree = createMerkleTree();

  const salt = generateRandomInt();
  const policyId = 1;

  // Derive passenger data
  const passengerNameHash = BigInt(
    "0x" +
      Buffer.from("Alice Johnson").toString("hex").padStart(64, "0").slice(0, 64)
  );
  const ticketNumberHash = BigInt(
    "0x" +
      Buffer.from("TK-20240315-001")
        .toString("hex")
        .padStart(64, "0")
        .slice(0, 64)
  );
  const flightNumberHash = BigInt(
    "0x" +
      Buffer.from("BA-0285").toString("hex").padStart(64, "0").slice(0, 64)
  );

  const passengerHash = generatePassengerHash(
    ticketNumberHash,
    flightNumberHash,
    passengerNameHash
  );

  const commitment = generatePolicyCommitment(policyId, passengerHash, salt);
  insertLeaf(tree, commitment);

  // Insert some dummy sibling commitments so the tree is not trivially small
  for (let i = 0; i < 3; i++) {
    insertLeaf(tree, generateRandomInt());
  }

  const policyTreeRoot = getMerkleRoot(tree);

  console.log(`   Policy ID          : ${policyId}`);
  console.log(`   Salt               : ${salt}`);
  console.log(`   Passenger Hash     : ${passengerHash}`);
  console.log(`   Policy Commitment  : 0x${commitment.toString(16).slice(0, 16)}...`);
  console.log(`   Merkle Root        : ${policyTreeRoot}\n`);

  // 1b. Prepare circuit inputs
  // Arrival times are Unix timestamps (seconds).
  // scheduledArrival: 1 Jan 2025 10:00 UTC
  // actualArrival  : 1 Jan 2025 11:30 UTC  (90-minute delay)
  const scheduledArrival = 1735725600; // 2025-01-01T10:00:00Z
  const actualArrival = 1735731000;    // 2025-01-01T11:30:00Z

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
    coverageStart: 1735700000, // coverage window starts before flight
    coverageEnd: 1735800000,   // coverage window ends after flight
    delayThreshold: 3600,      // 60-minute delay threshold (in seconds)
  };

  console.log("→ Circuit inputs:");
  console.log(`   Scheduled Arrival  : ${new Date(scheduledArrival * 1000).toISOString()}`);
  console.log(`   Actual Arrival     : ${new Date(actualArrival * 1000).toISOString()}`);
  console.log(
    `   Delay              : ${(actualArrival - scheduledArrival) / 60} minutes`
  );
  console.log(`   Delay Threshold    : ${publicInputs.delayThreshold / 60} minutes\n`);

  // 1c. Generate proof via NoirJS + bb.js
  console.log("→ Generating ZK proof (this may take 30–120 seconds)…\n");
  const proofResult = await generateProof(privateInputs, publicInputs, tree);

  const proofBytes =
    proofResult.proof.proof instanceof Uint8Array
      ? proofResult.proof.proof
      : proofResult.proof.proof;

  console.log("\n✓ ZK proof generated!");
  console.log(`   Nullifier Hash     : ${proofResult.publicOutputs.nullifierHash}`);
  console.log(`   Proof Size         : ~${(proofBytes as Uint8Array).length ?? "?"} bytes\n`);

  return { proofResult, tree };
}

// ─────────────────────────────────────────────
// Step 2 – On-Chain ZKP Verification
// ─────────────────────────────────────────────

async function verifyZKProofOnChain(
  proofResult: ProofResult,
  publicClient: ReturnType<typeof createPublicClient>
): Promise<boolean> {
  console.log("\n╔══════════════════════════════════════════╗");
  console.log("║  STEP 2: On-Chain ZKP Verification       ║");
  console.log("╚══════════════════════════════════════════╝\n");

  const proofHex = proofToHex(proofResult.proof.proof as Uint8Array);
  const publicInputsHex = buildPublicInputs(proofResult);

  console.log(`→ Calling HonkVerifier.verify() at ${HONK_VERIFIER_ADDRESS}…`);

  const isValidHonk = await publicClient.readContract({
    address: HONK_VERIFIER_ADDRESS,
    abi: HONK_VERIFIER_ABI,
    functionName: "verify",
    args: [proofHex, publicInputsHex],
  });

  console.log(`   HonkVerifier result          : ${isValidHonk ? "✓ VALID" : "✗ INVALID"}`);

  console.log(
    `\n→ Calling FlightDelayInsuranceVerifier.verifyProof() at ${FLIGHT_DELAY_INSURANCE_VERIFIER_ADDRESS}…`
  );

  const isValidDomain = await publicClient.readContract({
    address: FLIGHT_DELAY_INSURANCE_VERIFIER_ADDRESS,
    abi: FLIGHT_DELAY_INSURANCE_VERIFIER_ABI,
    functionName: "verifyProof",
    args: [proofHex, publicInputsHex],
  });

  console.log(
    `   FlightDelayInsuranceVerifier : ${isValidDomain ? "✓ VALID" : "✗ INVALID"}\n`
  );

  return isValidHonk && isValidDomain;
}

// ─────────────────────────────────────────────
// Step 3 – Submit Claim On-Chain
// ─────────────────────────────────────────────

async function submitClaimOnChain(
  proofResult: ProofResult,
  publicClient: ReturnType<typeof createPublicClient>,
  walletClient: ReturnType<typeof createWalletClient>
): Promise<void> {
  console.log("\n╔══════════════════════════════════════════╗");
  console.log("║  STEP 3: Submit Claim On-Chain           ║");
  console.log("╚══════════════════════════════════════════╝\n");

  const proofHex = proofToHex(proofResult.proof.proof as Uint8Array);
  const publicInputsHex = buildPublicInputs(proofResult);
  const nullifierHashBytes32 = toBytes32(
    BigInt(proofResult.publicOutputs.nullifierHash)
  );

  // Check if nullifier has already been used (double-spend protection)
  console.log("→ Checking nullifier status on-chain…");
  const alreadyUsed = await publicClient.readContract({
    address: FLIGHT_DELAY_INSURANCE_ADDRESS,
    abi: FLIGHT_DELAY_INSURANCE_ABI,
    functionName: "isNullifierUsed",
    args: [nullifierHashBytes32],
  });

  if (alreadyUsed) {
    console.log("⚠  Nullifier already used – claim has been submitted before. Skipping.\n");
    return;
  }
  console.log("   Nullifier is fresh – proceeding with submission.\n");

  // Submit the claim
  console.log(
    `→ Submitting claim to FlightDelayInsurance at ${FLIGHT_DELAY_INSURANCE_ADDRESS}…`
  );

  const txHash = await walletClient.writeContract({
    address: FLIGHT_DELAY_INSURANCE_ADDRESS,
    abi: FLIGHT_DELAY_INSURANCE_ABI,
    functionName: "submitClaim",
    args: [proofHex, publicInputsHex, nullifierHashBytes32],
  });

  console.log(`   Transaction submitted: ${txHash}`);
  console.log("   Waiting for confirmation…");

  const receipt = await publicClient.waitForTransactionReceipt({
    hash: txHash,
    confirmations: 1,
  });

  if (receipt.status === "success") {
    console.log(`\n✓ Claim submitted successfully!`);
    console.log(`   Block       : ${receipt.blockNumber}`);
    console.log(`   Gas Used    : ${receipt.gasUsed}`);
    console.log(
      `   Explorer    : https://sepolia.basescan.org/tx/${txHash}\n`
    );
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

  // Validate environment
  const missingEnv: string[] = [];
  if (!HONK_VERIFIER_ADDRESS) missingEnv.push("HONK_VERIFIER_ON_BASE_SEPOLIA");
  if (!FLIGHT_DELAY_INSURANCE_VERIFIER_ADDRESS)
    missingEnv.push("FLIGHT_DELAY_INSURANCE_Verifier_ON_BASE_SEPOLIA");
  if (!FLIGHT_DELAY_INSURANCE_ADDRESS)
    missingEnv.push("FLIGHT_DELAY_INSURANCE_ON_BASE_SEPOLIA");
  if (!process.env.USER_PRIVATE_KEY) missingEnv.push("USER_PRIVATE_KEY");

  if (missingEnv.length > 0) {
    console.error("\n✗ Missing required environment variables:");
    missingEnv.forEach((v) => console.error(`   - ${v}`));
    console.error(
      "\nPlease set these in your .env file or shell before running.\n"
    );
    process.exit(1);
  }

  const rpcUrl =
    process.env.BASE_SEPOLIA_RPC_URL ?? "https://sepolia.base.org";

  console.log(`\n   Network     : BASE Sepolia`);
  console.log(`   RPC URL     : ${rpcUrl}`);
  console.log(`   HonkVerifier: ${HONK_VERIFIER_ADDRESS}`);
  console.log(`   FDI Verifier: ${FLIGHT_DELAY_INSURANCE_VERIFIER_ADDRESS}`);
  console.log(`   FDI Contract: ${FLIGHT_DELAY_INSURANCE_ADDRESS}\n`);

  const { publicClient, walletClient } = buildClients(rpcUrl);

  // ── Step 1: Generate ZK proof off-chain ──
  const { proofResult } = await generateZKProofOffChain();

  // ── Step 2: Verify proof on-chain (read-only) ──
  const proofIsValid = await verifyZKProofOnChain(proofResult, publicClient);

  if (!proofIsValid) {
    console.error("✗ On-chain verification failed. Aborting claim submission.\n");
    process.exit(1);
  }

  // ── Step 3: Submit claim on-chain (write tx) ──
  await submitClaimOnChain(proofResult, publicClient, walletClient);

  console.log("╔══════════════════════════════════════════════════╗");
  console.log("║  E2E Test Completed Successfully ✓               ║");
  console.log("╚══════════════════════════════════════════════════╝\n");
}

main().catch((err) => {
  console.error("\n✗ E2E test failed:", err);
  process.exit(1);
});