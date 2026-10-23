export const SEMESTER_CAPACITY = 500;
export const CUT_CAPACITIES = Object.freeze({ 1: 150, 2: 150, 3: 200 });
export const ACTIVITY_STATUSES = Object.freeze(['pending', 'awaiting_grade', 'graded']);

const roundPoints = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
const validNumber = (value) => value != null && value !== '' && Number.isFinite(Number(value));

export function isPointActivity(activity) {
  return Boolean(activity && Number(CUT_CAPACITIES[activity.cut]) > 0
    && String(activity.title).trim() && validNumber(activity.maxPoints)
    && Number(activity.maxPoints) > 0
    && ACTIVITY_STATUSES.includes(activity.status));
}

export function validatePointActivity(input, existing = [], editingId = null) {
  if (!input.subjectId) return 'subject_required';
  if (!CUT_CAPACITIES[input.cut]) return 'cut_required';
  if (!String(input.title || '').trim()) return 'title_required';
  if (!validNumber(input.maxPoints) || Number(input.maxPoints) <= 0) return 'maximum_invalid';
  if (!ACTIVITY_STATUSES.includes(input.status)) return 'status_invalid';

  const maxPoints = roundPoints(input.maxPoints);
  const earnedPoints = input.status === 'graded' ? Number(input.earnedPoints) : null;
  if (input.status === 'graded') {
    if (!validNumber(input.earnedPoints) || earnedPoints < 0) return 'earned_invalid';
    if (roundPoints(earnedPoints) > maxPoints) return 'earned_exceeds_maximum';
  }

  const siblings = (existing || []).filter((activity) =>
    !activity.deletedAt
    && activity.subjectId === input.subjectId
    && activity.id !== editingId);
  const normalizedTitle = String(input.title).trim().toLocaleLowerCase();
  if (siblings.some((activity) => activity.cut === Number(input.cut)
    && String(activity.title).trim().toLocaleLowerCase() === normalizedTitle)) {
    return 'duplicate_activity';
  }

  const cutAllocated = siblings
    .filter((activity) => Number(activity.cut) === Number(input.cut))
    .reduce((sum, activity) => sum + roundPoints(activity.maxPoints), 0) + maxPoints;
  if (cutAllocated > CUT_CAPACITIES[input.cut] && !input.allowOverCapacity) {
    return 'cut_capacity_exceeded';
  }

  const semesterAllocated = siblings.reduce((sum, activity) => sum + roundPoints(activity.maxPoints), 0) + maxPoints;
  if (semesterAllocated > SEMESTER_CAPACITY) return 'semester_capacity_exceeded';
  return null;
}

export function summarizeGradeActivities(activities = [], subjectId = null) {
  const live = (activities || []).filter((activity) =>
    !activity.deletedAt && isPointActivity(activity)
    && (subjectId == null || activity.subjectId === subjectId));

  const cuts = Object.entries(CUT_CAPACITIES).map(([cut, capacity]) => {
    const rows = live.filter((activity) => Number(activity.cut) === Number(cut));
    const obtained = roundPoints(rows
      .filter((activity) => activity.status === 'graded')
      .reduce((sum, activity) => sum + Number(activity.earnedPoints), 0));
    const evaluated = roundPoints(rows
      .filter((activity) => activity.status === 'graded')
      .reduce((sum, activity) => sum + Number(activity.maxPoints), 0));
    const reserved = roundPoints(rows
      .filter((activity) => activity.status !== 'graded')
      .reduce((sum, activity) => sum + Number(activity.maxPoints), 0));
    const allocated = roundPoints(evaluated + reserved);
    return {
      cut: Number(cut),
      capacity,
      obtained,
      evaluated,
      reserved,
      allocated,
      unassigned: Math.max(0, roundPoints(capacity - allocated)),
      remaining: Math.max(0, roundPoints(capacity - obtained)),
      progress: Math.min(100, Math.max(0, (obtained / capacity) * 100)),
      activities: rows,
    };
  });

  const obtained = roundPoints(cuts.reduce((sum, cut) => sum + cut.obtained, 0));
  const evaluated = roundPoints(cuts.reduce((sum, cut) => sum + cut.evaluated, 0));
  const reserved = roundPoints(cuts.reduce((sum, cut) => sum + cut.reserved, 0));
  const allocated = roundPoints(cuts.reduce((sum, cut) => sum + cut.allocated, 0));
  return {
    cuts,
    obtained,
    evaluated,
    reserved,
    allocated,
    unassigned: Math.max(0, roundPoints(SEMESTER_CAPACITY - allocated)),
    remaining: Math.max(0, roundPoints(SEMESTER_CAPACITY - obtained)),
    percent: Math.min(100, Math.max(0, (obtained / SEMESTER_CAPACITY) * 100)),
    equivalent: roundPoints(obtained / 100),
  };
}

export function pointsNeededForPass(obtained, minimumGrade) {
  if (!validNumber(minimumGrade) || Number(minimumGrade) < 0 || Number(minimumGrade) > 5) return null;
  return Math.max(0, roundPoints(Number(minimumGrade) * 100 - Number(obtained || 0)));
}
