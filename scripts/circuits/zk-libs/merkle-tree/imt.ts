import { IMT } from "@zk-kit/imt";
import { poseidon1, poseidon2, poseidon3 } from "poseidon-lite";
import {
  MERKLE_TREE_DEPTH,
  MERKLE_PROOF_LENGTH,
  MERKLE_TREE_ZERO_VALUE,
  MERKLE_TREE_ARITY,
} from "./constants.ts";

/**
 * Represents a node in the merkle tree
 */
export interface MerkleNode {
  commitment: string;
  nullifierHash: string;
}

/**
 * Represents a merkle proof
 */
export interface MerkleProof {
  siblings: string[];
  pathIndices: number[];
  leafIndex: number;
}

/**
 * Creates and initializes an Incremental Merkle Tree (IMT) with the given leaves
 * @param leaves - Array of commitment values to add to the tree
 * @returns The initialized IMT instance
 */
export const createMerkleTree = (leaves?: bigint[]): IMT => {
  return new IMT(
    poseidon2,
    MERKLE_TREE_DEPTH,
    MERKLE_TREE_ZERO_VALUE,
    MERKLE_TREE_ARITY,
    leaves || []
  );
};

/**
 * Inserts a new leaf (commitment) into the merkle tree
 * @param tree - The IMT instance
 * @param commitment - The commitment value to insert
 */
export const insertLeaf = (tree: IMT, commitment: bigint): void => {
  tree.insert(commitment);
};

/**
 * Inserts multiple leaves into the merkle tree
 * @param tree - The IMT instance
 * @param commitments - Array of commitment values to insert
 */
export const insertLeaves = (tree: IMT, commitments: bigint[]): void => {
  commitments.forEach((commitment) => {
    tree.insert(commitment);
  });
};

/**
 * Gets the root of the merkle tree
 * @param tree - The IMT instance
 * @returns The root of the tree as a string
 */
export const getMerkleRoot = (tree: IMT): string => {
  return tree.root.toString();
};

/**
 * Gets the index of a leaf (commitment) in the tree
 * @param tree - The IMT instance
 * @param commitment - The commitment value to search for
 * @returns The index of the leaf, or -1 if not found
 */
export const getLeafIndex = (tree: IMT, commitment: bigint): number => {
  return tree.indexOf(commitment);
};

/**
 * Creates a merkle proof for a given leaf index
 * @param tree - The IMT instance
 * @param leafIndex - The index of the leaf to create a proof for
 * @returns The merkle proof with siblings and path indices
 */
export const createMerkleProof = (tree: IMT, leafIndex: number): MerkleProof => {
  const proof = tree.createProof(leafIndex);
  
  return {
    siblings: proof.siblings.map((sibling) => sibling.toString()),
    pathIndices: proof.pathIndices,
    leafIndex: leafIndex,
  };
};

/**
 * Verifies a merkle proof for a given commitment
 * @param tree - The IMT instance
 * @param leaf - The leaf commitment to verify
 * @param leafIndex - The index of the leaf
 * @returns True if the proof is valid, false otherwise
 */
export const verifyMerkleProof = (
  tree: IMT,
  leaf: bigint,
  leafIndex: number
): boolean => {
  const proof = tree.createProof(leafIndex);
  return tree.verifyProof(proof);
};

/**
 * Generates a policy commitment hash from policy data
 * @param policyId - The policy ID
 * @param passengerHash - The hashed passenger identity
 * @param salt - A random salt value
 * @returns The policy commitment as a BigInt
 */
export const generatePolicyCommitment = (
  policyId: number,
  passengerHash: bigint,
  salt: bigint
): bigint => {
  const commitment = poseidon3([policyId, passengerHash, salt]);
  return commitment;
};

/**
 * Generates a passenger hash from passenger identity information
 * @param ticketNumberHash - Hash of the ticket number
 * @param flightNumberHash - Hash of the flight number
 * @param passengerNameHash - Hash of the passenger name
 * @returns The passenger hash as a BigInt
 */
export const generatePassengerHash = (
  ticketNumberHash: bigint,
  flightNumberHash: bigint,
  passengerNameHash: bigint
): bigint => {
  return poseidon3([ticketNumberHash, flightNumberHash, passengerNameHash]);
};

/**
 * Generates a nullifier from policy commitment
 * @param policyCommitment - The policy commitment
 * @param salt - The salt value
 * @returns The nullifier as a BigInt
 */
export const generateNullifier = (
  policyCommitment: bigint,
  salt: bigint
): bigint => {
  return poseidon2([policyCommitment, salt]);
};

/**
 * Generates a nullifier hash from nullifier
 * @param nullifier - The nullifier value
 * @returns The nullifier hash as a BigInt
 */
export const generateNullifierHash = (nullifier: bigint): bigint => {
  return poseidon1([nullifier]);
};

/**
 * Gets the size (number of leaves) of the merkle tree
 * @param tree - The IMT instance
 * @returns The number of leaves in the tree
 */
export const getTreeSize = (tree: IMT): number => {
  return tree.leaves.length;
};

/**
 * Gets all leaves from the merkle tree
 * @param tree - The IMT instance
 * @returns Array of all leaves in the tree
 */
export const getTreeLeaves = (tree: IMT): bigint[] => {
  return tree.leaves.map((leaf) => {
    return typeof leaf === 'bigint' ? leaf : BigInt(leaf.toString());
  });
};
