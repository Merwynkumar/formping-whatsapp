import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { boolEnv, optionalEnv, requireEnv } from "./env";
import { normalizeEmail } from "./http";

/**
 * Requests from the Apps Script add-on carry:
 *   x-formping-secret        shared secret (FORMPING_API_SECRET), kept in the
 *                            add-on's Script Properties, never in the sidebar
 *   x-formping-google-token  ScriptApp.getOAuthToken() of the Google user
 *   user_email               in the JSON body or ?email= query
 *
 * The shared secret proves the call came from our add-on. The Google token
 * proves which user it is, so one user cannot spend another user's quota
 * just by changing user_email. Token checking can be switched off with
 * FORMPING_VERIFY_GOOGLE_TOKEN=false for local testing only.
 */

export type AuthResult =
  | { ok: true; email: string }
  | { ok: false; status: number; code: string; message: string };

function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

interface TokenInfo {
  email?: string;
  email_verified?: string | boolean;
  expires_in?: string | number;
  azp?: string;
  aud?: string;
  error?: string;
  error_description?: string;
}

// Small in-memory cache so a busy form doesn't call Google on every submit.
const tokenCache = new Map<string, { email: string; expiresAt: number }>();

async function emailFromGoogleToken(token: string): Promise<string | null> {
  const key = createHash("sha256").update(token).digest("hex");
  const cached = tokenCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.email;

  const res = await fetch(
    `https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(token)}`,
    { cache: "no-store" },
  );
  if (!res.ok) return null;
  const info = (await res.json()) as TokenInfo;
  const verified = info.email_verified === true || info.email_verified === "true";
  if (!info.email || !verified) return null;

  // Optional: pin tokens to the add-on's own Google Cloud OAuth client.
  const expectedClient = optionalEnv("GOOGLE_OAUTH_CLIENT_ID");
  if (expectedClient && info.azp !== expectedClient && info.aud !== expectedClient) {
    return null;
  }

  const email = info.email.toLowerCase();
  const ttl = Math.min(Number(info.expires_in ?? 300), 300) * 1000;
  tokenCache.set(key, { email, expiresAt: Date.now() + ttl });
  if (tokenCache.size > 5000) tokenCache.clear();
  return email;
}

export async function authenticateAddon(headers: Headers, claimedEmail: unknown): Promise<AuthResult> {
  const secret = headers.get("x-formping-secret") ?? "";
  if (!secret || !safeEqual(secret, requireEnv("FORMPING_API_SECRET"))) {
    return { ok: false, status: 401, code: "unauthorized", message: "Invalid or missing API secret." };
  }

  const email = normalizeEmail(claimedEmail);
  if (!email) {
    return { ok: false, status: 400, code: "invalid_email", message: "A valid user_email is required." };
  }

  if (boolEnv("FORMPING_VERIFY_GOOGLE_TOKEN", true)) {
    const token = headers.get("x-formping-google-token") ?? "";
    if (!token) {
      return { ok: false, status: 401, code: "missing_google_token", message: "Google identity token is required." };
    }
    const tokenEmail = await emailFromGoogleToken(token).catch(() => null);
    if (!tokenEmail || tokenEmail !== email) {
      return { ok: false, status: 403, code: "identity_mismatch", message: "Google identity does not match user_email." };
    }
  }

  return { ok: true, email };
}
