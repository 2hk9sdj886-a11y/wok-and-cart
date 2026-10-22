-- Wok & Cart: run once in Supabase → SQL Editor.
-- One row per signed-in user holding their list, calorie log and settings.
create table if not exists public.planner_state (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  rev bigint not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.planner_state enable row level security;

-- Each person can only see and change their own row.
create policy "read own"   on public.planner_state for select to authenticated using ((select auth.uid()) = user_id);
create policy "insert own" on public.planner_state for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "update own" on public.planner_state for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

grant select, insert, update on public.planner_state to authenticated;

-- Optional (the app polls instead of using realtime, but this is harmless):
alter publication supabase_realtime add table public.planner_state;
