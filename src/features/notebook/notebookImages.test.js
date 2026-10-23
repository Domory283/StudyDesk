import { afterEach, describe, expect, it } from 'vitest';
import { Buffer } from 'node:buffer';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import imageStorage from '../../../electron/notebookImages.cjs';

const {
  MAX_IMAGE_BYTES,
  deleteNotebookImage,
  importNotebookImage,
  readNotebookImage,
} = imageStorage;
const tempPaths = [];

async function createFixture(extension, content) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'studydesk-notebook-'));
  tempPaths.push(root);
  const sourcePath = path.join(root, `source.${extension}`);
  const userDataPath = path.join(root, 'user-data');
  await fs.writeFile(sourcePath, content);
  return { sourcePath, userDataPath };
}

afterEach(async () => {
  await Promise.all(tempPaths.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe('local notebook image storage', () => {
  it.each([
    ['png', Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0])],
    ['jpg', Buffer.from([0xff, 0xd8, 0xff, 0])],
    ['jpeg', Buffer.from([0xff, 0xd8, 0xff, 0])],
    ['webp', Buffer.from('RIFF0000WEBP', 'ascii')],
  ])('imports and reads a %s image from the app data directory', async (extension, bytes) => {
    const { sourcePath, userDataPath } = await createFixture(extension, bytes);

    const imported = await importNotebookImage(sourcePath, userDataPath);
    const read = await readNotebookImage(userDataPath, imported.id);

    expect(imported.id).toMatch(/^[a-f0-9]{64}$/);
    expect(read.dataUrl).toBe(`data:${read.mimeType};base64,${bytes.toString('base64')}`);
  });

  it('reuses the content identifier instead of duplicating the same image', async () => {
    const bytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]);
    const first = await createFixture('png', bytes);
    const second = await createFixture('png', bytes);

    const a = await importNotebookImage(first.sourcePath, first.userDataPath);
    const b = await importNotebookImage(second.sourcePath, first.userDataPath);

    expect(b.id).toBe(a.id);
    expect(await fs.readdir(path.join(first.userDataPath, 'notebook-images'))).toEqual([a.id]);
  });

  it('rejects unsupported content and oversized files', async () => {
    const invalid = await createFixture('png', Buffer.from('not an image'));
    const mismatched = await createFixture(
      'jpg',
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]),
    );
    const large = await createFixture(
      'png',
      Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.alloc(MAX_IMAGE_BYTES)]),
    );

    await expect(importNotebookImage(invalid.sourcePath, invalid.userDataPath))
      .rejects.toMatchObject({ code: 'unsupported-image' });
    await expect(importNotebookImage(mismatched.sourcePath, mismatched.userDataPath))
      .rejects.toMatchObject({ code: 'unsupported-image' });
    await expect(importNotebookImage(large.sourcePath, large.userDataPath))
      .rejects.toMatchObject({ code: 'image-too-large' });
  });

  it('deletes only the addressed image and rejects unsafe identifiers', async () => {
    const first = await createFixture('png', Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1]));
    const second = await createFixture('png', Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 2]));
    const a = await importNotebookImage(first.sourcePath, first.userDataPath);
    const b = await importNotebookImage(second.sourcePath, first.userDataPath);

    await deleteNotebookImage(first.userDataPath, a.id);

    await expect(readNotebookImage(first.userDataPath, a.id)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readNotebookImage(first.userDataPath, b.id)).resolves.toMatchObject({ mimeType: 'image/png' });
    await expect(deleteNotebookImage(first.userDataPath, '..\\outside')).rejects.toMatchObject({ code: 'invalid-image-id' });
  });
});
