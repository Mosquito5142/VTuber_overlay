import { BUILTIN_ACTIONS } from './constants.js';
import { resolveFrame, wantedFrame } from './frames.js';

const BLINK_MS = 120;
const FADE_MS = 90; // นานกว่า transition ใน CSS (70ms) เล็กน้อย ให้รูปใหม่ทึบเต็มก่อนเอารูปเก่าออก
const SPRING = 320; // ความแข็งสปริงตอนเด้ง
const DAMPING = 20;
const LOUD_LEVEL = 0.5; // ระดับเสียงที่ถือว่าดังสุด (เด้งเต็ม talkBounce)
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

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
  let level = 0;
  let smoothLevel = 0;
  let y = 0;
  let vy = 0;
  let lastFrame = 0;
  let rafId = 0;
  let tickTimer = null;

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
        // รูปเสีย: จดไว้แล้วให้ลำดับสำรองเลือกรูปอื่นแทน
        img.addEventListener('error', () => {
          if (owner !== generation) return;
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
    const usable = {};
    for (const [expr, frames] of Object.entries(model.files)) {
      usable[expr] = frames.filter((f) => images.has(`${expr}/${f}.png`));
    }
    const rel = resolveFrame(usable, expression, wantedFrame({ talking, blinking }));
    const img = (rel && images.get(rel)) ?? null;
    if (img === visible) return;
    if (visible) {
      const leaving = visible;
      leaving.classList.replace('av-visible', 'av-leaving');
      clearTimeout(leaving.leaveTimer);
      leaving.leaveTimer = setTimeout(() => leaving.classList.remove('av-leaving'), FADE_MS);
    }
    if (img) {
      clearTimeout(img.leaveTimer);
      img.classList.remove('av-leaving');
      img.classList.add('av-visible');
    }
    visible = img;
  }

  // สปริงตามความดังเสียง + ยืดหดตามความเร็ว + ส่ายตัวเบาๆ ตอนหายใจ คำนวณทุกเฟรม
  // ปกติใช้ requestAnimationFrame (ลื่นสุด) แต่สำรองด้วย timer ไว้ เผื่อหน้าที่ไม่ได้วาดจอ (rAF หยุด) ตัวจะได้ไม่ค้างกลางเด้ง
  function scheduleTick() {
    rafId = requestAnimationFrame(() => tick(performance.now()));
    tickTimer = setTimeout(() => tick(performance.now()), 50);
  }

  function tick(now) {
    cancelAnimationFrame(rafId);
    clearTimeout(tickTimer);
    scheduleTick();
    const dt = Math.min(0.05, (now - (lastFrame || now)) / 1000);
    lastFrame = now;
    const motion = model?.config?.motion;
    const height = root.clientHeight || 1000;
    const unit = height / 1000; // talkBounce กำหนดเป็น px บนผืน 1000px
    smoothLevel += (level - smoothLevel) * Math.min(1, dt * 18);
    const loudness = clamp(smoothLevel / LOUD_LEVEL, 0, 1);
    const target = talking ? -(motion?.talkBounce ?? 0) * unit * (0.35 + 0.65 * loudness) : 0;
    vy += (SPRING * (target - y) - DAMPING * vy) * dt;
    y += vy * dt;
    const stretch = clamp((-vy / unit) * 0.0004, -0.04, 0.04);
    const t = now / 1000;
    const idle = motion?.breathe ? 1 : 0;
    const angle = idle * Math.sin((t * Math.PI * 2) / 6) * 0.6;
    const drift = idle * Math.sin((t * Math.PI * 2) / 9) * 0.004 * root.clientWidth;
    bounce.style.transform = `translate(${drift.toFixed(2)}px, ${y.toFixed(2)}px) rotate(${angle.toFixed(3)}deg) scale(${(1 - stretch).toFixed(4)}, ${(1 + stretch).toFixed(4)})`;
  }
  scheduleTick();

  function scheduleBlink() {
    clearTimeout(blinkTimer);
    blinking = false;
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
  }

  action.addEventListener('animationend', () => {
    action.className = 'av-action';
  });

  return {
    setModel(next) {
      const sig = JSON.stringify(Object.entries(next.files ?? {}).sort());
      const needImages = !model || next.avatar !== model.avatar || next.imageRev !== model.imageRev || sig !== model.sig;
      model = { avatar: next.avatar, config: next.config, files: structuredClone(next.files ?? {}), imageRev: next.imageRev, sig };
      if (needImages) rebuildImages();
      applyMotion();
      scheduleBlink();
      update();
    },
    setState(next) {
      talking = Boolean(next.talking);
      expression = next.expression ?? 'default';
      if (!talking) level = 0;
      update();
    },
    setLevel(value) {
      level = Number.isFinite(value) ? clamp(value, 0, 1) : 0;
    },
    play(name) {
      if (!BUILTIN_ACTIONS.includes(name)) return;
      action.className = 'av-action';
      void action.offsetWidth; // เริ่มแอนิเมชันใหม่แม้เป็นท่าเดิม
      action.classList.add(`av-play-${name}`);
    },
    destroy() {
      clearTimeout(blinkTimer);
      cancelAnimationFrame(rafId);
      clearTimeout(tickTimer);
      root.remove();
    },
  };
}
