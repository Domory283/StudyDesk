// v1.9 Item 14a — analytics over data StudyDesk already holds.
//
// Pure module, no React. Three readings the build plan asks for: grades over
// time per subject, a study-time heatmap, and whether study time and grades
// actually move together.
//
// The honesty rule running through all of it: a student's grade history is a
// SMALL sample. Four grades in a course is normal. Statistics that are routine
// on thousands of rows are noise on four, so every function here reports its
// own sample size and the correlation refuses to draw a conclusion it cannot
// support. A dashboard that says "your study time strongly predicts your
// grades" off five points is not a feature, it is a lie with a chart on it.

import { parseLocalDate, toLocalISO, addDays } from './dates.js';
import { startOfWeek } from './calendar.js';

/** Per-subject series of graded activities, oldest first, carrying cumulative
 *  points earned up to each activity. Legacy GPA rows are intentionally excluded. */
export function gradeSeries(state) {
  const out = [];
  const courses = state.courses || {};
  for (const id of Object.keys(courses)) {
    const c = courses[id];
    if (!c || c.deletedAt) continue;
    const activities = (state.gradeActivities || [])
      .filter((activity) => !activity.deletedAt && activity.subjectId === id
        && activity.status === 'graded' && activity.date
        && Number.isFinite(Number(activity.earnedPoints)))
      .sort((a, b) => String(a.date).localeCompare(String(b.date)));
    if (!activities.length) continue;
    let total = 0;
    const running = activities.map((activity) => {
      total += Number(activity.earnedPoints);
      return {
        date: activity.date,
        grade: Number(activity.earnedPoints),
        maxPoints: Number(activity.maxPoints),
        mean: Math.round((total + Number.EPSILON) * 100) / 100,
      };
    });
    out.push({
      courseId: id,
      name: c.name,
      color: c.color || null,
      points: running,
      latest: total,
      first: running[0].mean,
      n: running.length,
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** Daily study minutes for roughly the last `days` days, ending today.
 *
 *  The window is SNAPPED BACK to a week boundary, so the first column of the
 *  heatmap is always a full week. Starting it on whatever weekday fell 182
 *  days ago left a ragged first column — a lone square sitting by itself with
 *  an empty cell above it, which reads as a rendering fault rather than as
 *  "this window began mid-week". Snapping costs at most six extra days.
 *
 *  Rows are ordered from `weekStart` for the same reason the calendar grid is:
 *  a Monday-start reader should not get Sunday-first rows.
 *
 *  Returns a dense array — every day present, zeros included — because a
 *  heatmap with missing days silently compresses the calendar and the gaps
 *  ARE the information. */
export function studyHeatmap(state, days = 182, today = toLocalISO(new Date()), weekStart = 1) {
  const byDay = new Map();
  for (const s of state.studySessions || []) {
    if (s.deletedAt || !s.startedAt) continue;
    const iso = toLocalISO(new Date(s.startedAt));
    byDay.set(iso, (byDay.get(iso) || 0) + (Number(s.durationMinutes) || 0));
  }
  const start = startOfWeek(addDays(today, -(days - 1)), weekStart);
  const cells = [];
  let max = 0;
  // Run to today inclusive rather than for a fixed count: the snap moved the
  // start, and a fixed count would then overshoot into future days.
  for (let iso = start; iso <= today; iso = addDays(iso, 1)) {
    const minutes = byDay.get(iso) || 0;
    if (minutes > max) max = minutes;
    cells.push({
      iso,
      minutes,
      // Row index within the column, already rotated for the week start.
      weekday: (parseLocalDate(iso).getDay() - weekStart + 7) % 7,
    });
  }
  // Five levels, keyed off the busiest day in the window rather than an
  // absolute scale: an hour a day is a lot for one student and little for
  // another, and a fixed scale would render one of them a blank grid.
  for (const cell of cells) {
    cell.level = cell.minutes === 0 ? 0 : Math.min(4, Math.ceil((cell.minutes / max) * 4));
  }
  return { cells, max, total: cells.reduce((n, c) => n + c.minutes, 0), start, end: today };
}

/** Pearson r. Returns null rather than a number when the sample cannot
 *  support one, or when either series is constant (zero variance — where the
 *  formula divides by zero and a naive implementation returns NaN). */
export function pearson(xs, ys) {
  const n = Math.min(xs.length, ys.length);
  if (n < 3) return null;
  let sx = 0, sy = 0;
  for (let i = 0; i < n; i += 1) { sx += xs[i]; sy += ys[i]; }
  const mx = sx / n, my = sy / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i += 1) {
    const a = xs[i] - mx, b = ys[i] - my;
    num += a * b; dx += a * a; dy += b * b;
  }
  if (dx === 0 || dy === 0) return null;
  return num / Math.sqrt(dx * dy);
}

/** Study time in the 21 days before each graded activity, paired with the
 *  points earned for that activity.
 *
 *  The window matters and is a real modelling choice: total study time over a
 *  whole course correlates with nothing useful, because a course you study a
 *  lot for is often simply a long course. Time spent shortly BEFORE a
 *  particular result is the thing a student can act on.
 */
export function studyVsGrades(state, windowDays = 21) {
  const sessions = (state.studySessions || [])
    .filter((s) => !s.deletedAt && s.startedAt)
    .map((s) => ({ iso: toLocalISO(new Date(s.startedAt)), subjectId: s.subjectId, minutes: Number(s.durationMinutes) || 0 }));

  const pairs = [];
  for (const activity of state.gradeActivities || []) {
    if (activity.deletedAt || activity.status !== 'graded' || !activity.date
      || !Number.isFinite(Number(activity.earnedPoints))) continue;
    const from = addDays(activity.date, -windowDays);
    let minutes = 0;
    for (const s of sessions) {
      if (s.subjectId === activity.subjectId && s.iso >= from && s.iso <= activity.date) minutes += s.minutes;
    }
    pairs.push({
      subjectId: activity.subjectId,
      date: activity.date,
      grade: Number(activity.earnedPoints),
      maxPoints: Number(activity.maxPoints),
      minutes,
    });
  }

  // Grades from different courses are on different scales in the same units
  // only by accident, so the correlation is computed per subject and only
  // where that subject has enough points to mean anything.
  const bySubject = new Map();
  for (const p of pairs) {
    if (!bySubject.has(p.subjectId)) bySubject.set(p.subjectId, []);
    bySubject.get(p.subjectId).push(p);
  }
  const perSubject = [];
  for (const [subjectId, ps] of bySubject) {
    const course = state.courses?.[subjectId];
    if (!course || course.deletedAt) continue;
    perSubject.push({
      subjectId,
      name: course.name,
      color: course.color || null,
      n: ps.length,
      r: pearson(ps.map((p) => p.minutes), ps.map((p) => p.grade)),
      points: ps.sort((a, b) => a.date.localeCompare(b.date)),
    });
  }
  return { windowDays, perSubject: perSubject.sort((a, b) => a.name.localeCompare(b.name)), pairs };
}

/** How to describe an r honestly, including refusing to.
 *  `n` gates before the value does: |r| = 0.9 on four points is not "strong",
 *  it is four points. */
export function describeCorrelation(r, n) {
  if (r === null || n < 5) return 'insufficient';
  const a = Math.abs(r);
  if (a < 0.3) return 'none';
  if (a < 0.6) return r > 0 ? 'weakPositive' : 'weakNegative';
  return r > 0 ? 'strongPositive' : 'strongNegative';
}
