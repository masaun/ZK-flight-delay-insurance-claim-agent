/**
 * @notice - The PublicOutputs struct, which store the public outputs for the ZK circuit
 */
pub struct PublicOutputs {
    pub policy_tree_root: Field,
    pub nullifier_hash: Field
}