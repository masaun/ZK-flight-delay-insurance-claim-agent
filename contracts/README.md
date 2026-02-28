# ZK flight delay insurance claim agent - Smart Contract


## Run the smart contract test with Foundry (using `Base mainnet-forking` method)

- 1/ Set the `RPC URL` of Base mainnet in the `.env` file
```bash
BASE_RPC_URL=https://mainnet.base.org
```

Or,
- Set the `RPC URL` of Base mainnet in console
```bash
# 1. Set your RPC 
export BASE_RPC_URL=https://mainnet.base.org
```


- 2/ Run the `PinionOsExample.sol`
```bash
cd contracts/tests/unit/base-mainnet/pinion-os

sh PinionOsExample.t.sh
```

Or
```bash
# 0. Move the contracts directory
cd contracts

# 1. Run all tests using BASE mainnet RPC URL, which is read from .env file
source .env && forge test --fork-url $BASE_RPC_URL --fork-block-number 28000000 -vvvv

Or,

# 2.Run a single test using BASE mainnet RPC URL, which is manually set
forge test --fork-url https://mainnet.base.org --fork-block-number 28000000 -vvvv
```

<br>

## Smart contract deployment