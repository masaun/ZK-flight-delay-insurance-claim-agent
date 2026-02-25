//mod tests;
mod libs;
mod types;
mod utils;

// @dev - Import each test module
//use tests::{test_main};

// @dev - Import the types
use types::{
    public_inputs::{PublicInputs},
    public_outputs::{PublicOutputs}
};

// @dev - Import the Merkle Tree library
use libs::{
    merkle_tree::{
        binary_merkle_root_computation::compute_merkle_root,
        constants::{MERKLE_TREE_DEPTH, MERKLE_PROOF_LENGTH}
    },
    hash::poseidon::poseidon_hash::{
        poseidon_hash_1, poseidon_hash_2, poseidon_hash_3 , poseidon_hash_4
    }
};

// @dev - import the constants (scaled by 100)
use utils::constants::{
    // MAX_DE_RATIO,  // 2.5 - MAX Debt-to-Equity Ratio: debt/equity
    // MIN_ICR,       // 1.5 - MIN Interest Coverage Ratio: EBITDA/interest
    // MIN_DSCR,      // 1.2 - MIN Debt Service Coverage Ratio: cashflow/lease_payment
    // MIN_CURRENT,   // 1.0 - MIN Current Ratio: current_assets/current_liabilities
};

// @dev - The PrivateInputs struct, which store the private inputs for the ZK circuit
pub struct PrivateInputs {
    // TODO
}

/** 
 * @title - Flight Delay Insurance circuit
 */
fn main(
    // ---------- Private Inputs ----------
    passenger_name_hash: Field,
    ticket_number_hash: Field,
    flight_number_hash: Field,
    salt: Field,

    passenger_hash: Field,

    scheduled_arrival: u32,
    actual_arrival: u32,

    // ---------- Public Inputs ----------
    policy_tree_root: Field,
    policy_id: u32,  // @dev - This policy_id, which passengers bought, should come from the "policies" mapping storage of the FlightDelayInsurance contract, which maps to the specific insurance policy the user purchased 
    coverage_start: u32,
    coverage_end: u32,
    delay_threshold: u32
) -> pub PublicOutputs {
    // Prevent negative delay
    assert(actual_arrival >= scheduled_arrival);

    // Compute delay
    let delay = actual_arrival - scheduled_arrival;

    // Must exceed threshold
    assert(delay >= delay_threshold);

    // Must be inside coverage window
    assert(scheduled_arrival >= coverage_start);
    assert(scheduled_arrival <= coverage_end);

    // Prevent zero values
    assert(passenger_hash != 0);
    assert(flight_number_hash != 0);

    // @dev - Check the merkle inclusion of the policy_id, the passenger and flight number in the allowed lists (if needed, depending on your use case)
    let passenger_hash = poseidon_hash_3([
        ticket_number_hash,
        flight_number_hash,
        passenger_name_hash
    ]);

    // 5-1. Compute a policy commitment, which will be used as a leaf in the merkle tree of the financial statement.
    let policy_commitment = poseidon_hash_3([
        policy_id as Field, 
        passenger_hash, 
        salt
    ]);

    // 5-2. Compute the expected policy root (in the merkle root of the policy list) using the policy commitment and the Merkle proof. This will be used to verify that the policy commitment is included in the committed policy root.
    let expected_policy_tree_root = compute_merkle_root(
        policy_commitment, // @dev - The leaf node for the financial statement Merkle tree is the hash of the financial statement data, which is stored in the "financial_statement_root" variable.
        MERKLE_PROOF_LENGTH,
        [0; MERKLE_TREE_DEPTH], // @dev - For simplicity, we can use dummy values for the Merkle proof indices and siblings since we are only interested in verifying the root against the committed root. In a real implementation, these would be provided as part of the proof.
        [0; MERKLE_TREE_DEPTH]
    );

    // 5-3. Bind to committed policy root to ensure the policy commitment is included in the committed policy root
    assert(policy_tree_root == expected_policy_tree_root, "Policy root does not match the committed root");

    // 6. Compute the nullifier hash to prevent double factoring
    let nullifier = poseidon_hash_2([policy_commitment, salt]);
    let nullifier_hash = poseidon_hash_1([nullifier]);

    // 7. Return the public outputs
    let public_outputs = PublicOutputs {
        policy_tree_root,
        nullifier_hash
    };
    public_outputs
}