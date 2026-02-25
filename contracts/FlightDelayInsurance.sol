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

    constructor(address _verifier) {
        verifier = IVerifier(_verifier);
    }

    function buyPolicy(
        uint256 policyId,
        uint256 coverageStart,
        uint256 coverageEnd
    ) external payable {

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