import "dotenv/config";
import { PinionClient } from "pinion-os";

async function main() {
  const pinion = new PinionClient({
    privateKey: process.env.PINION_PRIVATE_KEY,
  });

  // check balances
  const bal = await pinion.skills.balance("0x1234...");
  console.log(bal.data);  // { eth: "1.5", usdc: "100.0" }

  // get token price
  const price = await pinion.skills.price("ETH");
  console.log(price.data);  // { token: "ETH", usd: "2650.00" }

  // look up a transaction
  const tx = await pinion.skills.tx("0xabc...");
  console.log(tx.data);  // { from, to, value, ... }

  // generate a wallet
  const w = await pinion.skills.wallet();
  console.log(w.data);  // { address, privateKey }

  // chat with the agent
  const chat = await pinion.skills.chat("what is x402?");
  console.log(chat.data);  // { response: "..." }

  // construct a send transaction (sign + broadcast yourself)
  const send = await pinion.skills.send("0xRecipient...", "0.1", "ETH");
  console.log(send.data);  // { tx: { to, value, data, chainId }, ... }

  // swap tokens via 1inch (returns unsigned tx)
  const trade = await pinion.skills.trade("USDC", "ETH", "10");
  console.log(trade.data);  // { swap: { to, data, value }, approve?: {...} }

  // check funding status for a wallet
  const fund = await pinion.skills.fund("0x1234...");
  console.log(fund.data);  // { balances, funding: { steps, ... } }

  // sign and broadcast a transaction
  const txResult = await pinion.skills.broadcast(send.data.tx);
  console.log(txResult.data);  // { hash: "0x..." }

  // purchase unlimited access ($100 USDC one-time)
  const unlimited = await pinion.skills.unlimited();
  console.log(unlimited.data);  // { apiKey: "pk_...", address, plan: "unlimited" }

  // once you have an API key, set it to skip x402 payments
  pinion.setApiKey(unlimited.data.apiKey);
  // all subsequent calls are free
}

main().catch(console.error);