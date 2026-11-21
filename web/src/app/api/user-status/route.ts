import { authenticateAddon } from "@/lib/auth";
import { error, json } from "@/lib/http";
import { PRICES } from "@/lib/plans";
import { getStatus } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/user-status?email=...
 * Headers: x-formping-secret, x-formping-google-token
 * Returns the plan, messages used this cycle and the monthly limit.
 */
export async function GET(req: Request) {
  const email = new URL(req.url).searchParams.get("email");
  const auth = await authenticateAddon(req.headers, email);
  if (!auth.ok) return error(auth.status, auth.code, auth.message);

  try {
    const s = await getStatus(auth.email);
    const resetsAt = new Date(s.cycle_start);
    resetsAt.setUTCMonth(resetsAt.getUTCMonth() + 1);
    return json({
      ok: true,
      email: auth.email,
      plan: s.plan,
      messages_used: s.messages_used,
      monthly_limit: s.monthly_limit,
      cycle_start: s.cycle_start,
      resets_at: resetsAt.toISOString(),
      features: { customer_auto_reply: s.plan === "pro" },
      prices: { USD: PRICES.USD.label, INR: PRICES.INR.label },
    });
  } catch (err) {
    console.error("[formping] user-status error", err);
    return error(500, "server_error", "Could not load your plan. Please try again.");
  }
}
