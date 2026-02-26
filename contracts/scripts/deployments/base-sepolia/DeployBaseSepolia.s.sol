// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";
import {HonkVerifier} from "../../../src/circuits/honk-verifier/HonkVerifier.sol";
import {FlightDelayInsuranceVerifier} from "../../../src/circuits/FlightDelayInsuranceVerifier.sol";
import {FlightDelayInsurance} from "../../../src/FlightDelayInsurance.sol";

contract DeployBaseSepolia is Script {
    HonkVerifier public honkVerifier;
    FlightDelayInsuranceVerifier public flightDelayInsuranceVerifier;
    FlightDelayInsurance public flightDelayInsurance;

    function run() external {
        // Get private key from environment
        uint256 deployerPrivateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");

        // Start broadcast to send transactions
        vm.startBroadcast(deployerPrivateKey);

        // Step 1: Deploy HonkVerifier
        console.log("Deploying HonkVerifier...");
        honkVerifier = new HonkVerifier();
        console.log("HonkVerifier deployed to:", address(honkVerifier));

        // Step 2: Deploy FlightDelayInsuranceVerifier with HonkVerifier address
        console.log("\nDeploying FlightDelayInsuranceVerifier...");
        flightDelayInsuranceVerifier = new FlightDelayInsuranceVerifier(address(honkVerifier));
        console.log("FlightDelayInsuranceVerifier deployed to:", address(flightDelayInsuranceVerifier));

        // Step 3: Deploy FlightDelayInsurance with FlightDelayInsuranceVerifier address
        console.log("\nDeploying FlightDelayInsurance...");
        flightDelayInsurance = new FlightDelayInsurance(address(flightDelayInsuranceVerifier));
        console.log("FlightDelayInsurance deployed to:", address(flightDelayInsurance));

        vm.stopBroadcast();

        // Output summary
        console.log("\n=================== DEPLOYMENT SUMMARY ===================");
        console.log("Network: BASE Sepolia");
        console.log("Deployer:", vm.addr(deployerPrivateKey));
        console.log("==========================================");
        console.log("HONK_VERIFIER_ON_BASE_SEPOLIA=", address(honkVerifier));
        console.log("FLIGHT_DELAY_INSURANCE_VERIFIER_ON_BASE_SEPOLIA=", address(flightDelayInsuranceVerifier));
        console.log("FLIGHT_DELAY_INSURANCE_ON_BASE_SEPOLIA=", address(flightDelayInsurance));
        console.log("==========================================");
    }
}
