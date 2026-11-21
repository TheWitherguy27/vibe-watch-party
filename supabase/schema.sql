-- VIBE schema. Enable Anonymous Sign-ins in Supabase Auth settings, then run this file.
create extension if not exists pgcrypto;

create table if not exists public.parties (
  id uuid primary key default gen_random_uuid(),
  code char(6) unique not null,
  name text not null default 'Watch Party',
  host_id uuid not null,
  current_video_id text,
  playback_state jsonb not null default '{"playing":false,"position":0,"updated_at":null}'::jsonb,
  is_locked boolean not null default false,
  participant_limit int not null default 12 check (participant_limit between 2 and 100),
  created_at timestamptz not null default now()
);
create table if not exists public.party_members (
  id uuid primary key default gen_random_uuid(),
  party_id uuid not null references public.parties(id) on delete cascade,
  user_id uuid not null,
  username text not null,
  role text not null default 'guest' check (role in ('host','moderator','guest')),
  online boolean not null default true,
  joined_at timestamptz not null default now(),
  unique(party_id,user_id)
);
create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  party_id uuid not null references public.parties(id) on delete cascade,
  user_id uuid not null,
  username text not null,
  body text not null check (char_length(body) between 1 and 1000),
  created_at timestamptz not null default now()
);
create table if not exists public.video_queue (
  id uuid primary key default gen_random_uuid(),
  party_id uuid not null references public.parties(id) on delete cascade,
  video_id text not null check (video_id ~ '^[A-Za-z0-9_-]{11}$'),
  title text not null default 'YouTube video',
  added_by text not null,
  position int not null default 0,
  created_at timestamptz not null default now()
);

-- SECURITY DEFINER helper avoids recursive RLS policy evaluation.
create or replace function public.is_party_member(p_party_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.party_members m
    where m.party_id=p_party_id and m.user_id=auth.uid() and m.online)
$$;
create or replace function public.is_party_moderator(p_party_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.party_members m
    where m.party_id=p_party_id and m.user_id=auth.uid() and m.online and m.role in ('host','moderator'))
$$;

create or replace function public.create_party(p_name text, p_username text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_uid uuid := auth.uid(); v_party public.parties; v_member public.party_members; v_code text;
begin
  if v_uid is null then raise exception 'Sign in anonymously before creating a party'; end if;
  loop
    v_code := lpad((floor(random()*1000000))::int::text,6,'0');
    exit when not exists(select 1 from public.parties where code=v_code);
  end loop;
  insert into public.parties(code,name,host_id) values(v_code,left(coalesce(nullif(trim(p_name),''),'Watch Party'),70),v_uid) returning * into v_party;
  insert into public.party_members(party_id,user_id,username,role)
    values(v_party.id,v_uid,left(coalesce(nullif(trim(p_username),''),'Host'),24),'host') returning * into v_member;
  return jsonb_build_object('party',to_jsonb(v_party),'member',to_jsonb(v_member));
end $$;

create or replace function public.join_party(p_code text, p_username text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_party public.parties; v_member public.party_members; v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Sign in anonymously before joining a party'; end if;
  select * into v_party from public.parties where code=right('000000'||trim(p_code),6);
  if not found then raise exception 'Party not found'; end if;
  if v_party.is_locked then raise exception 'This party is locked'; end if;
  if (select count(*) from public.party_members where party_id=v_party.id and online) >= v_party.participant_limit then raise exception 'This party is full'; end if;
  insert into public.party_members(party_id,user_id,username)
    values(v_party.id,v_uid,left(coalesce(nullif(trim(p_username),''),'Guest'),24))
    on conflict(party_id,user_id) do update set online=true,username=excluded.username
    returning * into v_member;
  return jsonb_build_object('party',to_jsonb(v_party),'member',to_jsonb(v_member));
end $$;

alter table public.parties enable row level security;
alter table public.party_members enable row level security;
alter table public.chat_messages enable row level security;
alter table public.video_queue enable row level security;

create policy "members read parties" on public.parties for select using (public.is_party_member(id));
create policy "hosts and mods update parties" on public.parties for update
  using (public.is_party_moderator(id)) with check (public.is_party_moderator(id));

create policy "members read roster" on public.party_members for select using (public.is_party_member(party_id));
create policy "users update own presence" on public.party_members for update
  using (user_id=auth.uid()) with check (user_id=auth.uid());

create policy "members read chat" on public.chat_messages for select using (public.is_party_member(party_id));
create policy "members send own chat" on public.chat_messages for insert
  with check (user_id=auth.uid() and public.is_party_member(party_id));

create policy "members read queue" on public.video_queue for select using (public.is_party_member(party_id));
create policy "members add queue" on public.video_queue for insert
  with check (public.is_party_member(party_id));
create policy "hosts manage queue" on public.video_queue for delete
  using (public.is_party_moderator(party_id));

grant usage on schema public to anon, authenticated;
grant select,update on public.parties to anon,authenticated;
grant select,update on public.party_members to anon,authenticated;
grant select,insert on public.chat_messages to anon,authenticated;
grant select,insert,delete on public.video_queue to anon,authenticated;
grant execute on function public.create_party(text,text) to anon,authenticated;
grant execute on function public.join_party(text,text) to anon,authenticated;
grant execute on function public.is_party_member(uuid) to anon,authenticated;
grant execute on function public.is_party_moderator(uuid) to anon,authenticated;

do $$ begin alter publication supabase_realtime add table public.parties;
exception when duplicate_object then null; when undefined_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.party_members;
exception when duplicate_object then null; when undefined_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.chat_messages;
exception when duplicate_object then null; when undefined_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.video_queue;
exception when duplicate_object then null; when undefined_object then null; end $$;
