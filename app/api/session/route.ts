import { cookies } from "next/headers";

import { getDatabase } from "@/lib/database";
import {
  createSessionToken,
  readSessionToken,
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE,
} from "@/lib/session";

export async function GET() {
  try {
    const cookieStore = await cookies();
    const session = readSessionToken(cookieStore.get(SESSION_COOKIE_NAME)?.value);
    if (!session) {
      return Response.json({ authenticated: false }, { status: 401 });
    }

    const sql = await getDatabase();
    const rows = await sql`
      SELECT public_id, email, name, picture, position, connected_at
      FROM eggoria_users WHERE google_sub = ${session.sub} LIMIT 1
    `;
    if (!rows[0]) {
      return Response.json({ authenticated: false }, { status: 401 });
    }

    const user = rows[0];
    const referralCount = await sql`
      SELECT COUNT(*)::int AS count FROM eggoria_users
      WHERE referred_by = ${user.public_id}
    `;

    cookieStore.set(SESSION_COOKIE_NAME, createSessionToken(session.sub), {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_MAX_AGE,
    });

    return Response.json({
      authenticated: true,
      user: {
        id: user.public_id,
        name: user.name,
        email: user.email,
        picture: user.picture,
        position: Number(user.position),
        referrals: referralCount[0].count,
        connectedAt: user.connected_at,
        status: "Verified",
      },
    });
  } catch (error) {
    console.error("Session restore failed:", error);
    return Response.json({ authenticated: false }, { status: 500 });
  }
}
