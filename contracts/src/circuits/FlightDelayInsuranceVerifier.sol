// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { HonkVerifier } from "./honk-verifier/HonkVerifier.sol";

contract FlightDelayInsuranceVerifier {
    HonkVerifier public verifier;

    constructor(address _verifier) {
        verifier = HonkVerifier(_verifier);
    }

    function verifyFlightDelayInsuranceProof(
        bytes calldata proof, 
        bytes32[] calldata publicInputs
    ) external view returns (bool) {
        bool isValidProof = verifier.verify(proof, publicInputs);
        require(isValidProof, "Invalid ZK FlightDelayInsurance Proof");
        return isValidProof;
    }
}