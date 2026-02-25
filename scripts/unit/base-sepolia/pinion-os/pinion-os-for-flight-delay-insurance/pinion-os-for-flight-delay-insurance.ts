import { Pinion } from "pinion-os";
import { ethers } from "ethers";
import { verifyProof } from "./verifier";

const pinion = new Pinion({
  skillName: "flight-delay-claim",
  price: "0.02" // USDC processing fee
});

pinion.handle(async (req) => {

  const {
    proof,
    publicInputs,
    policyId
  } = req.body;

  const valid = await verifyProof(proof, publicInputs);

  if (!valid) {
    return { error: "Invalid proof" };
  }

  await submitOnChainClaim(policyId, proof, publicInputs);

  return { status: "Payout triggered" };
});

pinion.start();