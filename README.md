# ZK flight delay insurance claim agent

## Overview

- ZK flight delay insurance claim agent built on **`Noir` ZK circuit** and `Pinion OS`, which an AI agent buy a insurance policy for a flight delay insurance and claim it (when a flight delay happen) **on behalf of** a user.


- This project is still **IN PROGRESS**.

<br>

## Tech Stack

- **ZK Circuit**: 
   - zkDSL: `Noir` (`v1.0.0-beta.18`)
   - ZK Circuit Library: `@aztec/bb.js` (`v3.0.0-devnet.6-patch.1`) & `@noir-lang/noir_js` (`v1.0.0-beta.18`)
   - Incremental Merkle Tree (`IMT`) Library: `@zk-kit/imt` (`v2.0.0-beta.8`) 

- **Smart Contract**: 
   - Language: `Solidity`
   - Framework: `Foundry`

- **Blockchain**: 
   - e2e script: Base Sepolia
   - Smart contract test: Base mainnet-forking test using [Foundry's `mainnet-forking` method](https://www.getfoundry.sh/guides/fork-testing).

- AI Agent framework:
   - [Pinion OS](https://pinionos.com/): 
      > Client SDK, Claude plugin and skill framework for the Pinion protocol. x402 micropayments on Base.

<br>

## Run the script for the `ZK Proof generation` using `Noir`

- Run the `zkp-generation.ts` in order to generate a `ZK Flight Delay Insurance Proof`:
```bash
cd scripts/unit/zkp-generation

sh zkp-generation.sh
```

<br>

## Run the `e2e` script on `Base Sepolia`

```bash
cd scripts/e2e/base-sepolia

sh e2e.sh
```

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

