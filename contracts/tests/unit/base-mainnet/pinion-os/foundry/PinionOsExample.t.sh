echo "Read the .env file..."
source ../../../../../.env

echo "Running tests in the PinionOsExample.t.sol on Base mainnet using Base mainnet-forking method of Foundry)..."
cd ../../../../.. && forge test --fork-url $BASE_RPC_URL --fork-block-number 28000000 -vvvv 