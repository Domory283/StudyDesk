// v1.18.1 (StudyDesk#144) — the server's clock, as seen from this device.
//
// Every edit is stamped with the time it was made, and the newest stamp wins
// (on the server, set_updated_at(); on this device, merge.js). A device whose
// clock ran ahead stamped its edits in the future: the server clamped them on
// the way in, but this device kept its own future stamps and so ignored newer
// edits from other devices on every pull, then pushed over them. A dual-boot
// PC whose clock is off by the timezone offset is hours out.
//
// So stamps are made in server time: this device's clock plus the offset
// measured from the `Date` header of Supabase responses (whole seconds, and
// the response's own travel time in it, so small differences are ignored).
// The offset is kept across launches, for edits made before the first
// response arrives. With no measurement it is 0, which is the old behaviour.
const KEY = 'studydesk-server-clock-offset';
// Below this the "offset" is mostly network latency and header rounding.
const IGNORE_BELOW_MS = 5000;

let offsetMs = (() => {
  try {
    const n = Number(localStorage.getItem(KEY));
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
})();

/** Record the server's `Date` header from a response received at `receivedAt`. */
export function noteServerDate(header, receivedAt = Date.now()) {
  const server = Date.parse(header || '');
  if (!Number.isFinite(server)) return;
  const measured = server - receivedAt;
  const next = Math.abs(measured) >= IGNORE_BELOW_MS ? measured : 0;
  if (next === offsetMs) return;
  offsetMs = next;
  try {
    localStorage.setItem(KEY, String(next));
  } catch { /* the offset is then re-measured next launch */ }
}

/** Milliseconds, in server time. */
export function serverNow() {
  return Date.now() + offsetMs;
}

/** An ISO stamp, in server time, for an edit made now. */
export function stampNow() {
  return new Date(serverNow()).toISOString();
}

/** Test seam. */
export function resetServerClock() {
  offsetMs = 0;
  try { localStorage.removeItem(KEY); } catch { /* nothing stored */ }
}
