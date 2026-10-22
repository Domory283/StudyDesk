-- v1.18.2 — the grade scale follows the account (StudyDesk writes, NCC reads).
-- APPLIED to production 2026-10-22 (history version 20261022064407).
--
-- StudyDesk kept its grade mode and custom scale in localStorage only, so NCC
-- guessed the scale from the numbers and showed a German 1–6 average as "/7".
-- Shape (written by src/lib/gradeScaleCloud.js):
--   { "v": 1, "mode": "ib" | "us" | "custom",
--     "custom": { "min", "max", "passMark", "direction", "name" } | null,
--     "updatedAt": "<ISO>" }
--
-- user_preferences uses column-level grants, so the new column needs its own.
-- RLS ("Users manage own prefs", auth.uid() = user_id) already covers it.

alter table public.user_preferences
  add column if not exists grade_scale jsonb;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'user_preferences_grade_scale_shape'
      and conrelid = 'public.user_preferences'::regclass
  ) then
    alter table public.user_preferences
      add constraint user_preferences_grade_scale_shape check (
        grade_scale is null or (
          jsonb_typeof(grade_scale) = 'object'
          and grade_scale ->> 'mode' in ('ib', 'us', 'custom')
          and pg_column_size(grade_scale) <= 1024
        )
      );
  end if;
end $$;

grant select (grade_scale), insert (grade_scale), update (grade_scale)
  on public.user_preferences to authenticated;
