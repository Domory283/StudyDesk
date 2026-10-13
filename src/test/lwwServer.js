// A stand-in for the parts of PostgREST + public.set_updated_at() that
// StudyDesk's sync relies on (supabase/migrations/20260925_lww_clamp_delete_wins.sql):
//   - a future or missing updated_at is clamped to now;
//   - a tombstone (deleted_at going from null to set) always lands;
//   - otherwise an update older than the stored row is declined (the row is
//     left as it was, and the request still succeeds, as in Postgres).
// Upsert honours `onConflict`; update and delete take chained `.eq()` filters
// and `.select()` returns the affected rows. Not a test file itself.
export function makeLwwServer(initial = {}) {
  const tables = {};
  for (const [k, rows] of Object.entries(initial)) tables[k] = rows.map((r) => ({ ...r }));
  let seq = 0;
  const genId = () => `srv-${++seq}`;
  const t = (iso) => (iso ? new Date(iso).getTime() : null);
  const log = [];

  function guard(oldRow, newRow) {
    const now = Date.now();
    if (newRow.updated_at == null || t(newRow.updated_at) > now) newRow.updated_at = new Date(now).toISOString();
    if (!oldRow) return newRow;
    if (oldRow.deleted_at == null && newRow.deleted_at != null) {
      const floor = Math.min(t(oldRow.updated_at), now);
      if (t(newRow.updated_at) < floor) newRow.updated_at = new Date(floor).toISOString();
      return newRow;
    }
    if (oldRow.updated_at != null && t(newRow.updated_at) < Math.min(t(oldRow.updated_at), now)) return oldRow;
    return newRow;
  }

  function from(table) {
    const rows = tables[table] || (tables[table] = []);
    const filtered = (op, patch) => {
      const filters = [];
      let returning = false;
      const b = {
        eq(col, val) { filters.push([col, val]); return b; },
        select() { returning = true; return b; },
        then(resolve, reject) {
          return Promise.resolve().then(() => {
            const hit = [];
            for (let i = 0; i < rows.length; i++) {
              if (!filters.every(([c, v]) => rows[i][c] === v)) continue;
              if (op === 'update') rows[i] = guard(rows[i], { ...rows[i], ...patch });
              hit.push(rows[i]);
            }
            if (op === 'delete') tables[table] = rows.filter((r) => !hit.includes(r));
            log.push([op, table, Object.fromEntries(filters), patch ?? null, hit.length]);
            return { data: returning ? hit.map((r) => ({ ...r })) : null, error: null };
          }).then(resolve, reject);
        },
      };
      return b;
    };
    return {
      upsert(payload, opts = {}) {
        const keys = opts.onConflict ? opts.onConflict.split(',') : ['id'];
        const i = rows.findIndex((r) => keys.every((k) => r[k] === payload[k]));
        if (i < 0) {
          rows.push(guard(null, { id: payload.id ?? genId(), deleted_at: null, ...payload }));
          log.push(['insert', table, payload]);
        } else {
          const next = guard(rows[i], { ...rows[i], ...payload });
          log.push([next === rows[i] ? 'upsert-declined' : 'upsert', table, payload]);
          rows[i] = next;
        }
        return Promise.resolve({ error: null });
      },
      update: (patch) => filtered('update', patch),
      delete: () => filtered('delete'),
    };
  }
  return { tables, from, log };
}
