import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream';

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

export function sendJson(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(data),
    'Cache-Control': 'no-store',
  });
  res.end(data);
}

export function redirect(res, status, location) {
  res.writeHead(status, { Location: location });
  res.end();
}

// คืน true ถ้าส่งไฟล์แล้ว, false ถ้าไม่พบหรือ path พยายามออกนอก baseDir
export async function serveFile(res, baseDir, relativePath) {
  const base = path.resolve(baseDir);
  let full = path.resolve(base, relativePath);
  if (full !== base && !full.startsWith(base + path.sep)) return false;
  let info;
  try {
    info = await stat(full);
    if (info.isDirectory()) {
      full = path.join(full, 'index.html');
      info = await stat(full);
    }
  } catch {
    return false;
  }
  res.writeHead(200, {
    'Content-Type': CONTENT_TYPES[path.extname(full).toLowerCase()] ?? 'application/octet-stream',
    'Content-Length': info.size,
    'Cache-Control': 'no-cache',
  });
  // header ส่งไปแล้ว ถ้าอ่านไฟล์พลาดกลางทางทำได้แค่ตัดการเชื่อมต่อ (pipeline ทำให้เอง)
  pipeline(createReadStream(full), res, () => {});
  return true;
}

export function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const tooLarge = () => {
      const error = new Error('body too large');
      error.code = 'TOO_LARGE';
      return error;
    };
    // ไม่ destroy: ต้องอ่านทิ้งให้หมดเพื่อให้ส่ง 413 กลับไปถึง client ได้
    if (Number(req.headers['content-length']) > limit) {
      req.resume();
      reject(tooLarge());
      return;
    }
    const chunks = [];
    let size = 0;
    let exceeded = false;
    req.on('data', (chunk) => {
      if (exceeded) return;
      size += chunk.length;
      if (size > limit) {
        exceeded = true;
        chunks.length = 0;
        req.resume();
        reject(tooLarge());
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
