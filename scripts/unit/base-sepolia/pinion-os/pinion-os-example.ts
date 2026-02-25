import "dotenv/config";
import { PinionClient } from "pinion-os";
import { Wallet } from "ethers";

async function main() {
  const pinion = new PinionClient({
    privateKey: process.env.PINION_PRIVATE_KEY,
  });

  // Get the wallet address from the private key
  const wallet = new Wallet(process.env.PINION_PRIVATE_KEY!);
  const userAddress = wallet.address;
  console.log("User Wallet Address:", userAddress);

  // Try to generate a new wallet (may require payment)
  try {
    const w = await pinion.skills.wallet();
    if (w.data?.address) {
      console.log("Generated Wallet:", w.data);  // { address, privateKey }
    } else {
      console.log("Wallet generation requires payment (x402). Using user wallet address instead.");
    }
  } catch (error) {
    console.log("Wallet generation error. Using user wallet address instead.", error);
  }

  // check balances using the user's wallet address
  const bal = await pinion.skills.balance(userAddress);
  console.log("Balance:", bal.data);  // { eth: "1.5", usdc: "100.0" }

  // get token price
  const price = await pinion.skills.price("ETH");
  console.log("ETH Price:", price.data);  // { token: "ETH", usd: "2650.00" }

  // look up a transaction (requires valid tx hash)
  // const tx = await pinion.skills.tx("0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890");
  // console.log("Transaction:", tx.data);  // { from, to, value, ... }

  // chat with the agent
  const chat = await pinion.skills.chat("what is x402?");
  console.log("Chat Response:", chat.data);  // { response: "..." }

  // construct a send transaction (sign + broadcast yourself)
  // Note: Replace 0xRecipient with an actual Ethereum address
  // const send = await pinion.skills.send("0x742d35Cc6634C0532925a3b844Bc9e7595f5bEb", "0.1", "ETH");
  // console.log("Send Transaction:", send.data);  // { tx: { to, value, data, chainId }, ... }

  // swap tokens via 1inch (returns unsigned tx)
  const trade = await pinion.skills.trade("USDC", "ETH", "10");
  console.log("Swap Trade:", trade.data);  // { swap: { to, data, value }, approve?: {...} }

  // check funding status for a wallet (using the user's wallet address)
  const fund = await pinion.skills.fund(userAddress);
  console.log("Funding Status:", fund.data);  // { balances, funding: { steps, ... } }

  // sign and broadcast a transaction
  // const txResult = await pinion.skills.broadcast(send.data.tx);
  // console.log("Broadcast Result:", txResult.data);  // { hash: "0x..." }

  // purchase unlimited access ($100 USDC one-time)
  const unlimited = await pinion.skills.unlimited();
  console.log("Unlimited Plan Info:", unlimited.data);  // { apiKey: "pk_...", address, plan: "unlimited" }

  // once you have an API key, set it to skip x402 payments
  if (unlimited.data.apiKey) {
    pinion.setApiKey(unlimited.data.apiKey);
    console.log("API Key set for unlimited access. All subsequent calls are free!");
  }
}

main().catch(console.error);