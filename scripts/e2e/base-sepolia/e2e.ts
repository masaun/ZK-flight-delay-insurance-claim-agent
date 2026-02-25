import { PinionClient } from "pinion-os";
import { generateProof } from "./noir";

async function main() {

  const proof = await generateProof({
    scheduled_arrival: 1700000000,
    actual_arrival: 1700009000,
    passenger_hash: 999999,
    flight_number_hash: 888888,
    delay_threshold: 120,
    coverage_start: 1699990000,
    coverage_end: 1700010000,
    policy_id: 1
  });

  const client = new PinionClient({
    skill: "flight-delay-claim"
  });

  const result = await client.invoke({
    proof,
    publicInputs: [
      120,
      1699990000,
      1700010000,
      1
    ],
    policyId: 1
  });

  console.log(result);
}

main();