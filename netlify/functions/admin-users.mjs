import { createHash, timingSafeEqual } from "node:crypto";
import { getStore } from "@netlify/blobs";

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
const matches = (provided, expected) => timingSafeEqual(createHash("sha256").update(provided).digest(), createHash("sha256").update(expected).digest());
const listAll = async (store, prefix) => {
  const blobs = [];
  for await (const page of store.list({ prefix, paginate: true })) blobs.push(...page.blobs);
  return blobs;
};

const handler = async (request) => {
  if (request.method !== "GET") return json({ message: "Method not allowed." }, 405);
  const expected = process.env.ADMIN_DASHBOARD_TOKEN;
  if (!expected) return json({ message: "Admin dashboard is not configured." }, 503);
  const authorization = request.headers.get("authorization") || "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!token || !matches(token, expected)) return json({ message: "The admin token is invalid." }, 401);

  const store = getStore("eggoria-google-connections");
  const blobs = await listAll(store, "users/");
  const records = await Promise.all(blobs.map(({ key }) => store.get(key, { type: "json", consistency: "strong" })));
  const users = records.filter(Boolean).sort((a, b) => (a.position || 1e9) - (b.position || 1e9)).map((record) => ({
    publicId: record.publicId, email: record.email, name: record.name, picture: record.picture,
    position: record.position, referredBy: record.referredBy, connectedAt: record.connectedAt, lastSeenAt: record.lastSeenAt,
  }));
  return json({ users, total: users.length, guaranteed: users.filter((user) => user.position <= 5555).length, referred: users.filter((user) => user.referredBy).length });
};

export default handler;
