-- Self-service account lifecycle (Strix finding 7, 2026-10-27).
--
-- NOT APPLIED — migration file only. Apply by hand in the Supabase
-- dashboard SQL editor after diffing against the live function.
--
-- Problem: deactivate_own_account and schedule_own_account_deletion fail
-- because private.profiles_guard_columns() (20260910 shop/membership
-- hardening) rejects any client-path change to account_status,
-- deletion_scheduled_at, or deactivated_at.
--
-- Fix: this file replaces that function with the repo's 20260910 copy
-- plus a narrow owner-only carve-out (see the comment inside). Everything
-- else in the function is unchanged. The RPC sources themselves are not
-- in this repo, so before applying, confirm the live function still
-- matches the 20260910 copy below — if it has drifted, port the
-- carve-out block into the live version instead of overwriting it.
-- Also confirm the two RPCs do not have a second, separate guard (RLS
-- policy or their own check) that would still reject the update; this
-- migration only fixes the trigger.
--
-- What stays staff/server-only: frozen and terminated in both directions,
-- every transition out of deactivated / pending_deletion, and all other
-- server-only fields.

create or replace function private.profiles_guard_columns()
returns trigger
language plpgsql
set search_path to 'pg_catalog'
as $function$
declare
  v_is_self  boolean;
  v_is_staff boolean;
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  v_is_self  := auth.uid() = old.id;
  v_is_staff := private.get_my_role() = any(array['admin','owner'])
                or public.user_has_permission('can_manage_users')
                or public.user_has_permission('can_manage_minecraft');

  -- Never client-writable, by anyone: real credentials/tokens (always
  -- issued and consumed server-side) and fields every RPC that touches them
  -- already exists specifically to gate.
  if new.password_reset_token    is distinct from old.password_reset_token
  or new.password_reset_expires  is distinct from old.password_reset_expires
  or new.password_reset_attempts is distinct from old.password_reset_attempts
  or new.pending_email           is distinct from old.pending_email
  or new.pending_email_token     is distinct from old.pending_email_token
  or new.pending_email_expires   is distinct from old.pending_email_expires
  or new.pending_email_attempts  is distinct from old.pending_email_attempts
  or new.role                    is distinct from old.role
  or new.email_access_revoked    is distinct from old.email_access_revoked
  or new.minecraft_uuid          is distinct from old.minecraft_uuid
  or new.email                   is distinct from old.email
  or new.email_unsub_token       is distinct from old.email_unsub_token
  then
    raise exception 'profiles: that field can only be changed by the server';
  end if;


  -- Self-service account lifecycle (Strix finding 7, 2026-10-27): the row
  -- owner may move their own account into 'deactivated' (via
  -- deactivate_own_account) or 'pending_deletion' (via
  -- schedule_own_account_deletion). Those RPCs run as the caller, so
  -- without this carve-out the trigger below rejects their updates and
  -- both self-service flows fail. The carve-out is deliberately narrow:
  --   * only the owner (v_is_self), never staff on someone else's row;
  --   * only INTO deactivated / pending_deletion, only FROM active (or
  --     from deactivated into pending_deletion) — a frozen or terminated
  --     row cannot be moved by its owner at all, and no transition OUT
  --     of deactivated / pending_deletion is allowed here;
  --   * only account_status and its two timestamp companions may change
  --     in the same statement — every other server-only field in the
  --     block below still raises.
  -- frozen / terminated stay staff/server-only: nothing here lets a
  -- client write those values, in either direction.
  if new.account_status          is distinct from old.account_status
  or new.deletion_scheduled_at   is distinct from old.deletion_scheduled_at
  or new.deactivated_at          is distinct from old.deactivated_at
  then
    if not (
      v_is_self
      and (
        (old.account_status = 'active'       and new.account_status = 'deactivated')
        or (old.account_status = 'active'       and new.account_status = 'pending_deletion')
        or (old.account_status = 'deactivated'  and new.account_status = 'pending_deletion')
      )
      and new.password_reset_token    is not distinct from old.password_reset_token
      and new.password_reset_expires  is not distinct from old.password_reset_expires
      and new.password_reset_attempts is not distinct from old.password_reset_attempts
      and new.pending_email           is not distinct from old.pending_email
      and new.pending_email_token     is not distinct from old.pending_email_token
      and new.pending_email_expires   is not distinct from old.pending_email_expires
      and new.pending_email_attempts  is not distinct from old.pending_email_attempts
      and new.role                    is not distinct from old.role
      and new.email_access_revoked    is not distinct from old.email_access_revoked
      and new.minecraft_uuid          is not distinct from old.minecraft_uuid
      and new.email                   is not distinct from old.email
      and new.email_unsub_token       is not distinct from old.email_unsub_token
    ) then
      raise exception 'profiles: that field can only be changed by the server';
    end if;
  end if;

  -- The remaining server-only fields from the original block (account_status
  -- and its timestamps are handled by the carve-out above).
  if new.password_reset_token    is distinct from old.password_reset_token
  or new.password_reset_expires  is distinct from old.password_reset_expires
  or new.password_reset_attempts is distinct from old.password_reset_attempts
  or new.pending_email           is distinct from old.pending_email
  or new.pending_email_token     is distinct from old.pending_email_token
  or new.pending_email_expires   is distinct from old.pending_email_expires
  or new.pending_email_attempts  is distinct from old.pending_email_attempts
  or new.role                    is distinct from old.role
  or new.email_access_revoked    is distinct from old.email_access_revoked
  or new.minecraft_uuid          is distinct from old.minecraft_uuid
  or new.email                   is distinct from old.email
  or new.email_unsub_token       is distinct from old.email_unsub_token
  then
    raise exception 'profiles: that field can only be changed by the server';
  end if;

  -- Membership is money: it is written by the Stripe webhook (service_role)
  -- or by admin_set_membership() (SECURITY DEFINER, gated on
  -- can_manage_memberships), never by a client update — not even a staff
  -- one, which would otherwise be an unaudited way around that RPC.
  if new.membership_status             is distinct from old.membership_status
  or new.membership_source             is distinct from old.membership_source
  or new.membership_current_period_end is distinct from old.membership_current_period_end
  or new.stripe_customer_id            is distinct from old.stripe_customer_id
  or new.stripe_subscription_id        is distinct from old.stripe_subscription_id
  then
    raise exception 'profiles: membership and billing fields can only be changed by the server';
  end if;

  -- mc_verify_code / mc_verify_expires: only the row owner may set these
  -- (a self-chosen verification nonce -- not a privilege by itself).
  if (new.mc_verify_code is distinct from old.mc_verify_code
      or new.mc_verify_expires is distinct from old.mc_verify_expires)
     and not v_is_self
  then
    raise exception 'profiles: mc_verify_code can only be set by its owner';
  end if;

  -- minecraft_verified: staff may flip this on someone else's row (the
  -- admin approve/revoke Minecraft-link buttons); nobody may set it on
  -- their own row directly.
  if new.minecraft_verified is distinct from old.minecraft_verified and not v_is_staff then
    raise exception 'profiles: minecraft_verified can only be changed by staff';
  end if;

  -- discord_id / google_id: self may only clear (unlink) their own link,
  -- never set it to an arbitrary value directly.
  if new.discord_id is distinct from old.discord_id and new.discord_id is not null then
    raise exception 'profiles: discord_id can only be cleared, not set, directly';
  end if;
  if new.google_id is distinct from old.google_id and new.google_id is not null then
    raise exception 'profiles: google_id can only be cleared, not set, directly';
  end if;

  return new;
end;
$function$;
