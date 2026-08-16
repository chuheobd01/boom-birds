import { createHash } from "node:crypto";
import { cookies } from "next/headers";
import { OAuth2Client } from "google-auth-library";

import { getDatabase } from "@/lib/database";
import {
  createSessionToken,
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE,
} from "@/lib/session";

export async function POST(request: Request) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    return Response.json(
      { message: "Google OAuth is not configured." },
      { status: 503 },
    );
  }

  let body: { credential?: unknown; referralCode?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ message: "Invalid request body." }, { status: 400 });
  }

  const credential = String(body.credential || "");
  const referralCode = String(body.referralCode || "").trim().toUpperCase();
  if (!credential || credential.length > 10_000) {
    return Response.json(
      { message: "Missing Google credential." },
      { status: 400 },
    );
  }

  try {
    const ticket = await new OAuth2Client(clientId).verifyIdToken({
      idToken: credential,
      audience: clientId,
    });
    const payload = ticket.getPayload();
    if (!payload?.sub || !payload.email || payload.email_verified !== true) {
      return Response.json(
        { message: "Google account could not be verified." },
        { status: 401 },
      );
    }

    const sql = await getDatabase();
    const publicId = createHash("sha256")
      .update(`eggoria:${payload.sub}`)
      .digest("hex")
      .slice(0, 6)
      .toUpperCase();
    const requestedReferral =
      /^[A-F0-9]{6}$/.test(referralCode) && referralCode !== publicId
        ? referralCode
        : "";
    const referrer = requestedReferral
      ? await sql`
          SELECT public_id FROM eggoria_users
          WHERE public_id = ${requestedReferral} LIMIT 1
        `
      : [];
    const referredBy = referrer[0]?.public_id || null;

    const rows = await sql`
      INSERT INTO eggoria_users
        (google_sub, public_id, email, name, picture, referred_by)
      VALUES
        (${payload.sub}, ${publicId}, ${payload.email.toLowerCase()},
         ${payload.name || "Eggoria Explorer"}, ${payload.picture || ""}, ${referredBy})
      ON CONFLICT (google_sub) DO UPDATE SET
        email = EXCLUDED.email,
        name = EXCLUDED.name,
        picture = EXCLUDED.picture,
        last_seen_at = NOW()
      RETURNING public_id, email, name, picture, position, referred_by, connected_at
    `;
    const record = rows[0];
    const referralCount = await sql`
      SELECT COUNT(*)::int AS count FROM eggoria_users
      WHERE referred_by = ${record.public_id}
    `;

    const cookieStore = await cookies();
    cookieStore.set(SESSION_COOKIE_NAME, createSessionToken(payload.sub), {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_MAX_AGE,
    });

    return Response.json({
      user: {
        id: record.public_id,
        name: record.name,
        email: record.email,
        picture: record.picture,
        position: Number(record.position),
        referrals: referralCount[0].count,
        connectedAt: record.connected_at,
        status: "Verified",
      },
    });
  } catch (error) {
    console.error("Google connection failed:", error);
    const message = error instanceof Error ? error.message : "";
    const configurationError = message.includes("DATABASE_URL");
    return Response.json(
      {
        message: configurationError
          ? "Database is not configured."
          : "Google connection failed. Please try again.",
      },
      { status: configurationError ? 503 : 500 },
    );
  }
}
