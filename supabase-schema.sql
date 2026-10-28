-- Run once in the Supabase SQL Editor of your own project.
-- Only the authenticated owner can read/write their row. No service key in the browser.
create table if not exists public.castle_states (
  user_id uuid primary key references auth.users(id) on delete cascade,
  payload jsonb not null,
  updated_at timestamptz not null default now(),
  constraint castle_payload_limit check (octet_length(payload::text) <= 2000000)
);
alter table public.castle_states enable row level security;
revoke all on public.castle_states from anon;
grant select, insert, update on public.castle_states to authenticated;
drop policy if exists castle_owner_select on public.castle_states;
create policy castle_owner_select on public.castle_states for select to authenticated using ((select auth.uid())=user_id);
drop policy if exists castle_owner_insert on public.castle_states;
create policy castle_owner_insert on public.castle_states for insert to authenticated with check ((select auth.uid())=user_id);
drop policy if exists castle_owner_update on public.castle_states;
create policy castle_owner_update on public.castle_states for update to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);

create or replace function public.merge_castle_state(incoming jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  uid uuid := auth.uid();
  result jsonb;
  section text;
  entry record;
  old jsonb;
  incoming_n bigint;
  old_n bigint;
  incoming_d text;
  old_d text;
begin
  if uid is null then raise exception 'Authentication required'; end if;
  if incoming->>'version' is distinct from '2' or incoming->>'owner' is distinct from uid::text
    or jsonb_typeof(incoming->'visits') is distinct from 'object'
    or jsonb_typeof(incoming->'plans') is distinct from 'object'
    or octet_length(incoming::text)>2000000 then raise exception 'Invalid state'; end if;
  if (select count(*) from jsonb_object_keys(incoming->'visits'))>200
    or (select count(*) from jsonb_object_keys(incoming->'plans'))>1000 then raise exception 'Too many records'; end if;
  -- Create the owner's row, then serialize concurrent device merges with a row lock.
  insert into public.castle_states(user_id,payload) values(uid,jsonb_build_object('version',2,'owner',uid,'visits','{}'::jsonb,'plans','{}'::jsonb)) on conflict(user_id) do nothing;
  select payload into result from public.castle_states where user_id=uid for update;
  foreach section in array array['visits','plans'] loop
    for entry in select key,value from jsonb_each(incoming->section) loop
      if entry.key !~ '^[a-zA-Z0-9_-]{1,100}$' or entry.key in ('__proto__','constructor','prototype')
        or jsonb_typeof(entry.value) is distinct from 'object'
        or jsonb_typeof(entry.value->'s') is distinct from 'object'
        or coalesce(entry.value#>>'{s,n}','') !~ '^[0-9]{1,12}$'
        or coalesce(entry.value#>>'{s,d}','') !~ '^[a-zA-Z0-9_-]{1,80}$' then raise exception 'Invalid record'; end if;
      if section='visits' then
        if entry.key !~ '^[1-9][0-9]{0,2}$' or entry.key::integer>200 or not(entry.value ? 'date')
          or (entry.value->'date'<>'null'::jsonb and (jsonb_typeof(entry.value->'date')<>'string' or length(entry.value->>'date') not between 1 and 40)) then raise exception 'Invalid visit'; end if;
      else
        if jsonb_typeof(entry.value->'name') is distinct from 'string' or length(entry.value->>'name')>100
          or jsonb_typeof(entry.value->'date') is distinct from 'string' or (entry.value->>'date'<>'' and entry.value->>'date'!~ '^\d{4}-\d{2}-\d{2}$')
          or jsonb_typeof(entry.value->'origin') is distinct from 'string' or length(entry.value->>'origin')>200
          or jsonb_typeof(entry.value->'deleted') is distinct from 'boolean'
          or jsonb_typeof(entry.value->'stops') is distinct from 'array' then raise exception 'Invalid plan'; end if;
        if jsonb_array_length(entry.value->'stops')>200 then raise exception 'Too many stops'; end if;
        if exists(select 1 from jsonb_array_elements(entry.value->'stops') n where jsonb_typeof(n)<>'number' or n::text !~ '^([1-9][0-9]?|1[0-9]{2}|200)$') then raise exception 'Invalid castle'; end if;
        if (select count(*)<>count(distinct n) from jsonb_array_elements(entry.value->'stops') n) then raise exception 'Duplicate stops'; end if;
      end if;
      incoming_n := (entry.value#>>'{s,n}')::bigint; incoming_d := entry.value#>>'{s,d}';
      old := result->section->entry.key;
      old_n := coalesce((old#>>'{s,n}')::bigint,-1); old_d := coalesce(old#>>'{s,d}','');
      if old is null or incoming_n>old_n or (incoming_n=old_n and incoming_d collate "C">old_d collate "C") then
        result := jsonb_set(result,array[section,entry.key],entry.value,true);
      elsif incoming_n=old_n and incoming_d=old_d and section='visits' and incoming_n=0 then
        -- Deterministic legacy-date merge. Migration records are never deletions.
        if (entry.value->>'date') collate "C">coalesce(old->>'date','') collate "C" then result:=jsonb_set(result,array[section,entry.key],entry.value,true); end if;
      end if;
    end loop;
  end loop;
  if (select count(*) from jsonb_object_keys(result->'plans'))>1000 then raise exception 'Too many plans'; end if;
  update public.castle_states set payload=result,updated_at=now() where user_id=uid;
  return result;
end;
$$;
revoke all on function public.merge_castle_state(jsonb) from public, anon;
grant execute on function public.merge_castle_state(jsonb) to authenticated;
