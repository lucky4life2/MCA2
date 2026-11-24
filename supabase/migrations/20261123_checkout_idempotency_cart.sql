-- Stress-test items 1 + 19 (2026-11-23): checkout idempotency + two-phone cart.
--
-- Two gaps, one fix at the data layer:
--  * Item 1 — the idempotency key was per-click and never persisted, so a
--    retry / refresh / second tab / back->cancel->checkout again minted a
--    new Stripe Checkout Session for the same cart, and a paid duplicate
--    goods session had no auto-refund (membership already had one).
--    `checkout_intents` persists ONE intent per (user, cart hash): the
--    edge function reuses the stored Stripe session instead of creating
--    a second one, and `orders.cart_hash` lets the webhook recognise a
--    second paid session for the same cart as a duplicate and refund it.
--  * Item 19 — the cart lived only in per-device localStorage
--    (`mca_cart_<userId>`), so phone B never saw phone A's cart and a
--    cart paid on phone A stayed payable on phone B. `carts` is the
--    server-side cart: one row per user, the source of truth the shop
--    page syncs to (localStorage remains only as an offline cache).
--
-- TEST project first; the live fix goes via the PR that carries this file.
-- IDEMPOTENT / SAFE TO RE-RUN: every statement uses IF NOT EXISTS /
-- DROP ... IF EXISTS, so re-applying changes nothing the second time.
-- Nothing here touches live data: carts start empty and are filled by
-- the shop page on next visit; checkout_intents starts empty.

-- ── Server-side cart (item 19) ─────────────────────────────────────
create table if not exists public.carts (
  user_id uuid primary key references auth.users (id) on delete cascade,
  -- [{ id, name, price, image_url, product_type, billing_cycle, qty }]
  -- exactly the shape shop.page.js keeps in localStorage today, so the
  -- server row and the local cache are interchangeable.
  items jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  -- Set when this device/user completes a checkout (success return):
  -- lets another device tell "cart was paid elsewhere" apart from
  -- "cart was emptied on purpose" when it refetches an empty cart.
  last_checkout_at timestamptz
);

alter table public.carts enable row level security;

drop policy if exists carts_select_own on public.carts;
create policy carts_select_own on public.carts
  for select using (auth.uid() = user_id);

drop policy if exists carts_insert_own on public.carts;
create policy carts_insert_own on public.carts
  for insert with check (auth.uid() = user_id);

drop policy if exists carts_update_own on public.carts;
create policy carts_update_own on public.carts
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists carts_delete_own on public.carts;
create policy carts_delete_own on public.carts
  for delete using (auth.uid() = user_id);

-- ── Checkout intents (item 1) ──────────────────────────────────────
-- One row per (user, cart hash). The edge function (service role only;
-- no client RLS policies by design) looks this up before creating a
-- Stripe session: a recent row with a still-open session means "return
-- that session's URL", not "create a second payable session".
-- cart_hash is a SHA-256 hex of the sorted "product_id:qty" pairs, so
-- the same goods in a different order, or a changed quantity, is a
-- different intent — only a byte-identical cart reuses a session.
-- Rows older than 24h are ignored by the edge function (Stripe sessions
-- expire after ~24h by default); stale rows are harmless and may be
-- swept by a later cleanup job, not by this migration.
create table if not exists public.checkout_intents (
  user_id uuid not null references auth.users (id) on delete cascade,
  cart_hash text not null,
  idempotency_key text not null,
  stripe_session_id text,
  created_at timestamptz not null default now(),
  primary key (user_id, cart_hash)
);

alter table public.checkout_intents enable row level security;
-- No policies: only the service-role edge functions read/write this
-- table. A client must never be able to forge or reuse another user's
-- intent row, and it has no legitimate read of its own row either
-- (the edge function returns the session URL).

-- ── Cart hash on orders (item 1, webhook duplicate-goods refund) ───
-- orders lives outside the repo's migration history (no CREATE TABLE in
-- the repo), so add the column defensively; the webhook and the
-- TEST_CHECKOUT_MODE path write it, and the webhook reads it back to
-- spot a second paid goods order for the same user + same cart.
alter table public.orders
  add column if not exists cart_hash text;

create index if not exists orders_user_cart_hash_created_idx
  on public.orders (user_id, cart_hash, created_at desc);
