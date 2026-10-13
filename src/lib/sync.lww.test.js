import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { makeLwwServer } from '../test/lwwServer.js';

// v1.18.1 — sync against a stand-in that applies the server's
// last-writer-wins rules (set_updated_at): StudyDesk#143 (attendance clear and
// re-mark) and StudyDesk#145 (semester archive overwriting newer edits).

const H = vi.hoisted(() => ({ server: null }));
vi.mock('./supabase.js', () => ({
  supabase: {
    from: (t) => H.server.from(t),
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
  },
}));
const outbox = await import('./outbox.js');
const { resetEditStamps } = await import('./editStamp.js');
const { applyRemotePull } = await import('./merge.js');

function storage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k), clear: () => m.clear(), key: (i) => [...m.keys()][i] ?? null,
    get length() { return m.size; },
  };
}
const at = (iso) => vi.setSystemTime(new Date(iso));
const online = (on) => vi.stubGlobal('navigator', { onLine: on });
const settle = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)); };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.stubGlobal('localStorage', storage());
  vi.stubGlobal('window', { dispatchEvent() {}, addEventListener() {}, removeEventListener() {} });
  vi.stubGlobal('CustomEvent', class { constructor(n) { this.type = n; } });
  H.server = makeLwwServer();
  resetEditStamps();
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

const E = 'entry-1';
const D = '2026-10-12';
const live = () => (H.server.tables.lesson_attendance || []).filter((r) => !r.deleted_at);

describe('attendance clear and re-mark (StudyDesk#143)', () => {
  it('online, mark then clear before any pull: the clear reaches the server row', async () => {
    online(true);
    at('2026-10-12T08:00:00Z');
    outbox.enqueue('upsert_attendance', { id: 'local-L', timetableEntryId: E, date: D, status: 'present' });
    await outbox.drain();
    await settle();
    at('2026-10-12T08:00:20Z');
    outbox.enqueue('delete_attendance', { id: 'local-L', timetableEntryId: E, date: D });
    await outbox.drain();
    await settle();
    expect(outbox.getStatus().pending).toBe(0);
    expect(live()).toHaveLength(0);
  });

  it('offline, mark then clear: drains in tap order and the server ends cleared', async () => {
    online(false);
    at('2026-10-12T08:00:00Z');
    outbox.enqueue('upsert_attendance', { id: 'local-L', timetableEntryId: E, date: D, status: 'present' });
    at('2026-10-12T08:00:05Z');
    outbox.enqueue('delete_attendance', { id: 'local-L', timetableEntryId: E, date: D });
    at('2026-10-12T12:00:00Z');
    online(true);
    await outbox.drain();
    await settle();
    expect(live()).toHaveLength(0);
  });

  it('offline, clear then re-mark a synced lesson: the re-mark lands and survives the next pull', async () => {
    online(true);
    at('2026-10-12T07:00:00Z');
    outbox.enqueue('upsert_attendance', { id: 'x', timetableEntryId: E, date: D, status: 'absent' });
    await outbox.drain();
    await settle();
    const S = H.server.tables.lesson_attendance[0].id;
    online(false);
    at('2026-10-12T09:00:00Z');
    outbox.enqueue('delete_attendance', { id: S, timetableEntryId: E, date: D });
    at('2026-10-12T09:00:02Z');
    outbox.enqueue('upsert_attendance', { id: S, timetableEntryId: E, date: D, status: 'present' });
    at('2026-10-12T12:00:00Z');
    online(true);
    await outbox.drain();
    await settle();
    expect(live().map((r) => r.status)).toEqual(['present']);
    const local = [{ id: S, timetableEntryId: E, date: D, status: 'present', note: null, updatedAt: '2026-10-12T09:00:02.000Z', deletedAt: null }];
    const pulled = { subjects: [], grades: [], sessions: [], attendance: H.server.tables.lesson_attendance };
    const merged = applyRemotePull({ courses: {}, grades: [], studySessions: [], attendance: local }, pulled);
    expect(merged.attendance.map((a) => a.status)).toEqual(['present']);
  });
});

describe('semester archive offline (StudyDesk#145)', () => {
  it('a rename made elsewhere while this device was offline is kept, and the archive lands', async () => {
    H.server = makeLwwServer({
      subjects: [{ id: 'm', user_id: 'u1', name: 'Math', credits: 5, semester: 'Fall', archived_at: null, deleted_at: null, updated_at: '2026-10-01T00:00:00.000Z' }],
    });
    online(false);
    at('2026-10-12T10:00:00Z');
    const courses = { m: { id: 'm', name: 'Math', credits: 5, semester: 'Fall', color: '#111', schoolYear: '2026', updatedAt: '2026-10-01T00:00:00Z' } };
    outbox.enqueue('archive_semester', { courses, semester: 'Fall', stamp: '2026-10-12T10:00:00.000Z' });
    // Another device renames the course at 11:00.
    at('2026-10-12T11:00:00Z');
    Object.assign(H.server.tables.subjects[0], { name: 'Mathematics', updated_at: '2026-10-12T11:00:00.000Z' });
    at('2026-10-12T12:00:00Z');
    online(true);
    await outbox.drain();
    await settle();
    const row = H.server.tables.subjects[0];
    expect(row.name).toBe('Mathematics');
    expect(row.archived_at).toBe('2026-10-12T10:00:00.000Z');
  });
});

describe('one-off legacy push (StudyDesk#146)', () => {
  it('queues rows with their own edit time, so a newer server copy is not overwritten', async () => {
    const { enqueueLegacyRows } = await import('./legacyPush.js');
    H.server = makeLwwServer({
      subjects: [{ id: 'm', user_id: 'u1', name: 'Mathematics', credits: 5, deleted_at: null, updated_at: '2026-10-12T11:00:00.000Z' }],
    });
    online(false);
    at('2026-10-12T12:00:00Z');
    const state = {
      courses: { m: { id: 'm', name: 'Math', credits: 5, semester: 'Fall', updatedAt: '2026-10-01T00:00:00.000Z' } },
      grades: [], studySessions: [],
      assignments: [{ id: 'a1', courseId: 'gone', title: 'orphan' }],
      exams: [], actions: [],
    };
    expect(enqueueLegacyRows(state)).toBe(1); // the orphaned assignment is skipped
    online(true);
    await outbox.drain();
    await settle();
    expect(H.server.tables.subjects[0].name).toBe('Mathematics');
  });
});
