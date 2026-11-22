-- MCA security audit (run-1, 2026-11-12) — MEDIUM news-publish.page.js:coauthor:news_upd-author-id-escalation
--
-- The live news_upd policy (supabase/migrations/20261018_news_coauthors.sql,
-- verified verbatim 2026-11-12) evaluates its WITH CHECK on the NEW row only
-- and never compares NEW author_id / coauthor_ids to OLD. A listed coauthor
-- holding can_manage_news could therefore issue a direct update setting
-- author_id to themselves and clearing coauthor_ids, seizing sole authorship
-- and locking the original author out of the USING clause.
--
-- WITH CHECK alone cannot see OLD, so the guard is a BEFORE UPDATE trigger
-- that complements the policy: a caller who is not an approver
-- (can_approve_news) and is not the article's current author may not change
-- author_id or coauthor_ids at all. Approvers stay exempt (they may reassign
-- authorship), and the current author stays exempt (they may hand authorship
-- off or manage their own coauthor list). Ordinary content edits that leave
-- both authorship columns untouched pass through unchanged.
--
-- The trigger exempts calls with no JWT uid (auth.uid() IS NULL): RLS does
-- not apply to service_role / postgres callers, but triggers do fire for
-- them, and server-side authorship writes are governed outside RLS.
-- The existing news_upd policy is NOT changed.
--
-- APPLY: run once against live Supabase (migration workflow). Reversible by
-- dropping the trigger and function.
create or replace function public.fn_news_no_authorship_transfer()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if auth.uid() is null then
    return new;
  end if;
  if new.author_id is distinct from old.author_id
     or new.coauthor_ids is distinct from old.coauthor_ids then
    if not user_has_permission('can_approve_news')
       and old.author_id is distinct from auth.uid() then
      raise exception 'only an approver or the current author may change article authorship';
    end if;
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_news_no_authorship_transfer on public.news_articles;
create trigger trg_news_no_authorship_transfer
  before update of author_id, coauthor_ids on public.news_articles
  for each row execute function public.fn_news_no_authorship_transfer();
