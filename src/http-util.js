import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';

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
  createReadStream(full).pipe(res);
  return true;
}

export function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        const error = new Error('body too large');
        error.code = 'TOO_LARGE';
        req.destroy();
        reject(error);
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
