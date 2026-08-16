import { createHash, timingSafeEqual } from "node:crypto";

import { getDatabase } from "@/lib/database";

function matches(provided: string, expected: string) {
  return timingSafeEqual(
    createHash("sha256").update(provided).digest(),
    createHash("sha256").update(expected).digest(),
  );
}

export async function GET(request: Request) {
  const expected = process.env.ADMIN_DASHBOARD_TOKEN;
  if (!expected) {
    return Response.json(
      { message: "Admin dashboard is not configured." },
      { status: 503 },
    );
  }

  const authorization = request.headers.get("authorization") || "";
  const token = authorization.startsWith("Bearer ")
    ? authorization.slice(7)
    : "";
  if (!token || !matches(token, expected)) {
    return Response.json(
      { message: "The admin token is invalid." },
      { status: 401 },
    );
  }

  try {
    const sql = await getDatabase();
    const users = await sql`
      SELECT public_id, email, name, picture, position, referred_by,
             connected_at, last_seen_at
      FROM eggoria_users ORDER BY position ASC
    `;
    const normalized = users.map((user) => ({
      publicId: user.public_id,
      email: user.email,
      name: user.name,
      picture: user.picture,
      position: Number(user.position),
      referredBy: user.referred_by,
      connectedAt: user.connected_at,
      lastSeenAt: user.last_seen_at,
    }));

    return Response.json({
      users: normalized,
      total: normalized.length,
      guaranteed: normalized.filter((user) => user.position <= 5555).length,
      referred: normalized.filter((user) => user.referredBy).length,
    });
  } catch (error) {
    console.error("Admin dashboard failed:", error);
    return Response.json(
      { message: "Dashboard data could not be loaded." },
      { status: 500 },
    );
  }
}
