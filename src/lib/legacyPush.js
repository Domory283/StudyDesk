// v1.18.1 (StudyDesk#146) — the one-off push after the v1.0.4 id migration,
// as outbox items (see useCloudPushers.js for why). Every row carries its own
// edit time, so a newer copy already on the server wins. Returns how many
// rows were queued.
import * as outbox from './outbox.js';

export function enqueueLegacyRows(state) {
  let queued = 0;
  for (const c of Object.values(state.courses).filter(c => !c.deletedAt)) {
    outbox.enqueue('upsert_subject', { id: c.id, name: c.name, credits: c.credits, semester: c.semester, schoolYear: c.schoolYear, color: c.color, updatedAt: c.updatedAt });
    queued++;
  }
  for (const g of (state.grades || []).filter(g => !g.deletedAt)) {
    outbox.enqueue('upsert_grade', { id: g.id, subjectId: g.subjectId, grade: g.grade, weight: g.weight, date: g.date, updatedAt: g.updatedAt });
    queued++;
  }
  for (const s of (state.studySessions || []).filter(s => !s.deletedAt)) {
    outbox.enqueue('log_session', { id: s.id, subjectId: s.subjectId, startedAt: s.startedAt, durationMinutes: s.durationMinutes, notes: s.notes, updatedAt: s.updatedAt });
    queued++;
  }
  // v1.7 (StudyDesk#6) — assignments/exams/actions carry a NOT NULL
  // subject_id FK. Rows whose course no longer exists locally are skipped:
  // the FK would reject them.
  for (const a of (state.assignments || [])) {
    if (!a.courseId || !state.courses[a.courseId]) continue;
    outbox.enqueue('upsert_assignment', { id: a.id, courseId: a.courseId, title: a.title, type: a.type, dueDate: a.dueDate, dueTime: a.dueTime, notes: a.notes, done: a.done, updatedAt: a.updatedAt });
    queued++;
  }
  for (const ex of (state.exams || [])) {
    if (!ex.courseId || !state.courses[ex.courseId]) continue;
    outbox.enqueue('upsert_exam', { id: ex.id, courseId: ex.courseId, title: ex.title, dueDate: ex.dueDate, difficulty: ex.difficulty, notes: ex.notes, done: ex.done, topics: ex.topics, updatedAt: ex.updatedAt });
    queued++;
  }
  // Only manual to-dos. The suggested ones are derived from assignments and
  // exams on every render and must never reach the cloud, or they would
  // come back as duplicate real rows alongside the freshly derived ones.
  for (const ac of (state.actions || []).filter(x => !x.suggested)) {
    outbox.enqueue('upsert_action', { id: ac.id, text: ac.text, bucket: ac.bucket, courseId: ac.courseId, done: ac.done, updatedAt: ac.updatedAt });
    queued++;
  }
  return queued;
}
