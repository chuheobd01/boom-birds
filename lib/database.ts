import "server-only";

import { neon } from "@neondatabase/serverless";

let schemaReady: Promise<unknown> | undefined;

export async function getDatabase() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not configured.");
  }

  const sql = neon(process.env.DATABASE_URL);
  schemaReady ??= Promise.all([
    sql`
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
    `,
    sql`
      CREATE TABLE IF NOT EXISTS eggoria_check_ins (
        contract_address TEXT NOT NULL,
        token_id NUMERIC(78, 0) NOT NULL,
        owner_address TEXT NOT NULL,
        check_in_day BIGINT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (contract_address, token_id, check_in_day)
      )
    `,
  ]);
  await schemaReady;
  return sql;
}
