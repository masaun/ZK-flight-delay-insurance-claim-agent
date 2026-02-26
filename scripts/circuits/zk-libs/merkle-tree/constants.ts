// export const TREE_DEPTH = 16;
// export const TREE_ZERO_VALUE = 0;
// export const TREE_ARITY = 2;

// @dev - The depth of the Merkle Tree for the commitments
export const MERKLE_TREE_DEPTH= 6;

// @dev - The length of the Merkle proof for the commitment merkle proof
// @dev - [Key Point]: In case of Binary Merkle Tree, the MERKLE_PROOF_LENGTH would always be equal to the MERKLE_TREE_DEPTH, since each level of the tree
export const MERKLE_PROOF_LENGTH = MERKLE_TREE_DEPTH;


export const MERKLE_TREE_ZERO_VALUE = 0;
export const MERKLE_TREE_ARITY = 2;