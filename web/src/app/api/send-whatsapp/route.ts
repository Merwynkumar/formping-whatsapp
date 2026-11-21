import { authenticateAddon } from "@/lib/auth";
import { error, json } from "@/lib/http";
import { getStatus, logMessage, refundMessage, reserveMessage } from "@/lib/supabase";
import { normalizePhone, sanitizeParam, sendTemplate, templateFor, type MessageKind } from "@/lib/whatsapp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KINDS: MessageKind[] = ["owner", "customer", "test"];

/**
 * POST /api/send-whatsapp
 * Headers: x-formping-secret, x-formping-google-token
 * Body: {
 *   user_email: string,
 *   kind: "owner" | "customer" | "test",
 *   to: string,                     // phone, ideally with country code
 *   params: string[],               // template body params, in order
 *   default_country_code?: string   // used when `to` has no country code
 * }
 */
export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return error(400, "invalid_json", "Request body must be JSON.");
  }

  const auth = await authenticateAddon(req.headers, body.user_email);
  if (!auth.ok) return error(auth.status, auth.code, auth.message);
  const email = auth.email;

  const kind = body.kind as MessageKind;
  if (!KINDS.includes(kind)) {
    return error(400, "invalid_kind", "kind must be owner, customer or test.");
  }
  const template = templateFor(kind);

  const to = normalizePhone(body.to, body.default_country_code);
  if (!to) {
    await logMessage({
      user_email: email,
      recipient_phone: String(body.to ?? "").slice(0, 32) || "(empty)",
      template_used: template.name,
      status: "rejected",
      error: "invalid phone number",
    }).catch(() => undefined);
    return error(400, "invalid_phone", "Recipient phone number is not valid. Include the country code, e.g. +919876543210.");
  }

  const rawParams = Array.isArray(body.params) ? body.params : [];
  if (rawParams.length !== template.paramCount) {
    return error(400, "invalid_params", `Template ${template.name} needs exactly ${template.paramCount} parameters.`);
  }
  const params = rawParams.map((p) => sanitizeParam(p));

  try {
    // Customer auto-replies are Pro only (anti-spam on the free tier).
    if (kind === "customer") {
      const status = await getStatus(email);
      if (status.plan !== "pro") {
        return error(402, "pro_required", "Customer auto-replies are a Pro feature.", { usage: status });
      }
    }

    const usage = await reserveMessage(email);
    if (!usage.allowed) {
      await logMessage({
        user_email: email,
        recipient_phone: to,
        template_used: template.name,
        status: "quota_exceeded",
      });
      return error(402, "quota_exceeded", `Monthly limit of ${usage.monthly_limit} messages reached.`, {
        usage: { plan: usage.plan, messages_used: usage.messages_used, monthly_limit: usage.monthly_limit },
      });
    }

    const result = await sendTemplate(to, template, params);
    if (!result.ok) {
      await refundMessage(email);
      await logMessage({
        user_email: email,
        recipient_phone: to,
        template_used: template.name,
        status: "failed",
        error: result.error,
      });
      return error(502, "send_failed", result.error ?? "WhatsApp send failed.", { retryable: !!result.retryable });
    }

    await logMessage({
      user_email: email,
      recipient_phone: to,
      template_used: template.name,
      status: "sent",
      meta_message_id: result.messageId,
    });

    return json({
      ok: true,
      message_id: result.messageId,
      usage: { plan: usage.plan, messages_used: usage.messages_used, monthly_limit: usage.monthly_limit },
    });
  } catch (err) {
    console.error("[formping] send-whatsapp error", err);
    return error(500, "server_error", "Something went wrong. Please try again.");
  }
}
