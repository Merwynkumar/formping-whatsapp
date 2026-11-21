import { error, json, normalizeEmail } from "@/lib/http";
import { verifyWebhookSignature } from "@/lib/razorpay";
import { db } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/webhooks/razorpay
 * Dedicated webhook URL for FormPing only. Configure in Razorpay Dashboard
 * -> Settings -> Webhooks with events:
 *   subscription.activated, subscription.charged,
 *   subscription.cancelled, subscription.halted, subscription.completed
 */

const UPGRADE = new Set(["subscription.activated", "subscription.charged"]);
const DOWNGRADE = new Set(["subscription.cancelled", "subscription.halted", "subscription.completed"]);

interface SubscriptionEntity {
  id: string;
  status?: string;
  notes?: Record<string, string> | unknown[];
}

interface RazorpayEvent {
  event: string;
  payload?: { subscription?: { entity?: SubscriptionEntity } };
}

export async function POST(req: Request) {
  // Signature is computed over the exact raw body, so read it as text.
  const raw = await req.text();
  if (!verifyWebhookSignature(raw, req.headers.get("x-razorpay-signature"))) {
    return error(400, "invalid_signature", "Signature verification failed.");
  }

  let evt: RazorpayEvent;
  try {
    evt = JSON.parse(raw) as RazorpayEvent;
  } catch {
    return error(400, "invalid_json", "Body is not JSON.");
  }

  const sub = evt.payload?.subscription?.entity;
  const notes = sub && !Array.isArray(sub.notes) ? (sub.notes as Record<string, string>) : {};

  // Ignore anything that isn't ours (e.g. the account is shared later).
  if (!sub || notes.app !== "formping") {
    return json({ ok: true, ignored: "not a formping subscription event" });
  }
  if (!UPGRADE.has(evt.event) && !DOWNGRADE.has(evt.event)) {
    return json({ ok: true, ignored: `unhandled event ${evt.event}` });
  }

  const email = normalizeEmail(notes.user_email);
  if (!email) return json({ ok: true, ignored: "no user_email in notes" });

  // Idempotency: Razorpay retries, so record each event id once.
  const eventId = req.headers.get("x-razorpay-event-id") ?? `${evt.event}:${sub.id}:${raw.length}`;
  const supabase = db();
  const { error: dupErr } = await supabase
    .from("formping_webhook_events")
    .insert({ event_id: eventId, event_type: evt.event });
  if (dupErr) {
    if (dupErr.code === "23505") return json({ ok: true, duplicate: true });
    console.error("[formping] webhook event insert failed", dupErr.message);
    return error(500, "db_error", "Could not record event.");
  }

  try {
    if (UPGRADE.has(evt.event)) {
      // A successful charge starts a fresh monthly allowance.
      const { error: upErr } = await supabase.from("formping_users").upsert(
        {
          email,
          plan: "pro",
          razorpay_subscription_id: sub.id,
          messages_used_this_month: 0,
          billing_cycle_start: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "email" },
      );
      if (upErr) throw new Error(upErr.message);
    } else {
      // Only downgrade if this is the user's current subscription, so
      // cancelling an old/abandoned subscription can't remove Pro.
      const { data: user, error: readErr } = await supabase
        .from("formping_users")
        .select("razorpay_subscription_id")
        .eq("email", email)
        .maybeSingle();
      if (readErr) throw new Error(readErr.message);

      if (user && (user.razorpay_subscription_id === sub.id || !user.razorpay_subscription_id)) {
        const { error: downErr } = await supabase
          .from("formping_users")
          .update({ plan: "free", razorpay_subscription_id: null, updated_at: new Date().toISOString() })
          .eq("email", email);
        if (downErr) throw new Error(downErr.message);
      }
    }
    return json({ ok: true });
  } catch (err) {
    // Let Razorpay retry: forget the event so the retry is processed.
    await supabase.from("formping_webhook_events").delete().eq("event_id", eventId);
    console.error("[formping] webhook processing failed", err);
    return error(500, "processing_failed", "Webhook processing failed.");
  }
}
