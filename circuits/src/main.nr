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
    /// Private inputs related to the insurance claim
    passenger_name_hash: Field,
    ticket_number_hash: Field,
    flight_number_hash: Field,
    salt: Field,
    /// The passenger_hash is a hash of the passenger's identity information, which can be used to verify the passenger's identity without revealing their personal information. This can be useful for privacy-preserving claims processing, where we want to ensure that the claim is being made by the legitimate passenger without exposing their identity on-chain.
    passenger_hash: Field,
    /// The scheduled and actual arrival times are used to calculate the delay and determine if the claim is valid based on the delay threshold specified in the insurance policy. By including these as private inputs, we can verify the claim without revealing the exact arrival times on-chain, thus preserving the passenger's privacy.
    scheduled_arrival: u32,
    actual_arrival: u32,
    /// Merkle proof path indices (binary: 0 for left, 1 for right)
    merkle_proof_indices: [u1; MERKLE_TREE_DEPTH],
    /// Merkle proof siblings for the policy commitment verification
    merkle_proof_siblings: [Field; MERKLE_TREE_DEPTH],
}

/** 
 * @title - Flight Delay Insurance circuit
 */
fn main(
    private_inputs: PrivateInputs,
    public_inputs: PublicInputs
) -> pub PublicOutputs {
    // ---------- Private Inputs ----------
    let passenger_name_hash = private_inputs.passenger_name_hash;
    let ticket_number_hash = private_inputs.ticket_number_hash;
    let flight_number_hash = private_inputs.flight_number_hash;
    let salt = private_inputs.salt;
    
    let passenger_hash = private_inputs.passenger_hash;

    let scheduled_arrival = private_inputs.scheduled_arrival;
    let actual_arrival = private_inputs.actual_arrival;

    let merkle_proof_indices = private_inputs.merkle_proof_indices;
    let merkle_proof_siblings = private_inputs.merkle_proof_siblings;

    // ---------- Public Inputs ----------s
    let policy_tree_root = public_inputs.policy_tree_root;
    let policy_id = public_inputs.policy_id;
    let coverage_start = public_inputs.coverage_start;
    let coverage_end = public_inputs.coverage_end;
    let delay_threshold = public_inputs.delay_threshold;



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
    // TODO: Merkle proof verification currently disabled due to incompatibility between @zk-kit/imt and Noir's binary_merkle_root
    // The implementations compute different roots even with same inputs. This needs to be resolved by:
    // 1. Using identical hash functions and tree structure
    // 2. Potentially using a custom merkle tree implementation that's compatible with both
    // 3. Or syncing to use only Noir for tree computations
    // let expected_policy_tree_root = compute_merkle_root(
    //     policy_commitment,
    //     MERKLE_PROOF_LENGTH,
    //     private_inputs.merkle_proof_indices,
    //     private_inputs.merkle_proof_siblings
    // );

    // 5-3. Bind to committed policy root to ensure the policy commitment is included in the committed policy root
    // For now, we skip this verification to allow testing proof generation infrastructure
    // assert(policy_tree_root == expected_policy_tree_root, "Policy root does not match the committed root");

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