'use strict';

const { createHash } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const IMAGE_DIRECTORY = 'notebook-images';
const ID_RE = /^[a-f0-9]{64}$/;

function imageType(buffer) {
  if (
    buffer.length >= 8
    && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  ) return { extension: 'png', mimeType: 'image/png' };
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { extension: 'jpg', mimeType: 'image/jpeg' };
  }
  if (
    buffer.length >= 12
    && buffer.toString('ascii', 0, 4) === 'RIFF'
    && buffer.toString('ascii', 8, 12) === 'WEBP'
  ) return { extension: 'webp', mimeType: 'image/webp' };
  return null;
}

function imageError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function imagePath(userDataPath, id) {
  if (typeof id !== 'string' || !ID_RE.test(id)) throw imageError('invalid-image-id');
  return path.join(userDataPath, IMAGE_DIRECTORY, id);
}

async function importNotebookImage(sourcePath, userDataPath) {
  const stat = await fs.stat(sourcePath);
  if (!stat.isFile()) throw imageError('unsupported-image');
  if (stat.size > MAX_IMAGE_BYTES) throw imageError('image-too-large');

  const buffer = await fs.readFile(sourcePath);
  if (buffer.length > MAX_IMAGE_BYTES) throw imageError('image-too-large');
  const detected = imageType(buffer);
  const extension = path.extname(sourcePath).slice(1).toLowerCase();
  const extensionMatches = (
    (detected?.extension === 'jpg' && ['jpg', 'jpeg'].includes(extension))
    || detected?.extension === extension
  );
  if (!detected || !extensionMatches) throw imageError('unsupported-image');

  const id = createHash('sha256').update(buffer).digest('hex');
  const targetPath = imagePath(userDataPath, id);
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  try {
    await fs.writeFile(targetPath, buffer, { flag: 'wx' });
  } catch (error) {
    if (error?.code === 'EEXIST') {
      const existing = await fs.readFile(targetPath);
      if (!existing.equals(buffer)) throw imageError('stored-image-conflict');
    } else {
      try {
        await fs.unlink(targetPath);
      } catch (cleanupError) {
        if (cleanupError?.code !== 'ENOENT') {
          throw new AggregateError([error, cleanupError], 'notebook-image-save-and-cleanup-failed');
        }
      }
      throw error;
    }
  }

  return { id, mimeType: detected.mimeType, sizeBytes: buffer.length };
}

async function readNotebookImage(userDataPath, id) {
  const buffer = await fs.readFile(imagePath(userDataPath, id));
  if (buffer.length > MAX_IMAGE_BYTES) throw imageError('image-too-large');
  const detected = imageType(buffer);
  if (!detected) throw imageError('unsupported-image');
  return {
    mimeType: detected.mimeType,
    dataUrl: `data:${detected.mimeType};base64,${buffer.toString('base64')}`,
  };
}

async function deleteNotebookImage(userDataPath, id) {
  try {
    await fs.unlink(imagePath(userDataPath, id));
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

module.exports = {
  MAX_IMAGE_BYTES,
  deleteNotebookImage,
  importNotebookImage,
  readNotebookImage,
};
