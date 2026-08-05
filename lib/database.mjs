import { neon } from "@neondatabase/serverless";

let schemaReady;

export const getDatabase = async () => {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not configured.");
  const sql = neon(process.env.DATABASE_URL);
  schemaReady ||= sql`
    CREATE TABLE IF NOT EXISTS eggoria_users (
      google_sub TEXT PRIMARY KEY,
      public_id VARCHAR(6) UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      picture TEXT NOT NULL DEFAULT '',
      position BIGSERIAL UNIQUE NOT NULL,
      referred_by VARCHAR(6),
      connected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await schemaReady;
  return sql;
};

export const sendJson = (response, body, status = 200) => {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.end(JSON.stringify(body));
};
