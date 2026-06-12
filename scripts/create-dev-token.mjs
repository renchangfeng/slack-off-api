import { createHmac, randomUUID } from "node:crypto";

const secret = process.env.SUPABASE_JWT_SECRET ?? "dev-secret-change-me";
const subject = process.env.DEV_AUTH_SUBJECT ?? randomUUID();
const email = process.env.DEV_AUTH_EMAIL ?? "local-slacker@example.com";
const expiresInSeconds = Number(process.env.DEV_AUTH_EXPIRES_IN_SECONDS ?? 60 * 60 * 24 * 30);
const now = Math.floor(Date.now() / 1000);

const header = {
  alg: "HS256",
  typ: "JWT"
};

const payload = {
  sub: subject,
  email,
  email_confirmed_at: new Date(now * 1000).toISOString(),
  iat: now,
  exp: now + expiresInSeconds
};

const encodedHeader = base64UrlEncode(JSON.stringify(header));
const encodedPayload = base64UrlEncode(JSON.stringify(payload));
const signature = createHmac("sha256", secret)
  .update(`${encodedHeader}.${encodedPayload}`)
  .digest("base64url");

console.log(`${encodedHeader}.${encodedPayload}.${signature}`);

function base64UrlEncode(value) {
  return Buffer.from(value).toString("base64url");
}
