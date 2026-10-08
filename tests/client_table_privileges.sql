-- Run after 20261008_revoke_client_ddl_privileges.sql with:
-- psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/client_table_privileges.sql
-- Read-only assertion of effective privileges, including role inheritance.
begin;
do $$
declare
  unwanted record;
begin
  for unwanted in
    select r.role_name, n.nspname, c.relname, p.privilege
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    cross join (values ('anon'), ('authenticated')) r(role_name)
    cross join (values ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) p(privilege)
    where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'f')
      and has_table_privilege(r.role_name, c.oid, p.privilege)
  loop
    raise exception 'Unexpected privilege: % has % on %.%',
      unwanted.role_name, unwanted.privilege, unwanted.nspname, unwanted.relname;
  end loop;
end;
$$;
rollback;
