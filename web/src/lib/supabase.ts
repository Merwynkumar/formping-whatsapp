import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { requireEnv } from "./env";

/**
 * Service-role client scoped to the isolated `formping` schema.
 * Server-side only: the service role key must never reach a browser.
 */
let client: SupabaseClient<any, "formping"> | null = null;

export function db(): SupabaseClient<any, "formping"> {
  if (!client) {
    client = createClient<any, "formping">(
      requireEnv("SUPABASE_URL"),
      requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
      {
        db: { schema: "formping" },
        auth: { persistSession: false, autoRefreshToken: false },
        global: { headers: { "x-application-name": "formping-whatsapp" } },
      },
    );
  }
  return client;
}

export interface UsageResult {
  allowed: boolean;
  plan: "free" | "pro";
  messages_used: number;
  monthly_limit: number;
  cycle_start: string;
}

export async function reserveMessage(email: string): Promise<UsageResult> {
  // p_limit = null lets the database derive the limit from the plan inside
  // the same locked transaction (free 25, pro 1000).
  const { data, error } = await db().rpc("increment_formping_usage", {
    p_email: email,
    p_limit: null,
  });
  if (error) throw new Error(`increment_formping_usage failed: ${error.message}`);
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error("increment_formping_usage returned no row");
  return row as UsageResult;
}

export async function refundMessage(email: string): Promise<void> {
  const { error } = await db().rpc("refund_formping_usage", { p_email: email });
  if (error) console.error("[formping] refund_formping_usage failed", error.message);
}

export interface StatusResult {
  plan: "free" | "pro";
  messages_used: number;
  monthly_limit: number;
  cycle_start: string;
}

export async function getStatus(email: string): Promise<StatusResult> {
  const { data, error } = await db().rpc("get_formping_status", { p_email: email });
  if (error) throw new Error(`get_formping_status failed: ${error.message}`);
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error("get_formping_status returned no row");
  return row as StatusResult;
}

export async function logMessage(entry: {
  user_email: string;
  recipient_phone: string;
  template_used: string;
  status: "sent" | "failed" | "quota_exceeded" | "rejected";
  meta_message_id?: string | null;
  error?: string | null;
}): Promise<void> {
  const { error } = await db().from("formping_message_logs").insert({
    ...entry,
    // Store a masked number: enough to debug, not a full contact list.
    recipient_phone: maskPhone(entry.recipient_phone),
    error: entry.error ? entry.error.slice(0, 500) : null,
  });
  if (error) console.error("[formping] failed to write message log", error.message);
}

function maskPhone(phone: string): string {
  if (phone.length <= 6) return phone;
  return phone.slice(0, 4) + "*".repeat(phone.length - 6) + phone.slice(-2);
}
