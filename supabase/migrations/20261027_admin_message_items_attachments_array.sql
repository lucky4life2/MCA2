-- Staff-inbox attachments must be an array (Strix finding 8, DB half,
-- 2026-10-27).
--
-- NOT APPLIED — migration file only. Apply by hand in the Supabase
-- dashboard SQL editor.
--
-- Problem: admin_message_items.attachments is written from the client
-- (admin.html / account.html insert the array they built from uploads),
-- and nothing on the database side stops a malformed value — e.g. a bare
-- string — from landing in the column. The renderers used to throw on
-- such a value and kill the whole inbox render; the renderers are now
-- guarded in code (admin.html / account.html renderMsgAttachments), and
-- this constraint is the second half: malformed values cannot be stored
-- in the first place.
--
-- The DO block below only adds the constraint when the column exists
-- and is jsonb (the shape PostgREST stores a JS array in). If the live
-- column is some other type, it raises a notice instead of failing the
-- whole migration — check the notice and write the matching constraint
-- for that type rather than forcing this one.

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'admin_message_items'
      and column_name = 'attachments'
      and data_type = 'jsonb'
  ) then
    alter table public.admin_message_items
      drop constraint if exists admin_message_items_attachments_is_array;
    alter table public.admin_message_items
      add constraint admin_message_items_attachments_is_array
      check (attachments is null or jsonb_typeof(attachments) = 'array');
  else
    raise notice 'admin_message_items.attachments is not jsonb (or the table/column does not exist); constraint not added — inspect the live column type first';
  end if;
end $$;
