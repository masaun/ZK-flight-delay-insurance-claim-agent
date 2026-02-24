use binary_merkle_root::binary_merkle_root;

use crate::{
    libs::{
        merkle_tree::{
            constants::{MERKLE_TREE_DEPTH, MERKLE_PROOF_LENGTH}
        },
        hash::poseidon::poseidon_hash::{
            poseidon_hash_1, poseidon_hash_2, poseidon_hash_4
        }
    }
};
//use std::hash::poseidon;

/**
    * @notice - Computes the Binary Merkle Root for a given leaf and a Merkle proof
    * @param commitment - The leaf value (trap value in our case)
    * @returns The computed Merkle root
    */
pub fn compute_merkle_root(
    leaf: Field, // @dev - A trap "commitment" should be stored into here as a "Leaf", which is for the trap at the move coordinates (0 or 1)
    merkle_proof_length: u32,
    merkle_proof_indices: [u1; MERKLE_TREE_DEPTH],
    merkle_proof_siblings: [Field; MERKLE_TREE_DEPTH],
) -> Field {
    let merkle_root = binary_merkle_root(
        poseidon_hash_2, // @dev - For a "Binary" Merkle Tree, each leaf node is a hash of 2 children, so we use the 2-input Poseidon hash function.
        leaf,                    // @dev - A trap "commitment" should be stored into here as a "Leaf", which is for the trap at the move coordinates (0 or 1)
        merkle_proof_length,
        merkle_proof_indices,
        merkle_proof_siblings
    );
    merkle_root
}