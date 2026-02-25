echo "Run the pinion-os-example.ts script to see how to use the Pinion OS SDK to interact with the Pinion OS smart contracts on the Sepolia testnet."
# Load environment variables from .env file in scripts directory
if [ -f "../../../.env" ]; then
  export $(cat ../../../.env | grep -v '#' | xargs)
fi
node pinion-os-example.ts