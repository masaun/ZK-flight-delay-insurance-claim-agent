import { Noir } from "@noir-lang/noir_js";
import { UltraHonkBackend, type ProofData } from "@aztec/bb.js";
import { IMT } from "@zk-kit/imt";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import {
  createMerkleProof,
  generatePolicyCommitment,
  generatePassengerHash,
  generateNullifier,
  generateNullifierHash,
  type MerkleProof,
} from "../zk-libs/merkle-tree/imt.ts";

// Load circuit artifact at runtime
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const circuitArtifactPath = join(
  __dirname,
  "../artifacts/flight-delay-insurance/flight-delay-insurance-0.0.1/flight-delay-insurance.json"
);
const circuitArtifact = JSON.parse(readFileSync(circuitArtifactPath, "utf-8"));

/**
 * Represents the private inputs for the flight delay insurance circuit
 */
export interface FlightDelayPrivateInputs {
  passengerNameHash: bigint;
  ticketNumberHash: bigint;
  flightNumberHash: bigint;
  salt: bigint;
  passengerHash: bigint;
  scheduledArrival: number;
  actualArrival: number;
}

/**
 * Represents the public inputs for the flight delay insurance circuit
 */
export interface FlightDelayPublicInputs {
  policyTreeRoot: string;
  policyId: number;
  coverageStart: number;
  coverageEnd: number;
  delayThreshold: number;
}

/**
 * Represents the witness data returned after circuit execution
 */
export interface CircuitWitness {
  witness: Uint8Array;
}

/**
 * Represents the complete proof data
 */
export interface ProofResult {
  proof: ProofData;
  publicInputs: FlightDelayPublicInputs;
  publicOutputs: {
    policyTreeRoot: string;
    nullifierHash: string;
  };
}

/**
 * Generates a random integer for use as a salt or secret
 * Note: In production, this should use a cryptographically secure random number generator
 * @returns A random integer
 */
export const generateRandomInt = (): bigint => {
  return BigInt(Math.floor(Math.random() * 1000000000));
};

/**
 * Generates a ZK proof for a flight delay insurance claim
 * @param privateInputs - The private inputs (passenger info, arrival times, etc.)
 * @param publicInputs - The public inputs (policy root, policy ID, coverage dates, delay threshold)
 * @param tree - The IMT (Incremental Merkle Tree) containing policy commitments
 * @returns A proof object containing the proof data and public outputs
 */
export const generateProof = async (
  privateInputs: FlightDelayPrivateInputs,
  publicInputs: FlightDelayPublicInputs,
  tree: IMT
): Promise<ProofResult> => {
  try {
    // Initialize the Noir circuit and backend
    const noir = new Noir(circuitArtifact as any);
    const backend = new UltraHonkBackend(
      (circuitArtifact as any).bytecode,
      (circuitArtifact as any).vk
    );

    // Generate the policy commitment
    const policyCommitment = generatePolicyCommitment(
      publicInputs.policyId,
      privateInputs.passengerHash,
      privateInputs.salt
    );

    // Find the leaf index in the tree
    const leafIndex = tree.indexOf(policyCommitment);
    if (leafIndex === -1) {
      throw new Error("Policy commitment not found in merkle tree");
    }

    // Create merkle proof for the policy commitment
    const merkleProof = createMerkleProof(tree, leafIndex);

    // Generate the nullifier and nullifier hash
    const nullifier = generateNullifier(policyCommitment, privateInputs.salt);
    const nullifierHash = generateNullifierHash(nullifier);

    // Prepare the witness (inputs to the circuit)
    const { witness } = await noir.execute({
      // Private inputs
      passenger_name_hash: privateInputs.passengerNameHash.toString(),
      ticket_number_hash: privateInputs.ticketNumberHash.toString(),
      flight_number_hash: privateInputs.flightNumberHash.toString(),
      salt: privateInputs.salt.toString(),
      passenger_hash: privateInputs.passengerHash.toString(),
      scheduled_arrival: privateInputs.scheduledArrival,
      actual_arrival: privateInputs.actualArrival,
      
      // Public inputs
      policy_tree_root: publicInputs.policyTreeRoot,
      policy_id: publicInputs.policyId,
      coverage_start: publicInputs.coverageStart,
      coverage_end: publicInputs.coverageEnd,
      delay_threshold: publicInputs.delayThreshold,
      
      // Merkle proof
      merkle_proof_length: merkleProof.siblings.length,
      merkle_proof_indices: merkleProof.pathIndices,
      merkle_proof_siblings: merkleProof.siblings,
      merkle_root: publicInputs.policyTreeRoot,
    });

    // Generate the proof using the backend
    const proof = await backend.generateProof(witness);

    // Return the proof along with public outputs
    return {
      proof,
      publicInputs,
      publicOutputs: {
        policyTreeRoot: publicInputs.policyTreeRoot,
        nullifierHash: nullifierHash.toString(),
      },
    };
  } catch (error) {
    throw new Error(`Failed to generate proof: ${error}`);
  }
};

/**
 * Verifies a ZK proof
 * @param proof - The proof data to verify
 * @returns True if the proof is valid, false otherwise
 */
export const verifyProof = async (proof: ProofData): Promise<boolean> => {
  try {
    const backend = new UltraHonkBackend(
      (circuitArtifact as any).bytecode,
      (circuitArtifact as any).vk
    );
    return await backend.verifyProof(proof);
  } catch (error) {
    console.error(`Failed to verify proof: ${error}`);
    return false;
  }
};

/**
 * Serializes a proof to JSON format for storage or transmission
 * @param proofResult - The proof result to serialize
 * @returns A JSON string representation of the proof
 */
export const serializeProof = (proofResult: ProofResult): string => {
  return JSON.stringify({
    proof: {
      proof: proofResult.proof.proof,
      publicInputs: proofResult.proof.publicInputs,
    },
    publicInputs: proofResult.publicInputs,
    publicOutputs: proofResult.publicOutputs,
  });
};

/**
 * Deserializes a proof from JSON format
 * @param proofJson - The JSON string representation of the proof
 * @returns The deserialized ProofResult
 */
export const deserializeProof = (proofJson: string): ProofResult => {
  return JSON.parse(proofJson);
};
