import { createHash } from "node:crypto";
import { OAuth2Client } from "google-auth-library";
import { getDatabase, sendJson } from "../lib/database.mjs";
import { createSessionCookie } from "../lib/session.mjs";

const handler = async (request, response) => {
  if (request.method !== "POST") return sendJson(response, { message: "Method not allowed." }, 405);
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) return sendJson(response, { message: "Google OAuth is not configured." }, 503);

  let body;
  try { body = typeof request.body === "string" ? JSON.parse(request.body) : request.body; }
  catch { return sendJson(response, { message: "Invalid request body." }, 400); }

  const credential = String(body.credential || "");
  const referralCode = String(body.referralCode || "").trim().toUpperCase();
  if (!credential || credential.length > 10000) return sendJson(response, { message: "Missing Google credential." }, 400);

  try {
    const ticket = await new OAuth2Client(clientId).verifyIdToken({ idToken: credential, audience: clientId });
    const payload = ticket.getPayload();
    if (!payload?.sub || !payload.email || payload.email_verified !== true) {
      return sendJson(response, { message: "Google account could not be verified." }, 401);
    }

    const sql = await getDatabase();
    const publicId = createHash("sha256").update(`eggoria:${payload.sub}`).digest("hex").slice(0, 6).toUpperCase();
    const requestedReferral = /^[A-F0-9]{6}$/.test(referralCode) && referralCode !== publicId ? referralCode : "";
    const referrer = requestedReferral
      ? await sql`SELECT public_id FROM eggoria_users WHERE public_id = ${requestedReferral} LIMIT 1`
      : [];
    const referredBy = referrer[0]?.public_id || null;

    const rows = await sql`
      INSERT INTO eggoria_users (google_sub, public_id, email, name, picture, referred_by)
      VALUES (${payload.sub}, ${publicId}, ${payload.email.toLowerCase()}, ${payload.name || "Eggoria Explorer"}, ${payload.picture || ""}, ${referredBy})
      ON CONFLICT (google_sub) DO UPDATE SET
        email = EXCLUDED.email,
        name = EXCLUDED.name,
        picture = EXCLUDED.picture,
        last_seen_at = NOW()
      RETURNING public_id, email, name, picture, position, referred_by, connected_at
    `;
    const record = rows[0];
    const referralCount = await sql`SELECT COUNT(*)::int AS count FROM eggoria_users WHERE referred_by = ${record.public_id}`;

    response.setHeader("Set-Cookie", createSessionCookie(payload.sub));
    return sendJson(response, { user: {
      id: record.public_id,
      name: record.name,
      email: record.email,
      picture: record.picture,
      position: Number(record.position),
      referrals: referralCount[0].count,
      connectedAt: record.connected_at,
      status: "Verified",
    } });
  } catch (error) {
    console.error("Google connection failed:", error);
    const configurationError = error.message?.includes("DATABASE_URL");
    return sendJson(response, { message: configurationError ? "Database is not configured." : "Google connection failed. Please try again." }, configurationError ? 503 : 500);
  }
};

export default handler;
