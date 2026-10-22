import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// A stand-in for user_preferences: one row per user, grade_scale merged in.
const server = vi.hoisted(() => ({ rows: new Map(), failReads: false, upserts: [] }));
vi.mock('./supabase.js', () => ({
  supabase: {
    from() {
      return {
        upsert(row) {
          server.upserts.push(row);
          server.rows.set(row.user_id, { ...(server.rows.get(row.user_id) || {}), ...row });
          return Promise.resolve({ error: null });
        },
        select() {
          return {
            eq(_col, userId) {
              return {
                maybeSingle() {
                  if (server.failReads) return Promise.resolve({ data: null, error: { message: 'offline' } });
                  const r = server.rows.get(userId);
                  return Promise.resolve({ data: r ? { grade_scale: r.grade_scale ?? null } : null, error: null });
                },
              };
            },
          };
        },
      };
    },
  },
}));

// The suite runs under Node, which has no localStorage.
const store = new Map();
vi.stubGlobal('localStorage', {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
});

const mod = await import('./gradeScaleCloud.js');
const { syncGradeScaleOnSignIn, onLocalScaleChange, fromCloud, toCloud, _resetForTests } = mod;

const GERMAN = { min: 1, max: 6, passMark: 4, direction: 'down', name: 'DE' };
const FINNISH = { min: 4, max: 10, passMark: 5, direction: 'up', name: '' };

beforeEach(() => {
  server.rows.clear();
  server.upserts = [];
  server.failReads = false;
  localStorage.clear();
  _resetForTests();
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

describe('grade scale follows the account (v1.18.2)', () => {
  it('back-fills the server when it has no scale yet', async () => {
    const apply = vi.fn();
    expect(await syncGradeScaleOnSignIn('u1', { mode: 'custom', custom: GERMAN }, apply)).toBe('backfilled');
    expect(apply).not.toHaveBeenCalled();
    expect(fromCloud(server.rows.get('u1').grade_scale)).toEqual({ mode: 'custom', custom: GERMAN });
  });

  it('adopts the server scale on sign-in and does not echo it back', async () => {
    server.rows.set('u1', { user_id: 'u1', grade_scale: toCloud('custom', GERMAN) });
    const apply = vi.fn();
    expect(await syncGradeScaleOnSignIn('u1', { mode: 'ib', custom: FINNISH }, apply)).toBe('applied');
    expect(apply).toHaveBeenCalledWith('custom', GERMAN);
    // The app re-renders with the adopted scale: not a local change.
    onLocalScaleChange('custom', GERMAN, 'u1');
    await vi.advanceTimersByTimeAsync(2000);
    expect(server.upserts).toHaveLength(0);
  });

  it('pushes a change made while signed in, once, after the debounce', async () => {
    server.rows.set('u1', { user_id: 'u1', grade_scale: toCloud('ib', null) });
    await syncGradeScaleOnSignIn('u1', { mode: 'ib', custom: FINNISH }, vi.fn());
    onLocalScaleChange('custom', { ...GERMAN, max: 5 }, 'u1');
    onLocalScaleChange('custom', GERMAN, 'u1');
    expect(server.upserts).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(2000);
    expect(server.upserts).toHaveLength(1);
    expect(fromCloud(server.rows.get('u1').grade_scale)).toEqual({ mode: 'custom', custom: GERMAN });
    expect(localStorage.getItem('studydesk-grade-scale-dirty')).toBeNull();
  });

  it('a change whose push never landed wins over the server at the next sign-in', async () => {
    server.rows.set('u1', { user_id: 'u1', grade_scale: toCloud('ib', null) });
    await syncGradeScaleOnSignIn('u1', { mode: 'ib', custom: FINNISH }, vi.fn());
    onLocalScaleChange('custom', GERMAN, 'u1');   // app closed before the debounce fired
    _resetForTests();
    const apply = vi.fn();
    expect(await syncGradeScaleOnSignIn('u1', { mode: 'custom', custom: GERMAN }, apply)).toBe('pushed-dirty');
    expect(apply).not.toHaveBeenCalled();
    expect(fromCloud(server.rows.get('u1').grade_scale)).toEqual({ mode: 'custom', custom: GERMAN });
  });

  it('a guest change stays on the device', async () => {
    await syncGradeScaleOnSignIn(null, { mode: 'ib', custom: FINNISH }, vi.fn());
    onLocalScaleChange('custom', GERMAN, null);
    await vi.advanceTimersByTimeAsync(2000);
    expect(server.upserts).toHaveLength(0);
    expect(localStorage.getItem('studydesk-grade-scale-dirty')).toBeNull();
  });

  it('offline at sign-in: later changes are still noticed', async () => {
    server.failReads = true;
    expect(await syncGradeScaleOnSignIn('u1', { mode: 'ib', custom: FINNISH }, vi.fn())).toBe('error');
    onLocalScaleChange('us', FINNISH, 'u1');
    expect(localStorage.getItem('studydesk-grade-scale-dirty')).toBe('u1');
  });

  it('ignores unusable server values', () => {
    expect(fromCloud(null)).toBeNull();
    expect(fromCloud({ mode: 'weird' })).toBeNull();
    expect(fromCloud({ mode: 'custom' })).toBeNull();
    expect(fromCloud({ mode: 'ib', custom: null })).toEqual({ mode: 'ib', custom: null });
  });
});
