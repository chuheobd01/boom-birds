import { createPublicClient, defineChain, getAddress, http, isAddress } from "viem";

import { getDatabase } from "@/lib/database";
import { eggoriaBirdsAbi } from "@/lib/eggoria-birds";

const ARC_TESTNET = defineChain({
  id: 5_042_002,
  name: "ARC Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: [process.env.ARC_TESTNET_RPC_URL || "https://rpc.testnet.arc.network"] } },
});

type CheckInIdentity = { owner: `0x${string}`; tokenId: bigint; contract: `0x${string}` };

function parseIdentity(ownerValue: unknown, tokenValue: unknown): CheckInIdentity | null {
  const contractValue = process.env.NEXT_PUBLIC_EGGORIA_BIRDS_ADDRESS || "";
  if (!isAddress(String(ownerValue || "")) || !isAddress(contractValue) || !/^\d+$/.test(String(tokenValue || ""))) return null;
  const tokenId = BigInt(String(tokenValue));
  if (tokenId <= BigInt(0)) return null;
  return { owner: getAddress(String(ownerValue)), tokenId, contract: getAddress(contractValue) };
}

async function verifyOwnership(identity: CheckInIdentity) {
  const client = createPublicClient({ chain: ARC_TESTNET, transport: http() });
  const [chainOwner, state] = await Promise.all([
    client.readContract({ address: identity.contract, abi: eggoriaBirdsAbi, functionName: "ownerOf", args: [identity.tokenId] }),
    client.readContract({ address: identity.contract, abi: eggoriaBirdsAbi, functionName: "tokenState", args: [identity.tokenId] }),
  ]);
  if (chainOwner.toLowerCase() !== identity.owner.toLowerCase()) return null;
  return { onChainCheckIns: Number(state[6]), onChainLastDay: state[7] };
}

async function readProgress(identity: CheckInIdentity, onChainCheckIns: number, onChainLastDay: bigint) {
  const sql = await getDatabase();
  const rows = await sql`
    SELECT
      COUNT(*) FILTER (WHERE check_in_day > ${onChainLastDay.toString()})::int AS count,
      COALESCE(MAX(check_in_day) FILTER (WHERE check_in_day > ${onChainLastDay.toString()}), 0)::text AS last_day,
      COALESCE(MAX(created_at)::text, '') AS last_check_in_at
    FROM eggoria_check_ins
    WHERE contract_address = ${identity.contract.toLowerCase()}
      AND token_id = ${identity.tokenId.toString()}
  `;
  const storedSinceCheckpoint = Number(rows[0]?.count || 0);
  const storedCheckIns = Math.min(20, onChainCheckIns + storedSinceCheckpoint);
  const storedLastDay = BigInt(String(rows[0]?.last_day || "0"));
  return {
    checkIns: storedCheckIns,
    lastCheckInDay: (storedLastDay > onChainLastDay ? storedLastDay : onChainLastDay).toString(),
    lastCheckInAt: String(rows[0]?.last_check_in_at || ""),
    storedCheckIns,
  };
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const identity = parseIdentity(url.searchParams.get("owner"), url.searchParams.get("tokenId"));
    if (!identity) return Response.json({ message: "Invalid bird identity." }, { status: 400 });
    const chainState = await verifyOwnership(identity);
    if (!chainState) return Response.json({ message: "Wallet does not own this bird." }, { status: 403 });
    return Response.json(await readProgress(identity, chainState.onChainCheckIns, chainState.onChainLastDay));
  } catch (error) {
    console.error("Check-in progress read failed:", error);
    return Response.json({ message: "Check-in progress is temporarily unavailable." }, { status: 503 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { owner?: unknown; tokenId?: unknown };
    const identity = parseIdentity(body.owner, body.tokenId);
    if (!identity) return Response.json({ message: "Invalid bird identity." }, { status: 400 });
    const chainState = await verifyOwnership(identity);
    if (!chainState) return Response.json({ message: "Wallet does not own this bird." }, { status: 403 });

    const before = await readProgress(identity, chainState.onChainCheckIns, chainState.onChainLastDay);
    if (before.storedCheckIns >= 20) return Response.json(before);
    if (before.storedCheckIns % 10 === 9 && chainState.onChainCheckIns <= before.storedCheckIns) {
      return Response.json({ message: "Complete the on-chain evolution checkpoint first." }, { status: 409 });
    }

    const lastCheckInAtMs = before.lastCheckInAt ? new Date(before.lastCheckInAt).getTime() : 0;
    if (lastCheckInAtMs && Date.now() < lastCheckInAtMs + 86_400_000) {
      return Response.json({
        ...before,
        retryAt: new Date(lastCheckInAtMs + 86_400_000).toISOString(),
        message: "Your next check-in is not ready yet.",
      }, { status: 429 });
    }

    const today = BigInt(Math.floor(Date.now() / 86_400_000));
    const sql = await getDatabase();
    const inserted = await sql`
      INSERT INTO eggoria_check_ins (contract_address, token_id, owner_address, check_in_day)
      SELECT ${identity.contract.toLowerCase()}, ${identity.tokenId.toString()}, ${identity.owner.toLowerCase()}, ${today.toString()}
      WHERE NOT EXISTS (
        SELECT 1 FROM eggoria_check_ins
        WHERE contract_address = ${identity.contract.toLowerCase()}
          AND token_id = ${identity.tokenId.toString()}
          AND created_at > NOW() - INTERVAL '24 hours'
      )
      ON CONFLICT (contract_address, token_id, check_in_day) DO NOTHING
      RETURNING created_at
    `;
    const after = await readProgress(identity, chainState.onChainCheckIns, chainState.onChainLastDay);
    if (inserted.length === 0) {
      const retryAt = after.lastCheckInAt
        ? new Date(new Date(after.lastCheckInAt).getTime() + 86_400_000).toISOString()
        : "";
      return Response.json({ ...after, retryAt, message: "Your next check-in is not ready yet." }, { status: 429 });
    }
    return Response.json(after);
  } catch (error) {
    console.error("Daily check-in save failed:", error);
    return Response.json({ message: "Daily check-in could not be saved." }, { status: 503 });
  }
}
