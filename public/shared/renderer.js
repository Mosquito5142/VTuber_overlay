import { BUILTIN_ACTIONS } from './constants.js';
import { resolveFrame, wantedFrame } from './frames.js';

const BLINK_MS = 120;

export function createRenderer(container) {
  const root = document.createElement('div');
  root.className = 'av-root';
  const bounce = document.createElement('div');
  bounce.className = 'av-bounce';
  const action = document.createElement('div');
  action.className = 'av-action';
  bounce.append(action);
  root.append(bounce);
  container.append(root);

  let model = null;
  let talking = false;
  let expression = 'default';
  let blinking = false;
  let images = new Map();
  let visible = null;
  let blinkTimer = null;
  let generation = 0;

  function rebuildImages() {
    generation += 1;
    const owner = generation;
    action.replaceChildren();
    images = new Map();
    visible = null;
    if (!model?.avatar) return;
    for (const [expr, frames] of Object.entries(model.files)) {
      for (const frame of frames) {
        const rel = `${expr}/${frame}.png`;
        const img = document.createElement('img');
        img.className = 'av-frame';
        img.alt = '';
        img.draggable = false;
        // รูปเสีย: ตัดออกจากรายการแล้วให้ลำดับสำรองเลือกรูปอื่นแทน
        img.addEventListener('error', () => {
          if (owner !== generation) return;
          model.files[expr] = (model.files[expr] ?? []).filter((f) => f !== frame);
          img.remove();
          images.delete(rel);
          if (visible === img) visible = null;
          update();
        });
        img.src = `/avatars/${encodeURIComponent(model.avatar)}/${rel}?v=${model.imageRev}`;
        action.append(img);
        images.set(rel, img);
      }
    }
  }

  function update() {
    if (!model?.avatar) return;
    const rel = resolveFrame(model.files, expression, wantedFrame({ talking, blinking }));
    const img = (rel && images.get(rel)) ?? null;
    if (img === visible) return;
    visible?.classList.remove('av-visible');
    img?.classList.add('av-visible');
    visible = img;
  }

  function scheduleBlink() {
    clearTimeout(blinkTimer);
    const range = model?.config?.motion?.blinkEvery;
    if (!range) return;
    const wait = (range[0] + Math.random() * (range[1] - range[0])) * 1000;
    blinkTimer = setTimeout(() => {
      blinking = true;
      update();
      blinkTimer = setTimeout(() => {
        blinking = false;
        update();
        scheduleBlink();
      }, BLINK_MS);
    }, wait);
  }

  function applyMotion() {
    const motion = model?.config?.motion;
    root.classList.toggle('av-breathe', Boolean(motion?.breathe));
    bounce.style.setProperty('--av-talk-bounce', `${motion?.talkBounce ?? 0}px`);
  }

  action.addEventListener('animationend', () => {
    action.className = 'av-action';
  });

  return {
    setModel(next) {
      const needImages = !model || next.avatar !== model.avatar || next.imageRev !== model.imageRev;
      model = { avatar: next.avatar, config: next.config, files: structuredClone(next.files ?? {}), imageRev: next.imageRev };
      if (needImages) rebuildImages();
      applyMotion();
      scheduleBlink();
      update();
    },
    setState(next) {
      talking = Boolean(next.talking);
      expression = next.expression ?? 'default';
      bounce.classList.toggle('av-talking', talking);
      update();
    },
    play(name) {
      if (!BUILTIN_ACTIONS.includes(name)) return;
      action.className = 'av-action';
      void action.offsetWidth; // เริ่มแอนิเมชันใหม่แม้เป็นท่าเดิม
      action.classList.add(`av-play-${name}`);
    },
    destroy() {
      clearTimeout(blinkTimer);
      root.remove();
    },
  };
}
