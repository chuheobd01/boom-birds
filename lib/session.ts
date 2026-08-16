import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE_NAME = "eggoria_session";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 365;

function getSecret() {
  if (!process.env.SESSION_SECRET) {
    throw new Error("SESSION_SECRET is not configured.");
  }
  return process.env.SESSION_SECRET;
}

function sign(value: string) {
  return createHmac("sha256", getSecret()).update(value).digest("base64url");
}

export function createSessionToken(googleSub: string) {
  const payload = Buffer.from(
    JSON.stringify({ sub: googleSub, issuedAt: Date.now() }),
  ).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function readSessionToken(token?: string) {
  if (!token) return null;
  const separator = token.lastIndexOf(".");
  if (separator < 1) return null;

  const payload = token.slice(0, separator);
  const signature = token.slice(separator + 1);
  const expected = sign(payload);
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);

  if (
    actualBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(actualBuffer, expectedBuffer)
  ) {
    return null;
  }

  try {
    const session = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as { sub?: string; issuedAt?: number };
    if (
      !session.sub ||
      !session.issuedAt ||
      Date.now() - session.issuedAt > SESSION_MAX_AGE * 1000
    ) {
      return null;
    }
    return { sub: session.sub };
  } catch {
    return null;
  }
}
