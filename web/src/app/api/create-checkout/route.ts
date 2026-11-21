import { authenticateAddon } from "@/lib/auth";
import { error, json } from "@/lib/http";
import { isCurrency } from "@/lib/plans";
import { createSubscription } from "@/lib/razorpay";
import { getStatus } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/create-checkout
 * Headers: x-formping-secret, x-formping-google-token
 * Body: { email: string, currency: "USD" | "INR" }
 * Returns: { ok, url, subscription_id }  -> open `url` (Razorpay hosted page)
 *
 * The subscription carries notes { app: "formping", user_email } so the
 * webhook can tell FormPing events apart and knows whom to upgrade.
 */
export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return error(400, "invalid_json", "Request body must be JSON.");
  }

  const auth = await authenticateAddon(req.headers, body.email ?? body.user_email);
  if (!auth.ok) return error(auth.status, auth.code, auth.message);

  const currency = typeof body.currency === "string" ? body.currency.toUpperCase() : "";
  if (!isCurrency(currency)) {
    return error(400, "invalid_currency", "currency must be USD or INR.");
  }

  try {
    const status = await getStatus(auth.email);
    if (status.plan === "pro") {
      return error(409, "already_pro", "You are already on the Pro plan.");
    }

    const sub = await createSubscription(auth.email, currency);
    if (!sub.short_url) {
      return error(502, "no_checkout_url", "Razorpay did not return a payment link.");
    }
    return json({ ok: true, url: sub.short_url, subscription_id: sub.id });
  } catch (err) {
    console.error("[formping] create-checkout error", err);
    return error(502, "checkout_failed", "Could not start checkout. Please try again.");
  }
}
