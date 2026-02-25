# BASE Sepolia Deployment Guide

This directory contains the deployment scripts for deploying the ZK Flight Delay Insurance contracts to BASE Sepolia testnet.

## Contracts to Deploy

1. **HonkVerifier** - Honk proof verification library contract
2. **FlightDelayInsuranceVerifier** - Flight delay insurance proof verifier wrapper
3. **FlightDelayInsurance** - Main flight delay insurance contract

## Prerequisites

- Foundry installed (`forge` command available)
- Node.js installed (for environment file updates)
- Private key for deployment account in `.env` file
- Sufficient ETH balance on BASE Sepolia testnet for gas fees
- `.env` file configured with:
  - `DEPLOYER_PRIVATE_KEY` - Private key of the deployer account
  - `BASE_SEPOLIA_RPC_URL` - RPC URL for BASE Sepolia (default: https://sepolia.base.org)
  - `BASESCAN_API_KEY` - (Optional) For contract verification

**Note:** The deployment script will automatically install the `forge-std` dependency if it's missing.

## Environment Setup

Ensure your `.env` file in the `contracts/` directory contains:

```env
DEPLOYER_PRIVATE_KEY="0x..."
BASE_SEPOLIA_RPC_URL=https://sepolia.base.org
BASESCAN_API_KEY="..."
HONK_VERIFIER_ON_BASE_SEPOLIA=""
FLIGHT_DELAY_INSURANCE_VERIFIER_ON_BASE_SEPOLIA=""
FLIGHT_DELAY_INSURANCE_ON_BASE_SEPOLIA=""
```

## Deployment Instructions

### Option 1: Automated Deployment (Recommended)

Use the provided bash script for a fully automated deployment workflow:

```bash
cd scripts/deployments/base-sepolia
bash DeployBaseSepolia.sh
```

The script will automatically:
1. Check and install Foundry dependencies (forge-std)
2. Build all contracts
3. Deploy all 3 contracts to BASE Sepolia
4. Automatically update the `.env` file with deployed addresses
5. Verify contracts on BaseScan (if `BASESCAN_API_KEY` is set)

**Important:** Always use `bash` to run the script, not `sh`:
```bash
# ✅ Correct
bash DeployBaseSepolia.sh

# ❌ Incorrect
sh DeployBaseSepolia.sh
```

**Script Options:**
```bash
bash DeployBaseSepolia.sh                    # Full deployment with verification
bash DeployBaseSepolia.sh --skip-verification # Deploy and skip verification
bash DeployBaseSepolia.sh --help              # Show help message
```

### Option 2: Manual Deployment with Foundry

Step 1: Build the Contracts

```bash
cd contracts
forge build
```

Step 2: Run the Deployment Script

```bash
forge script DeployBaseSepolia --rpc-url $BASE_SEPOLIA_RPC_URL --broadcast --verify
```

Or with private key directly:

```bash
forge script scripts/deployments/base-sepolia/DeployBaseSepolia.s.sol:DeployBaseSepolia \
  --rpc-url https://sepolia.base.org \
  --private-key $DEPLOYER_PRIVATE_KEY \
  --broadcast
```

Step 3: Update .env File with Contract Addresses

After successful deployment, update the `.env` file with the deployed contract addresses:

```bash
cd scripts/deployments/base-sepolia
node update-env.js <HONK_VERIFIER_ADDRESS> <VERIFIER_ADDRESS> <INSURANCE_ADDRESS>
```

Example:
```bash
node update-env.js 0x1234567890123456789012345678901234567890 0xabcdefabcdefabcdefabcdefabcdefabcdefabcd 0xfedcbafedcbafedcbafedcbafedcbafedcbafedcba
```

## Deployment Output

The script will output deployment logs including:
- Contract deployment addresses
- Deployer address
- Transaction hashes
- Gas usage
- Explorer links for each contract on Basescan

## Automatic Verification

The deployment script automatically verifies contracts on Basescan (if `BASESCAN_API_KEY` is set) using the correct compiler version (0.8.30).

To verify manually after deployment:

```bash
forge verify-contract --chain-id 84532 \
  --compiler-version v0.8.30 \
  <CONTRACT_ADDRESS> \
  src/circuits/honk-verifier/HonkVerifier.sol:HonkVerifier \
  --etherscan-api-key $BASESCAN_API_KEY
```

**Note:** All contracts are compiled with Solc 0.8.30. The deployment script handles verification automatically with the correct version.

## RPC URLs

- **BASE Sepolia**: https://sepolia.base.org
- **BASE Mainnet**: https://mainnet.base.org

## Troubleshooting

### Script Execution Issues

#### Error: "command not found"
- **Cause:** Running with `sh` instead of `bash`
- **Solution:** Use `bash DeployBaseSepolia.sh` (NOT `sh DeployBaseSepolia.sh`)

#### Error: "timeout: command not found"
- **Cause:** Cross-platform timeout command not available
- **Solution:** Automatically handled by script - it will install or run without timeout on macOS

### Dependency Issues

#### Error: "forge-std not found"
- **Cause:** Missing Foundry standard library
- **Solution:** Script automatically installs it. If manual install needed: `forge install foundry-rs/forge-std`

#### Error: "Unable to resolve imports"
- **Cause:** Dependencies not installed
- **Solution:** Run `forge install` to install all dependencies

### Deployment Issues

#### Error: "Insufficient funds for gas"
- Ensure you have enough ETH in your deployer account on BASE Sepolia
- Get testnet ETH from a [faucet](https://www.coinbase.com/faucets/base-ethereum-sepolia-faucet)

#### Error: "Invalid private key"
- Check that `DEPLOYER_PRIVATE_KEY` in `.env` is correctly formatted (with or without 0x prefix)
- Ensure the key is in quotes in the `.env` file

#### Error: "Contract already exists"
- Each deployment creates new contract instances at different addresses
- If deploying to the same account, check the `.env` file was updated with latest addresses

### Verification Issues

#### Error: "No matching artifact found" during verification
- **Cause:** Compiler version mismatch
- **Solution:** Script uses correct version (0.8.30). If manual verification: use `--compiler-version v0.8.30`

#### Error: "Failed to update .env file"
- Node.js script fallback to manual sed updates will be used
- Verify `.env` file was updated with deployed addresses
- If not updated, manually add addresses to `.env`

## Files in This Directory

- **DeployBaseSepolia.sh** - Main automated deployment script (RECOMMENDED)
- **DeployBaseSepolia.s.sol** - Foundry Solidity deployment script
- **update-env.js** - Node.js helper script to update .env file with deployed addresses
- **README.md** - This file

## Deployment Workflow Summary

When you run `bash DeployBaseSepolia.sh`, the script automatically:

1. **Validates Environment**
   - Checks Foundry installation
   - Checks Node.js installation
   - Loads `.env` file
   - Validates required environment variables

2. **Prepares Dependencies**
   - Installs or updates `forge-std` if needed

3. **Builds Contracts**
   - Compiles all contracts with Solc 0.8.30
   - Verifies no compilation errors

4. **Deploys Contracts**
   - Deploys `HonkVerifier` to BASE Sepolia
   - Deploys `FlightDelayInsuranceVerifier` with `HonkVerifier` address
   - Deploys `FlightDelayInsurance` with `FlightDelayInsuranceVerifier` address
   - Extracts deployed contract addresses

5. **Updates Configuration**
   - Automatically updates `.env` file with deployed addresses
   - Provides fallback manual entry if automation fails

6. **Verifies Contracts** (if `BASESCAN_API_KEY` is set)
   - Verifies `HonkVerifier` on Basescan
   - Verifies `FlightDelayInsuranceVerifier` with constructor arguments
   - Verifies `FlightDelayInsurance` with constructor arguments
   - Uses correct compiler version (0.8.30)

7. **Displays Summary**
   - Shows all deployed contract addresses
   - Provides explorer links for each contract

## Key Features of the Automated Script

✅ **Cross-Platform Compatible**
- Works on macOS, Linux, and other Unix-like systems
- Handles platform-specific command availability

✅ **Robust Error Handling**
- Gracefully handles deployment timeouts
- Provides multiple address extraction methods
- Supports manual address entry if auto-extraction fails

✅ **Automatic Dependency Management**
- Installs missing `forge-std` library
- Validates all prerequisites before deployment

✅ **Complete Workflow**
- Builds, deploys, updates config, and verifies in one command
- Colored output for easy monitoring
- Detailed logging for debugging

✅ **Flexible Options**
- Full deployment with verification (default)
- Skip verification if needed
- Help menu for quick reference

## Network Information

### BASE Sepolia Testnet
- **Chain ID:** 84532
- **RPC URL:** https://sepolia.base.org
- **Block Explorer:** https://sepolia.basescan.org
- **Faucet:** https://www.coinbase.com/faucets/base-ethereum-sepolia-faucet

### BASE Mainnet
- **Chain ID:** 8453
- **RPC URL:** https://mainnet.base.org
- **Block Explorer:** https://basescan.org

## Additional Resources

- [Foundry Book - Scripting](https://book.getfoundry.sh/tutorials/solidity-scripting)
- [Foundry Book - Verification](https://book.getfoundry.sh/reference/verify/etherscan)
- [BASE Documentation](https://docs.base.org)
- [Basescan Explorer](https://sepolia.basescan.org)
- [Solidity Documentation](https://docs.soliditylang.org/)
