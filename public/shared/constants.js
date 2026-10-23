export const FRAME_NAMES = ['idle', 'talk', 'blink', 'blink-talk'];

// ลำดับไฟล์ที่ลองหาในแต่ละสีหน้า ถ้าไม่มีไฟล์แรกก็ใช้ตัวถัดไป
export const FRAME_CHAIN = {
  idle: ['idle'],
  talk: ['talk', 'idle'],
  blink: ['blink', 'idle'],
  'blink-talk': ['blink-talk', 'talk', 'idle'],
};

export const BUILTIN_ACTIONS = ['jump', 'shake', 'spin', 'wobble'];

export const NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,31}$/;

export const DEFAULT_PORT = 5180;
