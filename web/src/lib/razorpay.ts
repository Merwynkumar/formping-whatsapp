import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { optionalEnv, requireEnv } from "./env";
import type { Currency } from "./plans";

/**
 * Razorpay Subscriptions via the REST API (no SDK needed).
 * Plans are created once (see README) and referenced by id per currency.
 * USD plans need International Payments enabled on the Razorpay account.
 */

const API = "https://api.razorpay.com/v1";

function authHeader(): string {
  const id = requireEnv("RAZORPAY_KEY_ID");
  const secret = requireEnv("RAZORPAY_KEY_SECRET");
  return "Basic " + Buffer.from(`${id}:${secret}`).toString("base64");
}

export function planIdFor(currency: Currency): string {
  return currency === "USD" ? requireEnv("RAZORPAY_PLAN_ID_USD") : requireEnv("RAZORPAY_PLAN_ID_INR");
}

export interface RazorpaySubscription {
  id: string;
  status: string;
  short_url?: string;
  plan_id: string;
  notes?: Record<string, string>;
}

export async function createSubscription(email: string, currency: Currency): Promise<RazorpaySubscription> {
  const res = await fetch(`${API}/subscriptions`, {
    method: "POST",
    headers: { Authorization: authHeader(), "Content-Type": "application/json" },
    body: JSON.stringify({
      plan_id: planIdFor(currency),
      // Razorpay requires a finite count; 120 monthly cycles = 10 years.
      total_count: Number(optionalEnv("RAZORPAY_TOTAL_COUNT", "120")),
      quantity: 1,
      customer_notify: 1,
      notes: { app: "formping", user_email: email, currency },
    }),
    cache: "no-store",
  });
  const body = (await res.json().catch(() => ({}))) as RazorpaySubscription & {
    error?: { description?: string };
  };
  if (!res.ok || !body.id) {
    throw new Error(`Razorpay create subscription failed: ${body.error?.description ?? `HTTP ${res.status}`}`);
  }
  return body;
}

/** HMAC-SHA256 of the exact raw request body, hex encoded. */
export function verifyWebhookSignature(rawBody: string, signature: string | null): boolean {
  if (!signature) return false;
  const expected = createHmac("sha256", requireEnv("RAZORPAY_WEBHOOK_SECRET")).update(rawBody, "utf8").digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signature.trim(), "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}
