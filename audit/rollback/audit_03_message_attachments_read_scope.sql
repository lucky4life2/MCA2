-- Rollback for audit_03_message_attachments_read_scope (2026-09-24).
-- Restores the pre-audit storage read policy (captured from pg_policies).
ALTER POLICY "scoped read message attachments" ON storage.objects
  USING ((bucket_id = 'message-attachments'::text) AND (((storage.foldername(name))[1] = (( SELECT auth.uid() AS uid))::text) OR user_has_permission('can_manage_users'::text) OR (EXISTS ( SELECT 1
   FROM (admin_message_items ami
     JOIN admin_messages am ON ((am.id = ami.thread_id)))
  WHERE ((am.user_id = ( SELECT auth.uid() AS uid)) AND ((ami.attachments)::text ~~ (('%'::text || objects.name) || '%'::text)))))));
