
## Run the smart contract test

- Run the `PinionOsExample.sol`
```bash
# 1. Set your RPC
export BASE_RPC_URL=https://base-mainnet.g.alchemy.com/v2/<YOUR_KEY>

# 2. Run all tests
forge test --fork-url $BASE_RPC_URL --fork-block-number 28000000 -vvvv

# 3. Run a single test
forge test --fork-url $BASE_RPC_URL -vvvv --match-test test_unlimited_planCosts100USDC
```