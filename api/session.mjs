import { getDatabase, sendJson } from "../lib/database.mjs";
import { createSessionCookie, readSession } from "../lib/session.mjs";

const handler = async (request, response) => {
  if (request.method !== "GET") return sendJson(response, { message: "Method not allowed." }, 405);
  try {
    const session = readSession(request);
    if (!session) return sendJson(response, { authenticated: false }, 401);

    const sql = await getDatabase();
    const rows = await sql`
      SELECT public_id, email, name, picture, position, connected_at
      FROM eggoria_users WHERE google_sub = ${session.sub} LIMIT 1
    `;
    if (!rows[0]) return sendJson(response, { authenticated: false }, 401);
    const user = rows[0];
    const referralCount = await sql`SELECT COUNT(*)::int AS count FROM eggoria_users WHERE referred_by = ${user.public_id}`;

    response.setHeader("Set-Cookie", createSessionCookie(session.sub));
    return sendJson(response, {
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
    return sendJson(response, { authenticated: false }, 500);
  }
};

export default handler;
