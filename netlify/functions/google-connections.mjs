import { createHash } from "node:crypto";
import { getStore } from "@netlify/blobs";
import { OAuth2Client } from "google-auth-library";

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });

const publicMember = (record) => ({
  id: record.publicId,
  name: `Explorer #${record.publicId}`,
  connectedAt: record.connectedAt,
  status: "Verified",
});

const listAllBlobs = async (store, prefix) => {
  const blobs = [];
  for await (const page of store.list({ prefix, paginate: true })) blobs.push(...page.blobs);
  return blobs;
};

const listMembers = async (store) => {
  const blobs = await listAllBlobs(store, "users/");
  const latestKeys = blobs.slice(-50).map(({ key }) => key);
  const records = await Promise.all(
    latestKeys.map((key) => store.get(key, { type: "json", consistency: "strong" })),
  );

  const members = records
    .filter(Boolean)
    .sort((a, b) => Date.parse(b.connectedAt) - Date.parse(a.connectedAt))
    .slice(0, 8)
    .map(publicMember);

  return { members, total: blobs.length };
};

export default async (request) => {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) return json({ message: "Google OAuth is not configured." }, 503);

  const store = getStore("eggoria-google-connections");

  if (request.method === "GET") {
    return json(await listMembers(store));
  }

  if (request.method !== "POST") {
    return json({ message: "Method not allowed." }, 405);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ message: "Invalid request body." }, 400);
  }

  const credential = String(body.credential || "");
  const referralCode = String(body.referralCode || "").trim().toUpperCase();
  if (!credential || credential.length > 10000) {
    return json({ message: "Missing Google credential." }, 400);
  }

  try {
    const googleClient = new OAuth2Client(clientId);
    const ticket = await googleClient.verifyIdToken({ idToken: credential, audience: clientId });
    const payload = ticket.getPayload();

    if (!payload?.sub || !payload.email || payload.email_verified !== true) {
      return json({ message: "Google account could not be verified." }, 401);
    }

    const key = `users/${payload.sub}.json`;
    const existing = await store.get(key, { type: "json", consistency: "strong" });
    const publicId = createHash("sha256")
      .update(`eggoria:${payload.sub}`)
      .digest("hex")
      .slice(0, 6)
      .toUpperCase();
    const now = new Date().toISOString();
    const currentUsers = await listAllBlobs(store, "users/");
    const position = existing?.position || currentUsers.length + 1;
    const validReferral = /^[A-F0-9]{6}$/.test(referralCode) && referralCode !== publicId;
    const record = {
      googleSub: payload.sub,
      publicId,
      email: payload.email,
      name: payload.name || "Eggoria Explorer",
      picture: payload.picture || "",
      connectedAt: existing?.connectedAt || now,
      lastSeenAt: now,
      position,
      referredBy: existing?.referredBy || (validReferral ? referralCode : ""),
    };

    await store.setJSON(key, record);

    if (!existing && record.referredBy) {
      await store.setJSON(`referrals/${record.referredBy}/${payload.sub}.json`, {
        joinedAt: now,
      });
    }

    const referrals = await listAllBlobs(store, `referrals/${publicId}/`);

    const community = await listMembers(store);
    return json({
      user: {
        id: publicId,
        name: record.name,
        email: record.email,
        picture: record.picture,
        connectedAt: record.connectedAt,
        status: "Verified",
        position: record.position,
        referrals: referrals.length,
      },
      ...community,
    });
  } catch (error) {
    console.error("Google connection failed:", error);
    return json({ message: "Google credential is invalid or expired." }, 401);
  }
};
