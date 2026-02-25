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

    function verify(
        bytes calldata proof, 
        uint256[] calldata publicInputs
    ) public view returns (bool) {
        // Convert uint256[] to bytes32[]
        bytes32[] memory inputs = new bytes32[](publicInputs.length);
        for (uint256 i = 0; i < publicInputs.length; i++) {
            inputs[i] = bytes32(publicInputs[i]);
        }
        return verifier.verify(proof, inputs);
    }
}