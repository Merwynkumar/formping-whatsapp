-- =============================================================================
-- FormPing WhatsApp: isolated database schema
-- -----------------------------------------------------------------------------
-- Everything lives in its own PostgreSQL schema `formping`, with `formping_`
-- prefixed tables. That keeps it isolated whether you run it in a brand-new
-- Supabase project (recommended) or, temporarily, in a shared free-tier one.
-- Nothing here reads or writes any other schema.
--
-- Only the Next.js backend talks to these tables, using the service_role key.
-- RLS is enabled with no policies, so anon/authenticated keys can read nothing.
--
-- Safe to re-run: every statement is idempotent.
-- =============================================================================

create schema if not exists formping;

-- -----------------------------------------------------------------------------
-- Users: one row per Google account that installed the add-on.
-- -----------------------------------------------------------------------------
create table if not exists formping.formping_users (
  email                    text primary key
                             check (email = lower(email) and position('@' in email) > 1),
  plan                     text not null default 'free'
                             check (plan in ('free', 'pro')),
  messages_used_this_month integer not null default 0
                             check (messages_used_this_month >= 0),
  billing_cycle_start      timestamptz not null default now(),
  razorpay_subscription_id text,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

create index if not exists formping_users_subscription_idx
  on formping.formping_users (razorpay_subscription_id);

-- -----------------------------------------------------------------------------
-- Message delivery log (one row per send attempt).
-- -----------------------------------------------------------------------------
create table if not exists formping.formping_message_logs (
  id               bigint generated always as identity primary key,
  user_email       text not null
                     references formping.formping_users (email) on delete cascade,
  recipient_phone  text not null,
  template_used    text not null,
  status           text not null
                     check (status in ('sent', 'failed', 'quota_exceeded', 'rejected')),
  meta_message_id  text,
  error            text,
  created_at       timestamptz not null default now()
);

create index if not exists formping_message_logs_user_created_idx
  on formping.formping_message_logs (user_email, created_at desc);

-- -----------------------------------------------------------------------------
-- Razorpay webhook idempotency (Razorpay retries deliveries).
-- -----------------------------------------------------------------------------
create table if not exists formping.formping_webhook_events (
  event_id    text primary key,
  event_type  text not null,
  received_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- Lock everything down: only service_role (server) may touch these objects.
-- -----------------------------------------------------------------------------
alter table formping.formping_users           enable row level security;
alter table formping.formping_message_logs    enable row level security;
alter table formping.formping_webhook_events  enable row level security;

revoke all on schema formping from anon, authenticated;
revoke all on all tables    in schema formping from anon, authenticated;
revoke all on all sequences in schema formping from anon, authenticated;
revoke all on all functions in schema formping from anon, authenticated, public;

grant usage on schema formping to service_role;
grant all on all tables    in schema formping to service_role;
grant all on all sequences in schema formping to service_role;

-- -----------------------------------------------------------------------------
-- Shared helper: roll the monthly quota window forward if it has elapsed.
-- Caller must already hold a row lock on the user.
-- -----------------------------------------------------------------------------
create or replace function formping._formping_roll_cycle(p_email text)
returns void
language plpgsql
security definer
set search_path = formping, pg_temp
as $$
declare
  v_start timestamptz;
begin
  select billing_cycle_start into v_start
    from formping.formping_users where email = p_email;

  if v_start is not null and v_start + interval '1 month' <= now() then
    -- Jump forward by whole months so the cycle day stays stable.
    while v_start + interval '1 month' <= now() loop
      v_start := v_start + interval '1 month';
    end loop;
    update formping.formping_users
       set messages_used_this_month = 0,
           billing_cycle_start      = v_start,
           updated_at               = now()
     where email = p_email;
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- increment_formping_usage(p_email, p_limit)
--   Atomically: create the user if new, roll the monthly window, and reserve
--   one message if used < p_limit. Concurrent submissions are serialised by
--   the row lock, so the limit can never be overshot.
--
--   If p_limit is NULL the limit is derived from the user's plan
--   (free = 25, pro = 1000), which avoids a read-then-write race.
--
--   Returns one row: allowed, plan, messages_used, monthly_limit, cycle_start.
-- -----------------------------------------------------------------------------
create or replace function formping.increment_formping_usage(p_email text, p_limit int default null)
returns table (
  allowed        boolean,
  plan           text,
  messages_used  integer,
  monthly_limit  integer,
  cycle_start    timestamptz
)
language plpgsql
security definer
set search_path = formping, pg_temp
as $$
declare
  v_email text := lower(trim(p_email));
  v_user  formping.formping_users%rowtype;
  v_limit integer;
begin
  if v_email is null or position('@' in v_email) < 2 then
    raise exception 'invalid email' using errcode = '22023';
  end if;

  insert into formping.formping_users (email) values (v_email)
  on conflict (email) do nothing;

  -- Row lock serialises concurrent increments for this user.
  perform 1 from formping.formping_users where email = v_email for update;
  perform formping._formping_roll_cycle(v_email);

  select * into v_user from formping.formping_users where email = v_email;

  v_limit := coalesce(p_limit, case v_user.plan when 'pro' then 1000 else 25 end);

  if v_user.messages_used_this_month >= v_limit then
    return query select false, v_user.plan, v_user.messages_used_this_month,
                        v_limit, v_user.billing_cycle_start;
    return;
  end if;

  update formping.formping_users
     set messages_used_this_month = messages_used_this_month + 1,
         updated_at = now()
   where email = v_email
  returning * into v_user;

  return query select true, v_user.plan, v_user.messages_used_this_month,
                      v_limit, v_user.billing_cycle_start;
end;
$$;

-- -----------------------------------------------------------------------------
-- refund_formping_usage(p_email)
--   Gives back a reserved message when Meta rejects the send, so users are
--   only charged quota for messages that actually left.
-- -----------------------------------------------------------------------------
create or replace function formping.refund_formping_usage(p_email text)
returns void
language sql
security definer
set search_path = formping, pg_temp
as $$
  update formping.formping_users
     set messages_used_this_month = greatest(messages_used_this_month - 1, 0),
         updated_at = now()
   where email = lower(trim(p_email));
$$;

-- -----------------------------------------------------------------------------
-- get_formping_status(p_email)
--   Read-only status for the sidebar. Creates the user on first call and
--   applies the monthly roll-over so the numbers shown are current.
-- -----------------------------------------------------------------------------
create or replace function formping.get_formping_status(p_email text)
returns table (
  plan           text,
  messages_used  integer,
  monthly_limit  integer,
  cycle_start    timestamptz
)
language plpgsql
security definer
set search_path = formping, pg_temp
as $$
declare
  v_email text := lower(trim(p_email));
  v_user  formping.formping_users%rowtype;
begin
  if v_email is null or position('@' in v_email) < 2 then
    raise exception 'invalid email' using errcode = '22023';
  end if;

  insert into formping.formping_users (email) values (v_email)
  on conflict (email) do nothing;

  perform 1 from formping.formping_users where email = v_email for update;
  perform formping._formping_roll_cycle(v_email);

  select * into v_user from formping.formping_users where email = v_email;

  return query select v_user.plan, v_user.messages_used_this_month,
                      case v_user.plan when 'pro' then 1000 else 25 end,
                      v_user.billing_cycle_start;
end;
$$;

revoke all on function formping._formping_roll_cycle(text)            from public, anon, authenticated;
revoke all on function formping.increment_formping_usage(text, int)   from public, anon, authenticated;
revoke all on function formping.refund_formping_usage(text)           from public, anon, authenticated;
revoke all on function formping.get_formping_status(text)             from public, anon, authenticated;

grant execute on function formping.increment_formping_usage(text, int) to service_role;
grant execute on function formping.refund_formping_usage(text)         to service_role;
grant execute on function formping.get_formping_status(text)           to service_role;

-- Make future objects in this schema follow the same rules.
alter default privileges in schema formping revoke all on tables    from anon, authenticated;
alter default privileges in schema formping revoke all on functions from public, anon, authenticated;
alter default privileges in schema formping grant  all on tables    to service_role;

-- -----------------------------------------------------------------------------
-- Retention: the Privacy Policy promises logs are kept up to 12 months.
-- Schedule once (Dashboard -> Integrations -> Cron, or SQL with pg_cron):
--   select cron.schedule('formping-purge-logs', '0 3 * * *',
--                        $$select formping.purge_formping_logs()$$);
-- -----------------------------------------------------------------------------
create or replace function formping.purge_formping_logs()
returns integer
language sql
security definer
set search_path = formping, pg_temp
as $$
  with d as (
    delete from formping.formping_message_logs
     where created_at < now() - interval '12 months'
    returning 1
  )
  select count(*)::int from d;
$$;

revoke all on function formping.purge_formping_logs() from public, anon, authenticated;
grant execute on function formping.purge_formping_logs() to service_role;
