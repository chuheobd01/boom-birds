import { getDatabase } from "@/lib/database";

export async function GET() {
  try {
    const sql = await getDatabase();
    const rows = await sql`SELECT COUNT(*)::int AS total FROM eggoria_users`;
    return Response.json(
      { total: rows[0].total },
      {
        headers: {
          "Cache-Control":
            "public, max-age=0, s-maxage=30, stale-while-revalidate=300",
        },
      },
    );
  } catch (error) {
    console.error("Public stats failed:", error);
    return Response.json(
      { total: 0, message: "Stats are temporarily unavailable." },
      { status: 503 },
    );
  }
}
