# ZK flight delay insurance claim agent - Smart Contract


## Run the smart contract test with `Foundry` and `Hardhat` (using `Base mainnet-forking` method)

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


- 2/ Run the `PinionOsExample.sol` with **`Foundry`** (using `Base mainnet-forking` method)
```bash
cd contracts/tests/unit/base-mainnet/pinion-os/foundry

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

- 2/ Run the `PinionOsExample.sol` with **`Hardhat 3`** (using `Base mainnet-forking` method)
```bash
cd contracts/tests/unit/base-mainnet/pinion-os/hardhat-3

sh PinionOsExample.t.sh
```

<br>

## Smart contract deployment

<br>

## References

- ZK circuit in `Noir` (powered by `Aztec`)
  - [Noir Documentation](https://noir-lang.org/)
  - [Barretenberg Documentation](https://aztecprotocol.github.io/barretenberg/)
  - `noir-examples/solidity-example`
    - `js/generate-proof.ts` (How to use the `verifierTarget: "evm"`): https://github.com/noir-lang/noir-examples/blob/master/solidity-example/js/generate-proof.ts#L16

  - Recursive Proof:
    - Doc：https://barretenberg.aztec.network/docs/explainers/recursive_aggregation/
    - `noir-examples/recursion`：https://github.com/noir-lang/noir-examples/tree/master/recursion

<br>

- Pinion OS:
  - https://pinionos.com/
  - https://github.com/chu2bard/pinion-os

