import { FRAME_CHAIN } from './constants.js';

export function wantedFrame({ talking, blinking }) {
  if (blinking) return talking ? 'blink-talk' : 'blink';
  return talking ? 'talk' : 'idle';
}

export function resolveFrame(files, expression, frame) {
  const chain = FRAME_CHAIN[frame] ?? FRAME_CHAIN.idle;
  const order = expression === 'default' ? ['default'] : [expression, 'default'];
  for (const expr of order) {
    const available = files[expr] ?? [];
    for (const name of chain) {
      if (available.includes(name)) return `${expr}/${name}.png`;
    }
  }
  return null;
}
