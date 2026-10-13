// v1.18.1 (limecore#61) — what account deletion has to remove by hand.
//
// Deleting the auth user cascades to every table that references it, but not
// to Storage: `storage.objects` references only its bucket. So the avatar and
// every coursework attachment outlived the account. Both buckets keep a user's
// files under `<user id>/…` (their policies check `foldername(name)[1]`), so
// that folder is everything to remove.
//
// Plain JavaScript with no Deno or npm imports, so the unit test can run it
// under Node with a stand-in client.

/** Every bucket that keeps files per user, under `<user id>/`. */
export const USER_FILE_BUCKETS = ['avatars', 'assignment-attachments'];

const PAGE = 1000;

/** Every file path under `prefix`, descending into folders. Storage lists one
 *  level at a time, and reports a folder as an entry with no id. */
async function listFiles(bucket, prefix) {
  const out = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await bucket.list(prefix, { limit: PAGE, offset });
    if (error) throw error;
    for (const entry of data ?? []) {
      const path = `${prefix}/${entry.name}`;
      if (entry.id == null) out.push(...(await listFiles(bucket, path)));
      else out.push(path);
    }
    if (!data || data.length < PAGE) break;
  }
  return out;
}

/** Remove every file the user has in every per-user bucket. Throws on the
 *  first failure, so the caller can stop before deleting the account and the
 *  user can try again. Returns how many files went, per bucket. */
export async function removeUserFiles(admin, userId) {
  const removed = {};
  for (const name of USER_FILE_BUCKETS) {
    const bucket = admin.storage.from(name);
    const paths = await listFiles(bucket, userId);
    for (let i = 0; i < paths.length; i += PAGE) {
      const { error } = await bucket.remove(paths.slice(i, i + PAGE));
      if (error) throw error;
    }
    removed[name] = paths.length;
  }
  return removed;
}

/** The AI rate-limit rows keyed to the user (`user:<id>` and
 *  `user:<id>:day`). They hold a count, not content, but they name the id. */
export function rateLimitBuckets(userId) {
  return [`user:${userId}`, `user:${userId}:day`];
}
