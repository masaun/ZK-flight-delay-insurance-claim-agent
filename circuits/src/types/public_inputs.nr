/**
 * @notice - The PublicInputs struct, which store the public inputs for the ZK circuit
 */
pub struct PublicInputs {
    pub policy_tree_root: Field,
    pub policy_id: u32,  // @dev - This policy_id, which passengers bought, should come from the "policies" mapping storage of the FlightDelayInsurance contract, which maps to the specific insurance policy the user purchased 
    pub coverage_start: u32,
    pub coverage_end: u32,
    pub delay_threshold: u32
}