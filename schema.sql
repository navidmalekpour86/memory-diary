-- Run once in Supabase: Dashboard > SQL Editor > New query > paste > Run.
-- First edit the two emails and names at the bottom to yours and your partner's.

create table public.members (
  email text primary key,
  name text not null            -- shown next to each person's scores
);

create table public.memories (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  happened_on date not null,
  place_type text not null default 'other',
  place_name text,
  note text,
  lat double precision,
  lng double precision,
  created_by uuid default auth.uid() references auth.users,
  created_at timestamptz not null default now()
);

create table public.photos (
  id uuid primary key default gen_random_uuid(),
  memory_id uuid not null references public.memories on delete cascade,
  path text not null,
  created_at timestamptz not null default now()
);

-- Only emails listed in members can read or write anything,
-- even if someone else manages to create an account.
create function public.is_member() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.members where lower(email) = lower(auth.jwt() ->> 'email'))
$$;

-- Each person's own 1–5 score per criterion (criteria depend on place type, see strings.js).
create table public.ratings (
  memory_id uuid not null references public.memories on delete cascade,
  user_id uuid not null default auth.uid() references auth.users,
  user_email text not null default (auth.jwt() ->> 'email'),
  criterion text not null,
  score smallint not null check (score between 1 and 5),
  primary key (memory_id, user_id, criterion)
);

alter table public.members  enable row level security;
alter table public.ratings  enable row level security;
alter table public.memories enable row level security;
alter table public.photos   enable row level security;

create policy "members only" on public.memories for all to authenticated
  using (public.is_member()) with check (public.is_member());
create policy "members only" on public.photos for all to authenticated
  using (public.is_member()) with check (public.is_member());

create policy "members read names" on public.members for select to authenticated
  using (public.is_member());
-- Both can see all scores, but each person can only write their own.
create policy "members read scores" on public.ratings for select to authenticated
  using (public.is_member());
create policy "own scores insert" on public.ratings for insert to authenticated
  with check (public.is_member() and user_id = auth.uid());
create policy "own scores update" on public.ratings for update to authenticated
  using (public.is_member() and user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own scores delete" on public.ratings for delete to authenticated
  using (public.is_member() and user_id = auth.uid());

-- Private bucket: photos are only reachable through short-lived signed links.
insert into storage.buckets (id, name, public) values ('photos', 'photos', false);

create policy "members only" on storage.objects for all to authenticated
  using (bucket_id = 'photos' and public.is_member())
  with check (bucket_id = 'photos' and public.is_member());

-- >>> Change these to your two emails and names <<<
insert into public.members (email, name) values
  ('you@example.com', 'Navid'),
  ('partner@example.com', 'Sanaz');
