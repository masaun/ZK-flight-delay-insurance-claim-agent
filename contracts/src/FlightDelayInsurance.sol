// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IVerifier {
    function verify(
        bytes calldata proof,
        uint256[] calldata publicInputs
    ) external view returns (bool);
}

contract FlightDelayInsurance {

    IVerifier public verifier;

    struct Policy {
        address holder;
        uint256 payoutAmount;
        uint256 coverageStart;
        uint256 coverageEnd;
        bool claimed;
    }

    mapping(uint256 => Policy) public policies;

    // @dev - Store a given Policy Tree Root for each policyId, which will be used to verify the ZK proof for insurance claims. The policyTreeRoot is a hash that represents the specific insurance policy the user purchased, and it will be used in the ZK circuit to verify that the claim corresponds to the correct policy without revealing sensitive information about the policy on-chain.
    mapping(uint256 policyId => bytes32[]) public policyTreeRoots;

    constructor(address _verifier) {
        verifier = IVerifier(_verifier);
    }

    function buyPolicy(
        bytes32 policyTreeRoot,
        uint256 policyId,
        uint256 coverageStart,
        uint256 coverageEnd
    ) external payable {
        // TODO: Store a given Policy Tree Root        
        policyTreeRoots[policyId] = policyTreeRoot;

        require(policies[policyId].holder == address(0));
        require(msg.value > 0);

        policies[policyId] = Policy({
            holder: msg.sender,
            payoutAmount: msg.value * 3, // example multiplier
            coverageStart: coverageStart,
            coverageEnd: coverageEnd,
            claimed: false
        });
    }

    function claim(
        uint256 policyId,
        bytes calldata proof,
        uint256[] calldata publicInputs
    ) external {

        Policy storage p = policies[policyId];

        require(!p.claimed, "Already claimed");
        require(p.holder == msg.sender, "Not holder");

        require(
            verifier.verify(proof, publicInputs),
            "Invalid proof"
        );

        p.claimed = true;
        payable(msg.sender).transfer(p.payoutAmount);
    }

    receive() external payable {}
}