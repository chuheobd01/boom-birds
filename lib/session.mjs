import { createHmac, timingSafeEqual } from "node:crypto";

const COOKIE_NAME = "eggoria_session";
const MAX_AGE = 60 * 60 * 24 * 365;

const getSecret = () => {
  if (!process.env.SESSION_SECRET) throw new Error("SESSION_SECRET is not configured.");
  return process.env.SESSION_SECRET;
};

const sign = (value) => createHmac("sha256", getSecret()).update(value).digest("base64url");

export const createSessionCookie = (googleSub) => {
  const payload = Buffer.from(JSON.stringify({ sub: googleSub, issuedAt: Date.now() })).toString("base64url");
  return `${COOKIE_NAME}=${payload}.${sign(payload)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${MAX_AGE}`;
};

export const readSession = (request) => {
  const cookies = String(request.headers.cookie || "").split(";").map((item) => item.trim());
  const rawCookie = cookies.find((item) => item.startsWith(`${COOKIE_NAME}=`));
  if (!rawCookie) return null;
  const token = rawCookie.slice(COOKIE_NAME.length + 1);
  const separator = token.lastIndexOf(".");
  if (separator < 1) return null;
  const payload = token.slice(0, separator);
  const signature = token.slice(separator + 1);
  const expected = sign(payload);
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer)) return null;

  try {
    const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!session.sub || Date.now() - session.issuedAt > MAX_AGE * 1000) return null;
    return session;
  } catch {
    return null;
  }
};
