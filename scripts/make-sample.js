// วาดตัวละครตัวอย่าง (avatars/sample) ด้วย Node ล้วน ไว้ทดลองระบบก่อนมีรูปของตัวเอง
import { mkdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const SUBSAMPLES = [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]];

const OUTLINE = [43, 33, 64];
const SKIN = [255, 217, 184];
const HAIR = [90, 61, 138];
const SHIRT = [108, 140, 255];
const WHITE = [255, 255, 255];
const TONGUE = [255, 122, 138];
const CHEEK = [255, 157, 176];

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

export function encodePng(width, height, rgba) {
  const stride = width * 4 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * stride] = 0;
    rgba.copy(raw, y * stride + 1, y * width * 4, (y + 1) * width * 4);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  return Buffer.concat([PNG_SIGNATURE, chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

function createCanvas(size) {
  const data = Buffer.alloc(size * size * 4);
  const scale = size / 1000;

  function blend(x, y, [r, g, b], alpha) {
    const i = (y * size + x) * 4;
    const below = data[i + 3] / 255;
    const out = alpha + below * (1 - alpha);
    data[i] = Math.round((r * alpha + data[i] * below * (1 - alpha)) / out);
    data[i + 1] = Math.round((g * alpha + data[i + 1] * below * (1 - alpha)) / out);
    data[i + 2] = Math.round((b * alpha + data[i + 2] * below * (1 - alpha)) / out);
    data[i + 3] = Math.round(out * 255);
  }

  // พิกัดทั้งหมดออกแบบไว้บนผืน 1000×1000 แล้วย่อขยายตาม size
  function ellipse(cx, cy, rx, ry, color, opacity = 1) {
    [cx, cy, rx, ry] = [cx * scale, cy * scale, rx * scale, ry * scale];
    const x0 = Math.max(0, Math.floor(cx - rx));
    const x1 = Math.min(size - 1, Math.ceil(cx + rx));
    const y0 = Math.max(0, Math.floor(cy - ry));
    const y1 = Math.min(size - 1, Math.ceil(cy + ry));
    for (let y = y0; y <= y1; y += 1) {
      for (let x = x0; x <= x1; x += 1) {
        let hits = 0;
        for (const [sx, sy] of SUBSAMPLES) {
          const dx = (x + sx - cx) / rx;
          const dy = (y + sy - cy) / ry;
          if (dx * dx + dy * dy <= 1) hits += 1;
        }
        if (hits) blend(x, y, color, (hits / SUBSAMPLES.length) * opacity);
      }
    }
  }

  return { data, ellipse };
}

function drawCharacter(size, { eyes, mouth, cheeks = false }) {
  const { data, ellipse } = createCanvas(size);
  ellipse(500, 930, 270, 190, OUTLINE);
  ellipse(500, 930, 258, 178, SHIRT);
  ellipse(500, 470, 300, 285, OUTLINE);
  ellipse(500, 430, 290, 262, HAIR);
  ellipse(500, 505, 268, 228, SKIN);

  for (const x of [395, 605]) {
    if (eyes === 'open') {
      ellipse(x, 500, 34, 46, OUTLINE);
      ellipse(x + 10, 485, 11, 13, WHITE);
    } else if (eyes === 'closed') {
      ellipse(x, 510, 38, 7, OUTLINE);
    } else {
      ellipse(x, 505, 16, 16, OUTLINE);
    }
  }
  if (cheeks) {
    ellipse(335, 585, 42, 22, CHEEK, 0.7);
    ellipse(665, 585, 42, 22, CHEEK, 0.7);
  }

  if (mouth === 'closed') ellipse(500, 615, 40, 8, OUTLINE);
  else if (mouth === 'open') {
    ellipse(500, 622, 46, 36, OUTLINE);
    ellipse(500, 642, 26, 14, TONGUE);
  } else if (mouth === 'smile') {
    ellipse(500, 612, 70, 28, OUTLINE);
    ellipse(500, 596, 76, 24, SKIN);
  } else if (mouth === 'smile-open') {
    ellipse(500, 622, 70, 46, OUTLINE);
    ellipse(500, 650, 36, 16, TONGUE);
  } else if (mouth === 'o') {
    ellipse(500, 635, 30, 40, OUTLINE);
  }
  return encodePng(size, size, data);
}

const FRAMES = {
  default: {
    idle: { eyes: 'open', mouth: 'closed' },
    talk: { eyes: 'open', mouth: 'open' },
    blink: { eyes: 'closed', mouth: 'closed' },
    'blink-talk': { eyes: 'closed', mouth: 'open' },
  },
  happy: {
    idle: { eyes: 'open', mouth: 'smile', cheeks: true },
    talk: { eyes: 'open', mouth: 'smile-open', cheeks: true },
  },
  shock: {
    idle: { eyes: 'small', mouth: 'o' },
  },
};

const SAMPLE_CONFIG = {
  version: 1,
  name: 'sample',
  expressions: {
    happy: { key: 'F1', mode: 'timed', seconds: 4 },
    shock: { key: 'F2', mode: 'timed', seconds: 2 },
  },
  actions: { jump: { key: 'F5' }, shake: { key: 'F6' } },
  motion: { breathe: true, talkBounce: 8, blinkEvery: [2, 6] },
};

export async function writeSample(dir, { size = 1000 } = {}) {
  for (const [expression, frames] of Object.entries(FRAMES)) {
    await mkdir(path.join(dir, expression), { recursive: true });
    for (const [frame, look] of Object.entries(frames)) {
      await writeFile(path.join(dir, expression, `${frame}.png`), drawCharacter(size, look));
    }
  }
  // ชื่อจริงมาจากชื่อโฟลเดอร์เสมอ (loadAvatar เขียนทับ) จึงใส่ sample ไว้ได้เลย
  await writeFile(path.join(dir, 'avatar.json'), `${JSON.stringify(SAMPLE_CONFIG, null, 2)}\n`);
}

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const dir = path.join(root, 'avatars', 'sample');
  const exists = await stat(dir).then(() => true, () => false);
  if (exists && !process.argv.includes('--force')) {
    console.log('มี avatars/sample อยู่แล้ว (ใช้ npm run sample -- --force ถ้าต้องการวาดใหม่)');
    return;
  }
  await writeSample(dir);
  console.log('สร้างตัวละครตัวอย่างที่ avatars/sample แล้ว');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
