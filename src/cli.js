#!/usr/bin/env node
import { exec } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_PORT } from '../public/shared/constants.js';
import { writeSample } from '../scripts/make-sample.js';
import { listAvatars } from './config.js';
import { startServer } from './server.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
  const options = { port: DEFAULT_PORT, open: true };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--port') options.port = Number(argv[++i]);
    else if (argv[i] === '--no-open') options.open = false;
  }
  if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535) {
    console.error('--port ต้องเป็นตัวเลข 1–65535');
    process.exit(1);
  }
  return options;
}

function openBrowser(url) {
  const command = process.platform === 'win32' ? `start "" "${url}"` : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
  exec(command, () => {});
}

const options = parseArgs(process.argv.slice(2));
const avatarsDir = path.join(ROOT, 'avatars');
if ((await listAvatars(avatarsDir)).length === 0) {
  await writeSample(path.join(avatarsDir, 'sample'));
  console.log('สร้างตัวละครตัวอย่าง (avatars/sample) ให้ทดลองใช้แล้ว');
}

try {
  const server = await startServer({ root: ROOT, port: options.port });
  console.log('\n Avata-Overlay พร้อมแล้ว');
  console.log(`   หน้าควบคุม:      ${server.url}/studio/`);
  console.log(`   URL สำหรับ OBS: ${server.url}/avatar/`);
  console.log('\n เปิดหน้าต่างนี้ค้างไว้ตลอดตอนสตรีม (กด Ctrl+C เพื่อปิด)\n');
  if (options.open) openBrowser(`${server.url}/studio/`);
  process.on('SIGINT', async () => {
    await server.close();
    process.exit(0);
  });
} catch (error) {
  if (error.code === 'EADDRINUSE') {
    console.error(`\n พอร์ต ${options.port} ถูกโปรแกรมอื่นใช้อยู่ (หรือเปิด Avata-Overlay ซ้อนไว้แล้ว)`);
    console.error(' ปิดโปรแกรมนั้นก่อน หรือเปลี่ยนพอร์ตด้วย: npm start -- --port 5181');
    console.error(' ถ้าเปลี่ยนพอร์ต ต้องแก้ URL ใน OBS ให้ตรงด้วย\n');
    process.exit(1);
  }
  throw error;
}
