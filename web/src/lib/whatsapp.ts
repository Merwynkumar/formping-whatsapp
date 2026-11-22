import "server-only";
import { optionalEnv, requireEnv } from "./env";

/**
 * Meta WhatsApp Business Cloud API (single master account).
 *
 * Business-initiated messages must use a pre-approved template, so every
 * message FormPing sends is a template. The client never chooses the
 * template name: it sends a "kind" and we map it here, which stops anyone
 * using our WABA to send arbitrary approved templates.
 *
 * Templates to create in WhatsApp Manager (category: UTILITY), see README:
 *   formping_owner_alert   "You have a new response on your form {{1}}. Details: {{2}} ..."  (2 params)
 *   formping_auto_reply    "Hi {{1}}, thank you for submitting {{2}}. {{3}} ..."           (3 params)
 * Exact bodies are in the README.
 */

export type MessageKind = "owner" | "customer" | "test";

export interface TemplateSpec {
  name: string;
  language: string;
  paramCount: number;
}

export function templateFor(kind: MessageKind): TemplateSpec {
  const language = optionalEnv("META_TEMPLATE_LANGUAGE", "en");
  if (kind === "customer") {
    return {
      name: optionalEnv("META_TEMPLATE_CUSTOMER", "formping_auto_reply"),
      language,
      paramCount: Number(optionalEnv("META_TEMPLATE_CUSTOMER_PARAMS", "3")),
    };
  }
  // owner + test both use the owner alert template.
  return {
    name: optionalEnv("META_TEMPLATE_OWNER", "formping_owner_alert"),
    language,
    paramCount: Number(optionalEnv("META_TEMPLATE_OWNER_PARAMS", "2")),
  };
}

/** Digits only, E.164 without "+". Returns null if it can't be a real number. */
export function normalizePhone(raw: unknown, defaultCountryCode?: unknown): string | null {
  if (typeof raw !== "string" && typeof raw !== "number") return null;
  let s = String(raw).trim();
  const hadPlus = s.startsWith("+") || s.startsWith("00");
  let digits = s.replace(/\D/g, "");
  if (s.startsWith("00")) digits = digits.slice(2);

  if (!hadPlus) {
    const cc = typeof defaultCountryCode === "string" ? defaultCountryCode.replace(/\D/g, "") : "";
    if (cc) {
      digits = digits.replace(/^0+/, ""); // drop trunk prefix, e.g. 098... -> 98...
      if (!digits.startsWith(cc) || digits.length <= 10) digits = cc + digits;
    }
  }
  return /^[1-9]\d{7,14}$/.test(digits) ? digits : null;
}

/**
 * Meta rejects template params with newlines, tabs or 4+ consecutive spaces,
 * and caps length. Clean them up rather than failing the send.
 */
export function sanitizeParam(value: unknown, maxLen = 900): string {
  let s = typeof value === "string" ? value : value == null ? "" : String(value);
  s = s.replace(/[\r\n\t]+/g, " | ").replace(/ {4,}/g, "   ").trim();
  if (s.length > maxLen) s = s.slice(0, maxLen - 1) + "…";
  return s === "" ? "-" : s;
}

export interface SendResult {
  ok: boolean;
  messageId?: string;
  error?: string;
  retryable?: boolean;
}

export async function sendTemplate(to: string, template: TemplateSpec, params: string[]): Promise<SendResult> {
  const version = optionalEnv("META_GRAPH_API_VERSION", "v21.0");
  const phoneNumberId = requireEnv("META_PHONE_NUMBER_ID");
  const token = requireEnv("META_WHATSAPP_TOKEN");

  const payload = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "template",
    template: {
      name: template.name,
      language: { code: template.language },
      components: params.length
        ? [{ type: "body", parameters: params.map((text) => ({ type: "text", text })) }]
        : [],
    },
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(`https://graph.facebook.com/${version}/${phoneNumberId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
      cache: "no-store",
    });
    const body = (await res.json().catch(() => ({}))) as {
      messages?: { id: string }[];
      error?: { message?: string; code?: number; error_data?: { details?: string } };
    };
    if (res.ok && body.messages?.[0]?.id) {
      return { ok: true, messageId: body.messages[0].id };
    }
    const detail = body.error?.error_data?.details ?? body.error?.message ?? `HTTP ${res.status}`;
    return {
      ok: false,
      error: `Meta API error${body.error?.code ? ` ${body.error.code}` : ""}: ${detail}`,
      retryable: res.status >= 500 || res.status === 429,
    };
  } catch (err) {
    return { ok: false, error: `Meta API request failed: ${(err as Error).message}`, retryable: true };
  } finally {
    clearTimeout(timer);
  }
}
