echo "Read the .env file..."
source ../../../../.env

echo "Running tests in the PinionOsExample.t.sol with Base mainnet-forking method..."
cd ../../../.. && forge test --fork-url $BASE_RPC_URL --fork-block-number 28000000 -vvvv 