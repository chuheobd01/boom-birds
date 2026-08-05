import { getDatabase } from "../lib/database.mjs";

const handler = async (request, response) => {
  if (request.method !== "GET") {
    response.statusCode = 405;
    return response.end(JSON.stringify({ message: "Method not allowed." }));
  }

  try {
    const sql = await getDatabase();
    const rows = await sql`SELECT COUNT(*)::int AS total FROM eggoria_users`;
    response.statusCode = 200;
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    response.setHeader("Cache-Control", "public, max-age=0, s-maxage=30, stale-while-revalidate=300");
    return response.end(JSON.stringify({ total: rows[0].total }));
  } catch (error) {
    console.error("Public stats failed:", error);
    response.statusCode = 503;
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    return response.end(JSON.stringify({ total: 0, message: "Stats are temporarily unavailable." }));
  }
};

export default handler;
