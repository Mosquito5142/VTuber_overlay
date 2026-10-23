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

// ชื่อที่ Windows สงวนไว้ สร้างเป็นโฟลเดอร์แล้วเปิด/ลบด้วยโปรแกรมทั่วไปไม่ได้
const RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/;

export const isValidName = (name) => typeof name === 'string' && NAME_PATTERN.test(name) && !RESERVED_NAMES.test(name);

export const DEFAULT_PORT = 5180;
