-- StudyDesk's point-based university assessments live separately from the
-- legacy grades table. Existing GPA rows are deliberately left untouched.
create table if not exists public.grade_activities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  subject_id uuid not null references public.subjects(id) on delete cascade,
  academic_cut smallint not null check (academic_cut in (1, 2, 3)),
  title text not null check (length(btrim(title)) > 0),
  earned_points numeric(8, 2),
  max_points numeric(8, 2) not null check (max_points > 0),
  status text not null check (status in ('pending', 'awaiting_grade', 'graded')),
  date date not null default current_date,
  allow_over_capacity boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint grade_activities_score_matches_status check (
    (status = 'graded' and earned_points is not null and earned_points >= 0 and earned_points <= max_points)
    or (status in ('pending', 'awaiting_grade') and earned_points is null)
  )
);

create index if not exists grade_activities_user_subject_idx
  on public.grade_activities (user_id, subject_id);

create unique index if not exists grade_activities_no_duplicate_live_title
  on public.grade_activities (user_id, subject_id, academic_cut, lower(btrim(title)))
  where deleted_at is null;

alter table public.grade_activities enable row level security;

create policy grade_activities_select on public.grade_activities
  for select to authenticated using ((select auth.uid()) = user_id);
create policy grade_activities_insert on public.grade_activities
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy grade_activities_update on public.grade_activities
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy grade_activities_delete on public.grade_activities
  for delete to authenticated using ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.grade_activities to authenticated;

drop trigger if exists grade_activities_set_updated_at on public.grade_activities;
create trigger grade_activities_set_updated_at
  before insert or update on public.grade_activities
  for each row execute function public.set_updated_at();

drop trigger if exists zz_skip_noop_update on public.grade_activities;
create trigger zz_skip_noop_update
  before update on public.grade_activities
  for each row execute function public.skip_noop_update();

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'grade_activities'
  ) then
    alter publication supabase_realtime add table public.grade_activities;
  end if;
end;
$$;
