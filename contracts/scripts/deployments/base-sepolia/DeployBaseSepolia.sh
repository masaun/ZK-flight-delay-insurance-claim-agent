#!/bin/bash

# BASE Sepolia Deployment Script for ZK Flight Delay Insurance Contracts
# This script handles deployment and verification via BaseScan

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
CONTRACTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../" && pwd)"
ENV_FILE="${CONTRACTS_DIR}/.env"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
UPDATE_ENV_SCRIPT="${SCRIPT_DIR}/update-env.js"

# Network Configuration
BASE_SEPOLIA_RPC_URL="https://sepolia.base.org"
BASE_SEPOLIA_CHAIN_ID=84532

# Contract Names and Paths
HONK_VERIFIER_CONTRACT="HonkVerifier"
FLIGHT_DELAY_INSURANCE_VERIFIER="FlightDelayInsuranceVerifier"
FLIGHT_DELAY_INSURANCE="FlightDelayInsurance"

# Solidity Compiler Version (matching the version used in foundry.toml)
# All contracts are compiled with the same Solc version
COMPILER_VERSION="0.8.30"

# Function to print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

# Function to validate deployment on-chain
validate_deployment() {
    local CONTRACT_ADDR=$1
    local CONTRACT_NAME=$2
    
    print_status "Validating $CONTRACT_NAME deployment at $CONTRACT_ADDR..."
    
    # Check if address has contract code on BASE Sepolia
    local CODE=$(cast code "$CONTRACT_ADDR" --rpc-url "$BASE_SEPOLIA_RPC_URL" 2>/dev/null || echo "")
    
    if [ -z "$CODE" ] || [ "$CODE" = "0x" ]; then
        print_error "❌ $CONTRACT_NAME NOT deployed at $CONTRACT_ADDR (no contract code found)"
        return 1
    else
        # Show bytecode length as confirmation
        local CODE_LENGTH=$((${#CODE} / 2))
        print_success "✓ $CONTRACT_NAME deployed successfully (${CODE_LENGTH} bytes of code)"
        return 0
    fi
}

# Function to load environment variables
#
# The script sources the contracts/.env file and exports any variables it defines
# so they are available to the deployment commands.  If you run the forge command
# yourself, make sure to `source contracts/.env` or export the key manually (see
# the README for examples) – otherwise the shell will complain that ``--private-\
# key`` has no value.
load_env() {
    if [ ! -f "$ENV_FILE" ]; then
        print_error ".env file not found at $ENV_FILE"
        exit 1
    fi
    
    print_status "Loading environment variables from .env..."
    # export everything in .env so that subprocesses (forge, node, etc.) see them
    set -a
    source "$ENV_FILE" || {
        print_error "Failed to source .env file"
        exit 1
    }
    set +a
    
    if [ -z "$DEPLOYER_PRIVATE_KEY" ]; then
        print_error "DEPLOYER_PRIVATE_KEY not set in .env"
        exit 1
    fi
    
    if [ -z "$BASESCAN_API_KEY" ]; then
        print_warning "BASESCAN_API_KEY not set - contract verification will be skipped"
    fi
    
    print_success "Environment variables loaded"
}

# Function to check and install dependencies
check_dependencies() {
    print_status "Checking Foundry dependencies..."
    cd "$CONTRACTS_DIR" || {
        print_error "Failed to change to contracts directory"
        exit 1
    }
    
    # Check if forge-std is installed
    if [ ! -d "lib/forge-std" ]; then
        print_warning "forge-std not found, installing..."
        if forge install foundry-rs/forge-std; then
            print_success "forge-std installed successfully"
        else
            print_error "Failed to install forge-std"
            exit 1
        fi
    else
        print_success "forge-std already installed"
    fi
}

# Function to verify Foundry installation
check_foundry() {
    if ! command -v forge &> /dev/null; then
        print_error "Foundry (forge) is not installed"
        exit 1
    fi
    print_success "Foundry found: $(forge --version)"
}

# Function to verify Node.js installation
check_node() {
    if ! command -v node &> /dev/null; then
        print_error "Node.js is not installed"
        exit 1
    fi
    print_success "Node.js found: $(node --version)"
}

# Function to build contracts
build_contracts() {
    print_status "Building contracts..."
    cd "$CONTRACTS_DIR" || {
        print_error "Failed to change to contracts directory"
        exit 1
    }
    
    if forge build; then
        print_success "Contracts built successfully"
        return 0
    else
        print_error "Contract build failed"
        exit 1
    fi
}

# Function to get timeout command (cross-platform)
get_timeout_cmd() {
    if command -v timeout &> /dev/null; then
        echo "timeout"
    elif command -v gtimeout &> /dev/null; then
        echo "gtimeout"
    else
        echo ""
    fi
}

# Function to deploy contracts
deploy_contracts() {
    print_status "Deploying contracts to BASE Sepolia..."
    cd "$CONTRACTS_DIR"
    
    # Create a temporary file for output
    local DEPLOY_LOG=$(mktemp)
    
    # Get timeout command (cross-platform)
    local TIMEOUT_CMD=$(get_timeout_cmd)
    
    # Build the deployment command
    local DEPLOY_CMD="forge script scripts/deployments/base-sepolia/DeployBaseSepolia.s.sol:DeployBaseSepolia \
        --rpc-url $BASE_SEPOLIA_RPC_URL \
        --private-key $DEPLOYER_PRIVATE_KEY \
        --broadcast \
        -vvv"
    
    # Run with timeout if available
    print_status "Running deployment (this may take a few minutes)..."
    if [ ! -z "$TIMEOUT_CMD" ]; then
        print_status "Using $TIMEOUT_CMD for safety (10 minute limit)..."
        $TIMEOUT_CMD 600 bash -c "$DEPLOY_CMD" > "$DEPLOY_LOG" 2>&1
    else
        print_status "Timeout command not available, running deployment without timeout..."
        bash -c "$DEPLOY_CMD" > "$DEPLOY_LOG" 2>&1
    fi
    
    local DEPLOY_EXIT_CODE=$?
    
    # Print the deployment output
    echo ""
    print_status "=== Deployment Output ==="
    cat "$DEPLOY_LOG"
    echo ""
    print_status "=== End Output ==="
    echo ""
    
    # Check if deployment timed out
    if [ $DEPLOY_EXIT_CODE -eq 124 ]; then
        print_error "Deployment timed out after 10 minutes"
        rm -f "$DEPLOY_LOG"
        return 1
    fi
    
    if [ $DEPLOY_EXIT_CODE -ne 0 ]; then
        print_warning "Deployment command returned exit code $DEPLOY_EXIT_CODE"
        # Don't exit here - try to extract addresses from partial output
    fi
    
    # Try multiple methods to extract addresses from the output
    print_status "Extracting contract addresses..."
    
    # Method 1: Look for console.log output patterns and transaction hashes
    HONK_VERIFIER_ADDR=$(grep -oE "0x[a-fA-F0-9]{40}" "$DEPLOY_LOG" | head -1)
    VERIFIER_ADDR=$(grep -oE "0x[a-fA-F0-9]{40}" "$DEPLOY_LOG" | head -2 | tail -1)
    INSURANCE_ADDR=$(grep -oE "0x[a-fA-F0-9]{40}" "$DEPLOY_LOG" | head -3 | tail -1)
    
    # Look for transaction hashes (which indicate successful deployment)
    TX_COUNT=$(grep -c "Transaction" "$DEPLOY_LOG" || echo "0")
    if [ "$TX_COUNT" -gt 0 ]; then
        print_success "Found transaction records - deployment appears successful"
    else
        print_warning "No transaction records found - deployment may have failed"
    fi
    
    # Method 2: If not found, look in broadcast directory
    if [ -z "$HONK_VERIFIER_ADDR" ]; then
        print_status "Searching in broadcast directory for deployment receipts..."
        
        local BROADCAST_DIR="$CONTRACTS_DIR/broadcast/DeployBaseSepolia.s.sol/84532"
        if [ -d "$BROADCAST_DIR" ]; then
            local LATEST_RUN=$(ls -t "$BROADCAST_DIR" | head -1)
            if [ ! -z "$LATEST_RUN" ]; then
                local RECEIPT_FILE="$BROADCAST_DIR/$LATEST_RUN/run-latest.json"
                if [ -f "$RECEIPT_FILE" ]; then
                    print_status "Found deployment receipt at: $RECEIPT_FILE"
                    # Extract addresses using jq if available
                    if command -v jq &> /dev/null; then
                        HONK_VERIFIER_ADDR=$(jq -r '.transactions[0].contractAddress // empty' "$RECEIPT_FILE" 2>/dev/null)
                        VERIFIER_ADDR=$(jq -r '.transactions[1].contractAddress // empty' "$RECEIPT_FILE" 2>/dev/null)
                        INSURANCE_ADDR=$(jq -r '.transactions[2].contractAddress // empty' "$RECEIPT_FILE" 2>/dev/null)
                    fi
                fi
            fi
        fi
    fi
    
    # Validate extracted addresses
    if [ -z "$HONK_VERIFIER_ADDR" ] || [ -z "$VERIFIER_ADDR" ] || [ -z "$INSURANCE_ADDR" ]; then
        print_warning "Could not automatically extract all contract addresses"
        print_status "Deployment log saved to: $DEPLOY_LOG"
        echo ""
        echo "Please verify deployment is complete and enter the contract addresses:"
        echo ""
        
        read -p "Enter HonkVerifier address: " HONK_VERIFIER_ADDR
        read -p "Enter FlightDelayInsuranceVerifier address: " VERIFIER_ADDR
        read -p "Enter FlightDelayInsurance address: " INSURANCE_ADDR
        
        # Validate addresses entered by user (POSIX compliant)
        if ! echo "$HONK_VERIFIER_ADDR" | grep -qE '^0x[a-fA-F0-9]{40}$'; then
            print_error "Invalid HonkVerifier address format"
            rm -f "$DEPLOY_LOG"
            exit 1
        fi
        if ! echo "$VERIFIER_ADDR" | grep -qE '^0x[a-fA-F0-9]{40}$'; then
            print_error "Invalid FlightDelayInsuranceVerifier address format"
            rm -f "$DEPLOY_LOG"
            exit 1
        fi
        if ! echo "$INSURANCE_ADDR" | grep -qE '^0x[a-fA-F0-9]{40}$'; then
            print_error "Invalid FlightDelayInsurance address format"
            rm -f "$DEPLOY_LOG"
            exit 1
        fi
    else
        print_success "Deployment completed successfully"
    fi
    
    print_status "Extracted contract addresses:"
    echo "  HonkVerifier: $HONK_VERIFIER_ADDR"
    echo "  FlightDelayInsuranceVerifier: $VERIFIER_ADDR"
    echo "  FlightDelayInsurance: $INSURANCE_ADDR"
    
    # Validate on-chain deployment
    echo ""
    print_status "Verifying contracts are deployed on-chain..."
    
    VALIDATION_SUCCESS=true
    validate_deployment "$HONK_VERIFIER_ADDR" "HonkVerifier" || VALIDATION_SUCCESS=false
    validate_deployment "$VERIFIER_ADDR" "FlightDelayInsuranceVerifier" || VALIDATION_SUCCESS=false
    validate_deployment "$INSURANCE_ADDR" "FlightDelayInsurance" || VALIDATION_SUCCESS=false
    
    if [ "$VALIDATION_SUCCESS" = false ]; then
        print_error "One or more contracts failed on-chain validation"
        echo ""
        print_warning "The deployment script completed but contract code was not found on BASE Sepolia"
        echo "Possible causes:"
        echo "  1. Insufficient ETH balance for gas fees on deployer account"
        echo "  2. Network connectivity issues or RPC endpoint problems"
        echo "  3. Transaction failed silently (check BaseScan for failed transactions)"
        echo "  4. Constructor errors that reverted the transaction"
        echo ""
        print_status "Review addresses on https://sepolia.basescan.org/"
        echo ""
    fi
    
    rm -f "$DEPLOY_LOG"
}

# Function to update .env file
update_env_file() {
    print_status "Updating .env file with deployed contract addresses..."
    
    if [ ! -f "$UPDATE_ENV_SCRIPT" ]; then
        print_warning "update-env.js not found, updating .env manually..."
        
        # Update using sed
        cd "$CONTRACTS_DIR" || {
            print_error "Failed to change directory"
            return 1
        }
        
        # Use sed to update or add the environment variables
        if grep -q "HONK_VERIFIER_ON_BASE_SEPOLIA" .env; then
            sed -i.bak "s/HONK_VERIFIER_ON_BASE_SEPOLIA=.*/HONK_VERIFIER_ON_BASE_SEPOLIA=\"$HONK_VERIFIER_ADDR\"/" .env
        else
            echo "HONK_VERIFIER_ON_BASE_SEPOLIA=\"$HONK_VERIFIER_ADDR\"" >> .env
        fi
        
        if grep -q "FLIGHT_DELAY_INSURANCE_VERIFIER_ON_BASE_SEPOLIA" .env; then
            sed -i.bak "s/FLIGHT_DELAY_INSURANCE_VERIFIER_ON_BASE_SEPOLIA=.*/FLIGHT_DELAY_INSURANCE_VERIFIER_ON_BASE_SEPOLIA=\"$VERIFIER_ADDR\"/" .env
        else
            echo "FLIGHT_DELAY_INSURANCE_VERIFIER_ON_BASE_SEPOLIA=\"$VERIFIER_ADDR\"" >> .env
        fi
        
        if grep -q "FLIGHT_DELAY_INSURANCE_ON_BASE_SEPOLIA" .env; then
            sed -i.bak "s/FLIGHT_DELAY_INSURANCE_ON_BASE_SEPOLIA=.*/FLIGHT_DELAY_INSURANCE_ON_BASE_SEPOLIA=\"$INSURANCE_ADDR\"/" .env
        else
            echo "FLIGHT_DELAY_INSURANCE_ON_BASE_SEPOLIA=\"$INSURANCE_ADDR\"" >> .env
        fi
        
        print_success ".env file updated successfully"
        return 0
    fi
    
    cd "$SCRIPT_DIR" || {
        print_error "Failed to change to script directory"
        return 1
    }
    
    if node update-env.js "$HONK_VERIFIER_ADDR" "$VERIFIER_ADDR" "$INSURANCE_ADDR"; then
        print_success ".env file updated successfully"
        return 0
    else
        print_error "Failed to update .env file with Node.js script"
        return 1
    fi
}

# Function to verify contracts on BaseScan
verify_contracts() {
    if [ -z "$BASESCAN_API_KEY" ]; then
        print_warning "BASESCAN_API_KEY not set - skipping contract verification"
        return 0
    fi
    
    if [ "$SKIP_VERIFICATION" = true ]; then
        print_warning "Skipping contract verification as requested"
        return 0
    fi
    
    print_status "Verifying contracts on BaseScan..."
    cd "$CONTRACTS_DIR" || {
        print_error "Failed to change to contracts directory"
        return 1
    }
    
    # Verify HonkVerifier
    print_status "Verifying HonkVerifier..."
    forge verify-contract \
        --chain-id "$BASE_SEPOLIA_CHAIN_ID" \
        --compiler-version "v${COMPILER_VERSION}" \
        "$HONK_VERIFIER_ADDR" \
        src/circuits/honk-verifier/HonkVerifier.sol:HonkVerifier \
        --etherscan-api-key "$BASESCAN_API_KEY" 2>&1 || print_warning "HonkVerifier verification encountered an issue"
    
    # Verify FlightDelayInsuranceVerifier
    print_status "Verifying FlightDelayInsuranceVerifier..."
    VERIFIER_CONSTRUCTOR=$(cast abi-encode "constructor(address)" "$HONK_VERIFIER_ADDR" 2>&1) || {
        print_warning "Failed to encode FlightDelayInsuranceVerifier constructor args"
        VERIFIER_CONSTRUCTOR=""
    }
    
    if [ ! -z "$VERIFIER_CONSTRUCTOR" ]; then
        forge verify-contract \
            --chain-id "$BASE_SEPOLIA_CHAIN_ID" \
            --compiler-version "v${COMPILER_VERSION}" \
            "$VERIFIER_ADDR" \
            src/circuits/FlightDelayInsuranceVerifier.sol:FlightDelayInsuranceVerifier \
            --constructor-args "$VERIFIER_CONSTRUCTOR" \
            --etherscan-api-key "$BASESCAN_API_KEY" 2>&1 || print_warning "FlightDelayInsuranceVerifier verification encountered an issue"
    else
        forge verify-contract \
            --chain-id "$BASE_SEPOLIA_CHAIN_ID" \
            --compiler-version "v${COMPILER_VERSION}" \
            "$VERIFIER_ADDR" \
            src/circuits/FlightDelayInsuranceVerifier.sol:FlightDelayInsuranceVerifier \
            --etherscan-api-key "$BASESCAN_API_KEY" 2>&1 || print_warning "FlightDelayInsuranceVerifier verification encountered an issue"
    fi
    
    # Verify FlightDelayInsurance
    print_status "Verifying FlightDelayInsurance..."
    INSURANCE_CONSTRUCTOR=$(cast abi-encode "constructor(address)" "$VERIFIER_ADDR" 2>&1) || {
        print_warning "Failed to encode FlightDelayInsurance constructor args"
        INSURANCE_CONSTRUCTOR=""
    }
    
    if [ ! -z "$INSURANCE_CONSTRUCTOR" ]; then
        forge verify-contract \
            --chain-id "$BASE_SEPOLIA_CHAIN_ID" \
            --compiler-version "v${COMPILER_VERSION}" \
            "$INSURANCE_ADDR" \
            src/FlightDelayInsurance.sol:FlightDelayInsurance \
            --constructor-args "$INSURANCE_CONSTRUCTOR" \
            --etherscan-api-key "$BASESCAN_API_KEY" 2>&1 || print_warning "FlightDelayInsurance verification encountered an issue"
    else
        forge verify-contract \
            --chain-id "$BASE_SEPOLIA_CHAIN_ID" \
            --compiler-version "v${COMPILER_VERSION}" \
            "$INSURANCE_ADDR" \
            src/FlightDelayInsurance.sol:FlightDelayInsurance \
            --etherscan-api-key "$BASESCAN_API_KEY" 2>&1 || print_warning "FlightDelayInsurance verification encountered an issue"
    fi
    
    print_success "Contract verification completed"
    return 0
}

# Function to print deployment summary
print_summary() {
    echo ""
    echo -e "${BLUE}========================================${NC}"
    echo -e "${BLUE}   DEPLOYMENT SUMMARY - BASE SEPOLIA${NC}"
    echo -e "${BLUE}========================================${NC}"
    echo "Network: BASE Sepolia (Chain ID: $BASE_SEPOLIA_CHAIN_ID)"
    echo "RPC URL: $BASE_SEPOLIA_RPC_URL"
    echo ""
    echo -e "${GREEN}Deployed Contracts:${NC}"
    echo "  1. HonkVerifier"
    echo "     Address: $HONK_VERIFIER_ADDR"
    echo "     Explorer: https://sepolia.basescan.org/address/$HONK_VERIFIER_ADDR"
    echo ""
    echo "  2. FlightDelayInsuranceVerifier"
    echo "     Address: $VERIFIER_ADDR"
    echo "     Explorer: https://sepolia.basescan.org/address/$VERIFIER_ADDR"
    echo ""
    echo "  3. FlightDelayInsurance"
    echo "     Address: $INSURANCE_ADDR"
    echo "     Explorer: https://sepolia.basescan.org/address/$INSURANCE_ADDR"
    echo ""
    echo -e "${BLUE}========================================${NC}"
    echo "Update your .env file with these addresses:"
    echo "HONK_VERIFIER_ON_BASE_SEPOLIA=$HONK_VERIFIER_ADDR"
    echo "FLIGHT_DELAY_INSURANCE_VERIFIER_ON_BASE_SEPOLIA=$VERIFIER_ADDR"
    echo "FLIGHT_DELAY_INSURANCE_ON_BASE_SEPOLIA=$INSURANCE_ADDR"
    echo -e "${BLUE}========================================${NC}"
    echo ""
}

# Main execution
main() {
    echo -e "${BLUE}"
    echo "╔════════════════════════════════════════════════════════════╗"
    echo "║     ZK Flight Delay Insurance - BASE Sepolia Deployment     ║"
    echo "╚════════════════════════════════════════════════════════════╝"
    echo -e "${NC}"
    
    # Check prerequisites
    print_status "Checking prerequisites..."
    check_foundry || exit 1
    check_node || exit 1
    
    # Check and install dependencies
    check_dependencies || exit 1
    
    # Load environment
    load_env || exit 1
    
    # Build contracts
    build_contracts || exit 1
    
    # Deploy contracts
    deploy_contracts || exit 1
    
    # Update .env file
    update_env_file || {
        print_warning "Failed to update .env file automatically, but deployment may have succeeded"
    }
    
    # Verify contracts
    verify_contracts || {
        print_warning "Contract verification encountered issues, but deployment was completed"
    }
    
    # Print summary
    print_summary
    
    print_success "Deployment workflow completed successfully!"
}

# Display usage information
usage() {
    echo "Usage: $0 [OPTIONS]"
    echo ""
    echo "OPTIONS:"
    echo "  -h, --help              Show this help message"
    echo "  --skip-verification    Skip contract verification on BaseScan"
    echo "  --dry-run              Run deployment in dry-run mode (no broadcast)"
    echo ""
    echo "Examples:"
    echo "  $0                      # Full deployment with verification"
    echo "  $0 --skip-verification  # Deploy and skip verification"
    echo ""
}

# Parse command line arguments
SKIP_VERIFICATION=false
DRY_RUN=false

# If the user runs this script directly and wants to deploy manually they can
# source the .env themselves, e.g.:
#    set -a && source "$CONTRACTS_DIR/.env" && set +a
# This script will call load_env() below which already exports variables.

while [ $# -gt 0 ]; do
    case $1 in
        -h|--help)
            usage
            exit 0
            ;;
        --skip-verification)
            SKIP_VERIFICATION=true
            print_status "Verification will be skipped"
            shift
            ;;
        --dry-run)
            DRY_RUN=true
            print_warning "Dry-run mode is not fully implemented yet"
            shift
            ;;
        *)
            print_error "Unknown option: $1"
            usage
            exit 1
            ;;
    esac
done

# Run main function
main