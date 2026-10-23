import { describe, expect, it } from 'vitest';
import {
  ACTIVITY_STATUSES,
  CUT_CAPACITIES,
  SEMESTER_CAPACITY,
  pointsNeededForPass,
  summarizeGradeActivities,
  validatePointActivity,
} from './pointsGrades.js';

const activity = (overrides = {}) => ({
  id: crypto.randomUUID(),
  subjectId: 'math',
  cut: 1,
  title: 'Parcial 1',
  earnedPoints: 80,
  maxPoints: 100,
  status: 'graded',
  date: '2026-10-20',
  allowOverCapacity: false,
  ...overrides,
});

describe('point grade summaries', () => {
  it('sums earned points directly', () => {
    expect(summarizeGradeActivities([activity()]).obtained).toBe(80);
  });

  it('tracks evaluated maximum separately', () => {
    const summary = summarizeGradeActivities([
      activity(),
      activity({ id: 'quiz', title: 'Quiz 1', earnedPoints: 30, maxPoints: 40 }),
    ]);
    expect(summary.obtained).toBe(110);
    expect(summary.evaluated).toBe(140);
  });

  it('reserves pending activities without counting their earned points', () => {
    const summary = summarizeGradeActivities([
      activity({ status: 'pending', earnedPoints: null, maxPoints: 30 }),
    ]);
    expect(summary.obtained).toBe(0);
    expect(summary.reserved).toBe(30);
  });

  it('reserves activities awaiting a grade', () => {
    expect(summarizeGradeActivities([
      activity({ status: 'awaiting_grade', earnedPoints: null, maxPoints: 25 }),
    ]).reserved).toBe(25);
  });

  it('uses the 150-point capacity for the first cut', () => {
    const summary = summarizeGradeActivities([
      activity(),
      activity({ id: 'quiz', title: 'Quiz', earnedPoints: 30, maxPoints: 40 }),
    ]);
    expect(summary.cuts[0]).toMatchObject({ obtained: 110, capacity: 150 });
  });

  it('defines cut capacities that total 500 points', () => {
    expect(CUT_CAPACITIES).toEqual({ 1: 150, 2: 150, 3: 200 });
    expect(Object.values(CUT_CAPACITIES).reduce((sum, value) => sum + value, 0)).toBe(SEMESTER_CAPACITY);
  });

  it('calculates semester progress against all 500 points', () => {
    const summary = summarizeGradeActivities([activity({ earnedPoints: 110 })]);
    expect(summary.percent).toBe(22);
  });

  it('shows the optional 0–5 equivalent and pass threshold', () => {
    expect(summarizeGradeActivities([activity({ earnedPoints: 300 })]).equivalent).toBe(3);
    expect(pointsNeededForPass(220, 3)).toBe(80);
    expect(pointsNeededForPass(320, 3)).toBe(0);
    expect(pointsNeededForPass(220, '')).toBeNull();
  });
});

describe('point activity validation', () => {
  it('requires a valid earned score for a graded activity', () => {
    expect(validatePointActivity(activity({ earnedPoints: 110 }), [])).toBe('earned_exceeds_maximum');
  });

  it('does not ask for a score until the activity is graded', () => {
    expect(validatePointActivity(activity({
      title: 'Parcial pendiente',
      status: 'pending',
      earnedPoints: null,
      maxPoints: 100,
    }))).toBeNull();
    expect(ACTIVITY_STATUSES).toEqual(['pending', 'awaiting_grade', 'graded']);
  });

  it('blocks a cut capacity overflow unless the exception is explicit', () => {
    const first = activity({ maxPoints: 100 });
    const next = activity({ id: 'second', title: 'Segundo', earnedPoints: 25, maxPoints: 51 });
    expect(validatePointActivity(next, [first])).toBe('cut_capacity_exceeded');
    expect(validatePointActivity({ ...next, allowOverCapacity: true }, [first])).toBeNull();
  });

  it('never lets cut exceptions exceed the semester total', () => {
    const existing = [
      activity({ maxPoints: 150 }),
      activity({ id: 'cut2', title: 'Corte 2', cut: 2, maxPoints: 150 }),
      activity({ id: 'cut3', title: 'Corte 3', cut: 3, maxPoints: 190 }),
    ];
    expect(validatePointActivity(activity({
      title: 'Extra',
      cut: 3,
      earnedPoints: 5,
      maxPoints: 11,
      allowOverCapacity: true,
    }), existing)).toBe('semester_capacity_exceeded');
  });

  it('detects duplicate activity names within the same cut', () => {
    expect(validatePointActivity(activity({ title: '  parcial 1 ' }), [activity()])).toBe('duplicate_activity');
  });

  it('recalculates edits without counting the original row twice', () => {
    const original = activity();
    const edited = { ...original, earnedPoints: 90 };
    expect(validatePointActivity(edited, [original], original.id)).toBeNull();
    expect(summarizeGradeActivities([edited]).obtained).toBe(90);
  });

  it('recalculates when an activity moves to another cut', () => {
    const original = activity();
    const moved = { ...original, cut: 2 };
    expect(validatePointActivity(moved, [original], original.id)).toBeNull();
    const summary = summarizeGradeActivities([moved]);
    expect(summary.cuts.map((cut) => cut.obtained)).toEqual([0, 80, 0]);
  });

  it('excludes soft-deleted activities from all totals', () => {
    expect(summarizeGradeActivities([activity({ deletedAt: 'now' })]).obtained).toBe(0);
  });
});
