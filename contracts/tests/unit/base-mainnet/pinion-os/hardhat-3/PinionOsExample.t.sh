echo "Read the .env file..."
source ../../../../../.env

echo "Running tests in the PinionOsExample.t.sol on Base mainnet using Base mainnet-forking method of Hardhat 3)..."
cd ../../../../.. && npx hardhat test tests/unit/base-mainnet/pinion-os/hardhat-3/PinionOsExample.t.ts --network baseFork