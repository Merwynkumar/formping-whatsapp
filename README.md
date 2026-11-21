# FormPing WhatsApp

A Google Forms add-on that sends an instant WhatsApp message to the form owner on every submission, plus an optional WhatsApp auto-reply to the respondent (Pro).

```
formping-whatsapp/
├── apps-script/          Google Forms editor add-on (Apps Script V8 + HtmlService)
│   ├── appsscript.json   manifest: minimal scopes + urlFetchWhitelist
│   ├── Code.gs           menu, sidebar, settings, trigger, onFormSubmit, API client
│   └── Sidebar.html      settings UI, variable chips, test button, plan & usage
├── web/                  Next.js App Router app (one Vercel project)
│   └── src/app/
│       ├── page.tsx, privacy/, terms/        marketing + OAuth compliance pages
│       └── api/
│           ├── send-whatsapp/route.ts        POST, quota + Meta template send
│           ├── user-status/route.ts          GET, plan + usage for the sidebar
│           ├── create-checkout/route.ts      POST, Razorpay subscription link
│           └── webhooks/razorpay/route.ts    POST, signed webhook, plan changes
├── supabase/schema.sql   isolated `formping` schema, tables, RPCs
└── .env.example          every env var, with where to get it
```

## Isolation

This repo is fully standalone. It has its own Git history, its own Supabase project (tables live in a dedicated `formping` schema with `formping_` prefixes, so it stays isolated even on a shared instance), its own Vercel project `formping-whatsapp`, its own env vars, and its own Razorpay webhook URL. It references nothing from any other app.

## How it works

1. The form owner opens **Extensions → FormPing WhatsApp → Open FormPing** in a Google Form, enters their WhatsApp number, picks answers with variable chips, and switches to **Active**. That creates an installable `onFormSubmit` trigger for that form.
2. On every response, `onFormSubmit(e)` replaces `{{Question Title}}` tokens with answers and calls `POST /api/send-whatsapp` with the shared secret and the user's Google OAuth token.
3. The backend checks the secret, confirms the Google token belongs to `user_email`, reserves one message atomically in Supabase (`increment_formping_usage`), sends a pre-approved **utility template** through the Meta Cloud API, and refunds the reservation if Meta rejects it. Every attempt is logged in `formping_message_logs` (phone numbers are partially masked).
4. Upgrades go through Razorpay Subscriptions. The webhook flips the plan to `pro` on `subscription.activated` / `subscription.charged` and back to `free` on `subscription.cancelled` / `subscription.halted` / `subscription.completed`.

| Plan | Messages / month | Customer auto-reply | Price |
|------|-----------------:|:-------------------:|-------|
| Free | 25 | No | $0 |
| Pro | 1,000 | Yes | $12/mo or ₹499/mo |

Test messages count toward the quota. The monthly window rolls over on the user's `billing_cycle_start` day, and a successful Pro charge resets it.

---

## Setup

You need: Node 20+, the Supabase CLI, the Vercel CLI, `clasp`, a Meta Business account with a WhatsApp Business phone number, and a Razorpay account.

```bash
npm i -g supabase vercel @google/clasp
```

### 0. Local repo

```bash
cd formping-whatsapp
git init -b main            # skip if already a repo
cd web && npm install && cd ..
```

### 1. Supabase: new dedicated project

```bash
supabase login
supabase orgs list
# Creates a NEW project (pick your org id and a region near your users, e.g. ap-south-1)
supabase projects create formping-whatsapp \
  --org-id <YOUR_ORG_ID> \
  --region ap-south-1 \
  --db-password "$(openssl rand -base64 24)"

supabase projects list                       # copy the new project's REFERENCE ID
supabase link --project-ref <FORMPING_REF>   # run from the repo root
```

Apply the schema (either way works):

```bash
# a) through the CLI as a migration
mkdir -p supabase/migrations
cp supabase/schema.sql supabase/migrations/20261121000000_formping_init.sql
supabase db push

# b) or paste supabase/schema.sql into Dashboard → SQL Editor → Run
```

Then expose the schema to the API, which is required because the tables are not in `public`:

- Dashboard → **Project Settings → Data API → Exposed schemas** → add `formping` → Save.

Grab the keys for step 2:

```bash
supabase projects api-keys --project-ref <FORMPING_REF>   # use the service_role key
# SUPABASE_URL = https://<FORMPING_REF>.supabase.co
```

> Sharing an existing free-tier project temporarily? Run the same `schema.sql` there. Everything is created inside `formping.*` and nothing else is touched. Move to a dedicated project before launch.

### 2. Vercel: new project `formping-whatsapp`

```bash
cd web
vercel login
vercel link
#   ? Set up "…/formping-whatsapp/web"?            → yes
#   ? Which scope?                                  → your account/team
#   ? Link to existing project?                     → NO  (create a new one)
#   ? What's your project's name?                   → formping-whatsapp
#   ? In which directory is your code located?      → ./

# Add every variable from ../.env.example (repeat for each name)
openssl rand -hex 32                                  # → FORMPING_API_SECRET
vercel env add FORMPING_API_SECRET production
vercel env add SUPABASE_URL production
vercel env add SUPABASE_SERVICE_ROLE_KEY production
vercel env add META_WHATSAPP_TOKEN production
vercel env add META_PHONE_NUMBER_ID production
vercel env add RAZORPAY_KEY_ID production
vercel env add RAZORPAY_KEY_SECRET production
vercel env add RAZORPAY_WEBHOOK_SECRET production
vercel env add RAZORPAY_PLAN_ID_USD production
vercel env add RAZORPAY_PLAN_ID_INR production
vercel env add NEXT_PUBLIC_SUPPORT_EMAIL production
# (the rest have safe defaults; add them if you change them)

vercel env pull .env.local          # local dev copy, git-ignored
vercel --prod                       # → https://formping-whatsapp.vercel.app

# Optional custom domain
vercel domains add formping.app formping-whatsapp
```

If you use a custom domain, update `NEXT_PUBLIC_SITE_URL`, `urlFetchWhitelist` in `apps-script/appsscript.json` and the `FORMPING_API_BASE` script property to match.

Local dev: `cd web && npm run dev` → http://localhost:3000.

### 3. Meta WhatsApp Cloud API

1. In [Meta for Developers](https://developers.facebook.com/apps) create a **Business** app and add the **WhatsApp** product. Add and verify your sending phone number.
2. Business Settings → **System users** → create an admin system user, assign the app and the WhatsApp Business Account, and **generate a permanent token** with `whatsapp_business_messaging` and `whatsapp_business_management`. That is `META_WHATSAPP_TOKEN`.
3. WhatsApp → API Setup → copy the **Phone number ID** → `META_PHONE_NUMBER_ID`.
4. WhatsApp Manager → **Message templates** → create two templates, category **Utility**, language **English (en)**:

   | Name | Body | Params |
   |------|------|--------|
   | `formping_owner_alert` | `New response on {{1}}: {{2}}` | 1 = form title, 2 = the owner's "Message details" |
   | `formping_auto_reply` | `Hi {{1}}, thanks for submitting {{2}}. {{3}}` | 1 = greeting name, 2 = form title, 3 = reply text |

   Give sample values when submitting (e.g. `Contact form`, `Name: Asha | Phone: +91…`). Wait for **Approved**. If you change the names, language or number of params, update the `META_TEMPLATE_*` env vars.

Business-initiated WhatsApp messages must use approved templates, so every message FormPing sends is a template. The client sends only a `kind` (`owner`, `customer`, `test`); the server picks the template name, so nobody can use the account to send other templates. Meta bills per template message, which is why the quota counts every send.

### 4. Razorpay: plans + dedicated webhook

Create the two monthly plans once (use **test** keys first, then repeat with live keys):

```bash
export RZP_KEY_ID=rzp_test_xxx RZP_KEY_SECRET=xxx

# ₹499 / month
curl -s -u "$RZP_KEY_ID:$RZP_KEY_SECRET" https://api.razorpay.com/v1/plans \
  -H 'Content-Type: application/json' \
  -d '{"period":"monthly","interval":1,"item":{"name":"FormPing Pro (INR)","amount":49900,"currency":"INR"},"notes":{"app":"formping"}}'

# $12 / month (needs International Payments enabled on your Razorpay account)
curl -s -u "$RZP_KEY_ID:$RZP_KEY_SECRET" https://api.razorpay.com/v1/plans \
  -H 'Content-Type: application/json' \
  -d '{"period":"monthly","interval":1,"item":{"name":"FormPing Pro (USD)","amount":1200,"currency":"USD"},"notes":{"app":"formping"}}'
```

Copy each returned `id` (`plan_…`) into `RAZORPAY_PLAN_ID_INR` / `RAZORPAY_PLAN_ID_USD`.

Webhook: Dashboard → **Accounts & Settings → Webhooks → Add New Webhook**

- URL: `https://formping-whatsapp.vercel.app/api/webhooks/razorpay` (this deployment only)
- Secret: `openssl rand -hex 32` → also set as `RAZORPAY_WEBHOOK_SECRET` on Vercel
- Active events: `subscription.activated`, `subscription.charged`, `subscription.cancelled`, `subscription.halted`, `subscription.completed`

Every subscription is created with `notes: { app: "formping", user_email }`. The webhook ignores events without `app: "formping"`, de-duplicates retries by `x-razorpay-event-id`, and only downgrades when the cancelled subscription is the user's current one.

Check the signature handling locally:

```bash
BODY='{"event":"subscription.activated","payload":{"subscription":{"entity":{"id":"sub_test","notes":{"app":"formping","user_email":"you@example.com"}}}}}'
SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$RAZORPAY_WEBHOOK_SECRET" | awk '{print $2}')
curl -X POST http://localhost:3000/api/webhooks/razorpay -H "x-razorpay-signature: $SIG" -H "x-razorpay-event-id: evt_test_1" -d "$BODY"
```

### 5. Apps Script add-on with clasp

```bash
clasp login                              # opens Google sign-in
# enable the Apps Script API once: https://script.google.com/home/usersettings

cd apps-script
clasp create --type standalone --title "FormPing WhatsApp" --rootDir .
#   writes .clasp.json (git-ignored); see .clasp.json.example
clasp push --force                       # uploads appsscript.json, Code.gs, Sidebar.html
clasp open-script                        # (older clasp: `clasp open`)
```

In the Apps Script editor:

1. **Project Settings → Script Properties** → add
   - `FORMPING_API_BASE` = `https://formping-whatsapp.vercel.app`
   - `FORMPING_API_SECRET` = the same value as on Vercel
2. **Deploy → Test deployments → Editor add-on → Google Forms** → pick a test form → **Execute**. In that form open **Extensions → FormPing WhatsApp → Open FormPing**, enter your number, press **Send Test WhatsApp**, then switch to **Active** and submit a response.

To publish on the Google Workspace Marketplace:

1. Link the script to a standard Google Cloud project (Project Settings → Google Cloud Platform project).
2. In that Cloud project: configure the **OAuth consent screen** with the homepage `https://formping-whatsapp.vercel.app/`, privacy `…/privacy`, terms `…/terms`, and verify domain ownership in Search Console. Add the scopes from `appsscript.json`.
3. **Deploy → New deployment → Add-on**, note the version, enable the **Google Workspace Marketplace SDK**, fill in the app configuration (Forms add-on, script ID + version) and store listing, then submit for review.
4. Optional hardening: set `GOOGLE_OAUTH_CLIENT_ID` on Vercel to the Cloud project's OAuth client ID so only tokens issued to this add-on are accepted.

### OAuth scopes

| Scope | Why |
|-------|-----|
| `forms.currentonly` | read question titles and new responses of the open form only |
| `script.external_request` | call the FormPing backend |
| `script.scriptapp` | create/delete the per-form `onFormSubmit` trigger |
| `userinfo.email` | identify the user for plan and quota |
| `script.container.ui` | show the sidebar in Google Forms. `FormApp.getUi().showSidebar()` won't run without it, so it is the one addition to the four requested scopes |

---

## API reference

All add-on endpoints require headers `x-formping-secret: <FORMPING_API_SECRET>` and `x-formping-google-token: <ScriptApp.getOAuthToken()>`. The backend checks that the token's verified email equals the email in the request, so one user cannot spend another user's quota. For local curl testing only, set `FORMPING_VERIFY_GOOGLE_TOKEN=false`.

**POST `/api/send-whatsapp`**

```json
{ "user_email": "owner@example.com", "kind": "owner", "to": "+919876543210",
  "params": ["Contact form", "Name: Asha | Phone: 98…"], "default_country_code": "91" }
```

`kind` is `owner` (2 params), `customer` (3 params, Pro only) or `test` (same template as owner). Responses: `200 {ok, message_id, usage}`, `400 invalid_phone|invalid_params`, `401/403` auth, `402 quota_exceeded|pro_required`, `502 send_failed` (quota refunded).

**GET `/api/user-status?email=…`** → `{ ok, plan, messages_used, monthly_limit, cycle_start, resets_at, features, prices }`

**POST `/api/create-checkout`** `{ "email": "…", "currency": "USD" | "INR" }` → `{ ok, url, subscription_id }`

**POST `/api/webhooks/razorpay`** called by Razorpay only, verified with HMAC-SHA256 over the raw body.

## Database

`supabase/schema.sql` creates (idempotent, safe to re-run):

- `formping.formping_users`: `email` PK, `plan`, `messages_used_this_month`, `billing_cycle_start`, `razorpay_subscription_id`, `created_at`, `updated_at`
- `formping.formping_message_logs`: `id`, `user_email`, `recipient_phone` (masked), `template_used`, `status`, `meta_message_id`, `error`, `created_at`
- `formping.formping_webhook_events`: webhook idempotency
- `increment_formping_usage(p_email, p_limit)`: creates the user if new, rolls the monthly window, and reserves one message under a row lock so concurrent submissions can't exceed the limit. Pass `p_limit = null` (what the API does) to derive the limit from the plan inside the same transaction; pass a number to override.
- `refund_formping_usage(p_email)`, `get_formping_status(p_email)`, `purge_formping_logs()`

RLS is on with no policies and `anon` / `authenticated` have no grants, so only the server's service-role key can read or write.

## Before going live

- Replace `support@formping.app` and the company name (`NEXT_PUBLIC_SUPPORT_EMAIL`, `NEXT_PUBLIC_COMPANY_NAME`) and have the Privacy Policy and Terms reviewed.
- Switch Razorpay to live keys, recreate the plans and webhook in live mode.
- Watch the WhatsApp number's quality rating in WhatsApp Manager; respondents who get auto-replies should have agreed to be contacted on WhatsApp.
- Schedule `formping.purge_formping_logs()` daily with Supabase Cron (command in `schema.sql`), since the Privacy Policy promises logs are kept no longer than 12 months.
