mod tests;
mod libs;
mod types;
mod utils;

/** 
 * @title - Flight Delay Insurance circuit
 */
fn main(
    // ---------- Private Inputs ----------
    scheduled_arrival: Field,
    actual_arrival: Field,
    passenger_hash: Field,
    flight_number_hash: Field,

    // ---------- Public Inputs ----------
    delay_threshold: Field,
    coverage_start: Field,
    coverage_end: Field,
    policy_id: Field
) {
    // Prevent negative delay
    assert(actual_arrival >= scheduled_arrival);

    // Compute delay
    let delay = actual_arrival - scheduled_arrival;

    // Must exceed threshold
    assert(delay >= delay_threshold);

    // Must be inside coverage window
    assert(scheduled_arrival >= coverage_start);
    assert(scheduled_arrival <= coverage_end);

    // Bind proof to policy
    constrain(policy_id);

    // Prevent zero values
    assert(passenger_hash != 0);
    assert(flight_number_hash != 0);
}