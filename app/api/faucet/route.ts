import { createPublicClient, createWalletClient, defineChain, formatEther, http, isAddress, parseEther, verifyMessage } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { getDatabase } from "@/lib/database";

export const runtime = "nodejs";

const MAX_MESSAGE_AGE_MS = 5 * 60 * 1000;
const MESSAGE_PATTERN = /^Eggoria ARC Testnet Faucet\nAddress: (0x[0-9a-fA-F]{40})\nTimestamp: (\d{13})$/;

function getConfig() {
  const privateKeyValue = process.env.ARC_FAUCET_PRIVATE_KEY || "";
  const privateKey = (privateKeyValue.startsWith("0x") ? privateKeyValue : `0x${privateKeyValue}`) as `0x${string}`;
  const faucetAddress = process.env.ARC_FAUCET_ADDRESS || "";
  const rpcUrl = process.env.ARC_RPC_URL || "";
  const chainId = Number(process.env.ARC_CHAIN_ID);
  const amount = Number(process.env.FAUCET_AMOUNT_USDC || "1");
  const cooldownHours = Number(process.env.FAUCET_COOLDOWN_HOURS || "24");

  if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey) || !isAddress(faucetAddress) || !rpcUrl || !Number.isInteger(chainId) || chainId <= 0 || !Number.isFinite(amount) || amount <= 0 || !Number.isFinite(cooldownHours) || cooldownHours < 0) {
    throw new Error("Faucet configuration is invalid.");
  }

  const account = privateKeyToAccount(privateKey);
  if (account.address.toLowerCase() !== faucetAddress.toLowerCase()) {
    throw new Error("Faucet address does not match its private key.");
  }

  return { account, rpcUrl, chainId, amount, cooldownHours };
}

export async function GET(request: Request) {
  const address = new URL(request.url).searchParams.get("address") || "";
  if (!isAddress(address)) {
    return Response.json({ message: "Invalid wallet address." }, { status: 400 });
  }

  try {
    const cooldownHours = Number(process.env.FAUCET_COOLDOWN_HOURS || "24");
    if (!Number.isFinite(cooldownHours) || cooldownHours < 0) throw new Error("Invalid faucet cooldown.");
    const sql = await getDatabase();
    const [claim] = await sql`
      SELECT last_claimed_at FROM eggoria_faucet_claims
      WHERE wallet_address = ${address.toLowerCase()} LIMIT 1
    `;
    const retryTime = claim ? new Date(claim.last_claimed_at).getTime() + cooldownHours * 60 * 60 * 1000 : 0;
    return Response.json({ retryAt: retryTime > Date.now() ? new Date(retryTime).toISOString() : null }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    // The claims table is created on the first successful faucet request.
    if (error && typeof error === "object" && "code" in error && error.code === "42P01") {
      return Response.json({ retryAt: null }, { headers: { "Cache-Control": "no-store" } });
    }
    console.error("ARC faucet status failed:", error instanceof Error ? error.message : "Unknown faucet error");
    return Response.json({ message: "Faucet status is temporarily unavailable." }, { status: 503 });
  }
}

export async function POST(request: Request) {
  let body: { address?: unknown; message?: unknown; signature?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ message: "Invalid request body." }, { status: 400 });
  }

  const address = String(body.address || "");
  const message = String(body.message || "");
  const signature = String(body.signature || "") as `0x${string}`;
  const match = MESSAGE_PATTERN.exec(message);
  const timestamp = Number(match?.[2]);

  if (!isAddress(address) || !match || match[1].toLowerCase() !== address.toLowerCase() || !/^0x[0-9a-fA-F]+$/.test(signature) || !Number.isFinite(timestamp) || Math.abs(Date.now() - timestamp) > MAX_MESSAGE_AGE_MS) {
    return Response.json({ message: "The wallet confirmation is invalid or expired." }, { status: 400 });
  }

  if (!await verifyMessage({ address, message, signature })) {
    return Response.json({ message: "Wallet signature could not be verified." }, { status: 401 });
  }

  let reservationTime: Date | undefined;
  try {
    const { account, rpcUrl, chainId, amount, cooldownHours } = getConfig();
    const sql = await getDatabase();
    await sql`
      CREATE TABLE IF NOT EXISTS eggoria_faucet_claims (
        wallet_address TEXT PRIMARY KEY,
        last_claimed_at TIMESTAMPTZ NOT NULL,
        last_tx_hash TEXT,
        claim_count INTEGER NOT NULL DEFAULT 1
      )
    `;

    const normalizedAddress = address.toLowerCase();
    const reservation = await sql`
      INSERT INTO eggoria_faucet_claims (wallet_address, last_claimed_at)
      VALUES (${normalizedAddress}, NOW())
      ON CONFLICT (wallet_address) DO UPDATE SET
        last_claimed_at = NOW(),
        last_tx_hash = NULL,
        claim_count = eggoria_faucet_claims.claim_count + 1
      WHERE eggoria_faucet_claims.last_claimed_at <= NOW() - (${cooldownHours} * INTERVAL '1 hour')
      RETURNING last_claimed_at
    `;

    if (!reservation[0]) {
      const previous = await sql`
        SELECT last_claimed_at FROM eggoria_faucet_claims
        WHERE wallet_address = ${normalizedAddress} LIMIT 1
      `;
      const retryAt = new Date(new Date(previous[0].last_claimed_at).getTime() + cooldownHours * 60 * 60 * 1000);
      return Response.json({ message: "This wallet has already received test funds recently.", retryAt: retryAt.toISOString() }, { status: 429 });
    }
    reservationTime = new Date(reservation[0].last_claimed_at);

    const chain = defineChain({
      id: chainId,
      name: "Arc Testnet",
      nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
      rpcUrls: { default: { http: [rpcUrl] } },
      blockExplorers: { default: { name: "ArcScan", url: "https://testnet.arcscan.app" } },
      testnet: true,
    });
    const transport = http(rpcUrl);
    const publicClient = createPublicClient({ chain, transport });
    const walletClient = createWalletClient({ account, chain, transport });
    const value = parseEther(String(amount));
    const faucetBalance = await publicClient.getBalance({ address: account.address });
    if (faucetBalance <= value) throw new Error("The faucet does not have enough test USDC.");

    const transactionHash = await walletClient.sendTransaction({ account, chain, to: address, value });
    await publicClient.waitForTransactionReceipt({ hash: transactionHash, confirmations: 1, timeout: 60_000 });
    const recipientBalance = await publicClient.getBalance({ address });

    await sql`
      UPDATE eggoria_faucet_claims SET last_tx_hash = ${transactionHash}
      WHERE wallet_address = ${normalizedAddress}
    `;

    return Response.json({
      amount,
      balance: Number(formatEther(recipientBalance)).toFixed(2),
      retryAt: new Date(reservationTime.getTime() + cooldownHours * 60 * 60 * 1000).toISOString(),
      transactionHash,
      explorerUrl: `https://testnet.arcscan.app/tx/${transactionHash}`,
    });
  } catch (error) {
    console.error("ARC faucet claim failed:", error instanceof Error ? error.message : "Unknown faucet error");
    if (reservationTime && isAddress(address)) {
      try {
        const sql = await getDatabase();
        await sql`
          DELETE FROM eggoria_faucet_claims
          WHERE wallet_address = ${address.toLowerCase()}
            AND last_claimed_at = ${reservationTime.toISOString()}
            AND last_tx_hash IS NULL
        `;
      } catch {
        // Preserve the original transaction error.
      }
    }
    const message = error instanceof Error && error.message.startsWith("The faucet")
      ? error.message
      : "Test USDC could not be sent. Please try again.";
    return Response.json({ message }, { status: message.includes("configuration") ? 503 : 500 });
  }
}
