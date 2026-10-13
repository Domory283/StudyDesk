import { describe, it, expect } from 'vitest';
import { removeUserFiles, rateLimitBuckets, USER_FILE_BUCKETS } from '../supabase/functions/delete-account/userFiles.js';

// v1.18.1 (limecore#61) — account deletion left the user's Storage files
// behind: the cascade from auth.users does not reach storage.objects. A
// stand-in for the Storage client: one level per list() call, folders as
// entries with no id, pages of `limit` from `offset`.

function fakeStorage(files) {
  const store = Object.fromEntries(USER_FILE_BUCKETS.map((b) => [b, new Set(files[b] ?? [])]));
  const calls = [];
  return {
    store,
    calls,
    storage: {
      from(bucket) {
        return {
          async list(prefix, { limit, offset }) {
            calls.push(['list', bucket, prefix, offset]);
            const below = [...store[bucket]].filter((p) => p.startsWith(`${prefix}/`)).map((p) => p.slice(prefix.length + 1));
            const names = [...new Set(below.map((rest) => rest.split('/')[0]))].sort();
            const entries = names.map((name) => ({ name, id: below.includes(name) ? `obj-${name}` : null }));
            return { data: entries.slice(offset, offset + limit), error: null };
          },
          async remove(paths) {
            calls.push(['remove', bucket, paths.length]);
            for (const p of paths) store[bucket].delete(p);
            return { data: [], error: null };
          },
        };
      },
    },
  };
}

describe('removeUserFiles (limecore#61)', () => {
  it('removes the avatar and every attachment, nested folders included, and only that user\'s', async () => {
    const admin = fakeStorage({
      avatars: ['u1/avatar.jpg', 'u2/avatar.jpg'],
      'assignment-attachments': ['u1/a1/essay.pdf', 'u1/a2/notes.png', 'u1/a2/draft.docx', 'u2/a9/x.pdf'],
    });
    const removed = await removeUserFiles(admin, 'u1');
    expect(removed).toEqual({ avatars: 1, 'assignment-attachments': 3 });
    expect([...admin.store.avatars]).toEqual(['u2/avatar.jpg']);
    expect([...admin.store['assignment-attachments']]).toEqual(['u2/a9/x.pdf']);
  });

  it('pages through more than 1000 files, and removes them in batches of 1000', async () => {
    const many = Array.from({ length: 2345 }, (_, i) => `u1/a/f${String(i).padStart(4, '0')}.pdf`);
    const admin = fakeStorage({ 'assignment-attachments': many });
    const removed = await removeUserFiles(admin, 'u1');
    expect(removed['assignment-attachments']).toBe(2345);
    expect(admin.store['assignment-attachments'].size).toBe(0);
    expect(admin.calls.filter((c) => c[0] === 'remove' && c[1] === 'assignment-attachments').map((c) => c[2])).toEqual([1000, 1000, 345]);
  });

  it('a user with no files is fine', async () => {
    expect(await removeUserFiles(fakeStorage({}), 'u1')).toEqual({ avatars: 0, 'assignment-attachments': 0 });
  });

  it('stops at the first failure, so the account is not deleted with files left', async () => {
    const admin = fakeStorage({ avatars: ['u1/avatar.jpg'] });
    const from = admin.storage.from;
    admin.storage.from = (b) => ({ ...from(b), remove: async () => ({ data: null, error: new Error('storage down') }) });
    await expect(removeUserFiles(admin, 'u1')).rejects.toThrow('storage down');
  });
});

describe('rateLimitBuckets', () => {
  it('names both of the user\'s windows', () => {
    expect(rateLimitBuckets('u1')).toEqual(['user:u1', 'user:u1:day']);
  });
});
