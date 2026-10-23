import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { encodePng, writeSample } from '../scripts/make-sample.js';
import { scanFrames, validateAvatarConfig } from '../src/config.js';

test('encodePng writes a valid PNG header and IEND chunk', () => {
  const png = encodePng(2, 3, Buffer.alloc(2 * 3 * 4, 255));
  assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.equal(png.toString('ascii', 12, 16), 'IHDR');
  assert.equal(png.readUInt32BE(16), 2);
  assert.equal(png.readUInt32BE(20), 3);
  assert.equal(png[24], 8);
  assert.equal(png[25], 6);
  assert.equal(png.toString('ascii', png.length - 8, png.length - 4), 'IEND');
  assert.equal(png.readUInt32BE(png.length - 4), 0xae426082);
});

test('writeSample creates a complete, valid avatar', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'avata-sample-'));
  try {
    await writeSample(dir, { size: 120 });
    const config = JSON.parse(await readFile(path.join(dir, 'avatar.json'), 'utf8'));
    assert.equal(validateAvatarConfig(config).ok, true);
    assert.deepEqual(await scanFrames(dir), {
      default: ['idle', 'talk', 'blink', 'blink-talk'],
      happy: ['idle', 'talk'],
      shock: ['idle'],
    });
    const idle = await readFile(path.join(dir, 'default', 'idle.png'));
    assert.equal(idle.readUInt32BE(16), 120);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
