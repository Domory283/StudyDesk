import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// v1.18.1 (StudyDesk#144) — a device whose clock ran ahead stamped its edits
// in the future, kept those stamps, and so ignored newer edits from other
// devices on every pull. Stamps are now made in server time, using the offset
// measured from the server's Date header.

function storage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}
vi.stubGlobal('localStorage', storage());
const { noteServerDate, stampNow, serverNow, resetServerClock } = await import('./serverClock.js');
const { applyRemotePull } = await import('./merge.js');

const base = { courses: {}, grades: [], studySessions: [] };
const pull = (notes) => ({ subjects: [], grades: [], sessions: [], notes });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  resetServerClock();
});
afterEach(() => vi.useRealTimers());

describe('server clock (StudyDesk#144)', () => {
  it('a device 10 minutes fast stamps in server time and takes a newer edit from another device', () => {
    // Device clock 10:10, server says 10:00.
    vi.setSystemTime(new Date('2026-10-12T10:10:00Z'));
    noteServerDate('Mon, 12 Oct 2026 10:00:00 GMT');
    // A edits now: the stamp is 10:00 (server time), not 10:10.
    const stamp = stampNow();
    expect(stamp).toBe('2026-10-12T10:00:00.000Z');
    const localA = [{ id: 'n1', content: 'A v1', updatedAt: stamp, deletedAt: null }];
    // B (correct clock) edits at 10:02; A pulls at 10:05.
    const server = [{ id: 'n1', content: 'A v1 + B line', updated_at: '2026-10-12T10:02:00+00:00', deleted_at: null }];
    const merged = applyRemotePull({ ...base, notes: localA }, pull(server));
    expect(merged.notes[0].content).toBe('A v1 + B line');
  });

  it('ignores differences of a few seconds (latency and whole-second headers)', () => {
    vi.setSystemTime(new Date('2026-10-12T10:00:03Z'));
    noteServerDate('Mon, 12 Oct 2026 10:00:00 GMT');
    expect(serverNow()).toBe(Date.parse('2026-10-12T10:00:03Z'));
  });

  it('keeps the offset across launches, and ignores a missing or unreadable header', () => {
    vi.setSystemTime(new Date('2026-10-12T10:10:00Z'));
    noteServerDate('Mon, 12 Oct 2026 10:00:00 GMT');
    expect(localStorage.getItem('studydesk-server-clock-offset')).toBe(String(-600000));
    noteServerDate(undefined);
    noteServerDate('not a date');
    expect(serverNow()).toBe(Date.parse('2026-10-12T10:00:00Z'));
  });
});
