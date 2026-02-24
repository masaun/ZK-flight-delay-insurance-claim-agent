// @dev - The depth of the Merkle Tree for the commitments
pub global MERKLE_TREE_DEPTH: u32 = 6;

// @dev - The length of the Merkle proof for the commitment merkle proof
// @dev - [Key Point]: In case of Binary Merkle Tree, the MERKLE_PROOF_LENGTH would always be equal to the MERKLE_TREE_DEPTH, since each level of the tree
pub global MERKLE_PROOF_LENGTH: u32 = MERKLE_TREE_DEPTH;