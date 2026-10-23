import { BUILTIN_ACTIONS, FRAME_NAMES, isValidName } from '/shared/constants.js';
import { keyFromBrowserEvent } from '/shared/keys.js';

const FRAME_LABELS = { idle: 'เงียบ', talk: 'พูด', blink: 'หลับตา', 'blink-talk': 'พูด+หลับตา' };
const ACTION_LABELS = { jump: 'กระโดด', shake: 'สั่น', spin: 'หมุน', wobble: 'เด้งดึ๋ง' };
const NAME_HINT = 'ใช้ได้เฉพาะ a-z, 0-9 และ - (ไม่เกิน 32 ตัว) และห้ามใช้ชื่อที่ Windows สงวน เช่น con, nul, aux, com1';

function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [name, value] of Object.entries(props)) {
    if (name.startsWith('on')) el.addEventListener(name.slice(2), value);
    else if (value === true) el.setAttribute(name, '');
    else if (value !== false && value != null) el.setAttribute(name, value);
  }
  el.append(...children.flat().filter((child) => child != null && child !== false));
  return el;
}

export function createEditor(container, { api, send, onSelectAvatar }) {
  let model = null;
  let draft = null;
  let avatars = [];
  let errors = [];
  let capturing = null;
  let newAvatarName = '';
  let newExpressionName = '';

  const setErrors = (error) => {
    errors = error.errors?.length ? error.errors : [error.message];
    render();
  };

  // บันทึกทีละรอบ: ถ้ามีการแก้ระหว่างบันทึก จะวนบันทึกซ้ำจนไม่มีอะไรค้าง
  let saveTimer = null;
  let inFlight = null;
  let dirty = false;

  function runSave() {
    if (inFlight) return inFlight;
    inFlight = (async () => {
      try {
        while (dirty) {
          dirty = false;
          if (!model?.avatar || !draft) break;
          const hadErrors = errors.length > 0;
          try {
            await api.saveConfig(model.avatar, draft);
            errors = [];
            if (hadErrors) render(); // วาดใหม่เฉพาะตอนต้องล้างข้อผิดพลาด (กันช่องกรอกเสียโฟกัส)
          } catch (error) {
            setErrors(error);
          }
        }
      } finally {
        inFlight = null;
      }
    })();
    return inFlight;
  }

  function saveSoon() {
    dirty = true;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { saveTimer = null; runSave(); }, 300);
  }

  async function flushSave() {
    clearTimeout(saveTimer);
    saveTimer = null;
    await runSave();
  }

  function change(mutate) {
    mutate(draft);
    render();
    saveSoon();
  }

  // กันเบราว์เซอร์เปิดไฟล์ที่ลากมาวางนอกช่อง
  window.addEventListener('dragover', (event) => event.preventDefault());
  window.addEventListener('drop', (event) => event.preventDefault());

  // คลิกที่อื่นระหว่างรอจับปุ่ม = ยกเลิก (แก้ปุ่มเดิมในที่ ไม่วาดใหม่ เพื่อให้คลิกถัดไปไม่หลุด)
  window.addEventListener('pointerdown', (event) => {
    if (!capturing) return;
    const { el, label } = capturing;
    if (el?.contains(event.target)) return;
    capturing = null;
    if (el) { el.className = 'key'; el.textContent = label; }
  }, true);

  window.addEventListener('keydown', (event) => {
    if (!capturing) return;
    event.preventDefault();
    event.stopPropagation();
    const { apply } = capturing;
    if (event.key === 'Escape') {
      capturing = null;
      apply(null);
      return;
    }
    const key = keyFromBrowserEvent(event);
    if (!key) return; // กดแค่ Ctrl/Alt/Shift ยังไม่จบ รอปุ่มหลัก
    capturing = null;
    apply(key);
  }, true);

  const panel = (title, ...children) => h('section', { class: 'panel' }, h('h2', {}, title), ...children);

  function keyButton(id, key, apply) {
    const waiting = capturing?.id === id;
    const label = key ? `ปุ่ม: ${key}` : 'ตั้งปุ่มลัด';
    const button = h('button', {
      type: 'button',
      class: waiting ? 'key waiting' : 'key',
      onclick: () => { capturing = { id, apply, label, el: button }; render(); },
    }, waiting ? 'กดปุ่มที่ต้องการ… (Esc = ล้าง)' : label);
    if (waiting) Object.assign(capturing, { label, el: button });
    return button;
  }

  function avatarPanel() {
    const nameInput = h('input', {
      placeholder: 'ชื่อใหม่ เช่น my-char', maxlength: 32, value: newAvatarName,
      oninput: (event) => { newAvatarName = event.target.value; },
    });
    const create = async () => {
      const name = newAvatarName.trim().toLowerCase();
      if (!isValidName(name)) {
        errors = [`ชื่อตัวละคร${NAME_HINT}`];
        render(); // ค่าที่พิมพ์ค้างอยู่ใน newAvatarName จึงไม่หาย
        return;
      }
      try {
        await flushSave();
        avatars = (await api.createAvatar(name)).avatars;
        errors = [];
        newAvatarName = '';
        await onSelectAvatar(name);
      } catch (error) {
        setErrors(error);
      }
    };
    return panel('ตัวละคร',
      h('div', { class: 'row' },
        h('select', { onchange: async (event) => { try { await flushSave(); await onSelectAvatar(event.target.value); } catch (error) { setErrors(error); } } },
          avatars.map((name) => h('option', { value: name, selected: name === model?.avatar }, name))),
        nameInput,
        h('button', { type: 'button', onclick: create }, '＋ ตัวละครใหม่')));
  }

  async function upload(expression, frame, file) {
    if (!file) return;
    if (file.type !== 'image/png') {
      errors = ['รองรับเฉพาะไฟล์ PNG (พื้นใส)'];
      render();
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      errors = ['ไฟล์ใหญ่เกินไป (สูงสุด 10 MB)'];
      render();
      return;
    }
    try {
      await api.uploadFrame(model.avatar, expression, frame, file);
      if (errors.length) {
        errors = [];
        render();
      }
    } catch (error) {
      setErrors(error);
    }
  }

  function frameSlot(expression, frame) {
    const has = model.files[expression]?.includes(frame);
    const required = expression === 'default' && frame === 'idle';
    return h('label', {
      class: has ? 'slot checker filled' : 'slot',
      title: `${expression} / ${FRAME_LABELS[frame]} — คลิกหรือลากไฟล์ PNG มาวาง`,
      ondragover: (event) => event.preventDefault(),
      ondrop: (event) => {
        event.preventDefault();
        upload(expression, frame, event.dataTransfer.files[0]);
      },
    },
    has
      ? h('img', { src: `/avatars/${encodeURIComponent(model.avatar)}/${encodeURIComponent(expression)}/${frame}.png?v=${model.imageRev}`, alt: '' })
      : h('span', {}, required ? 'จำเป็น ＋' : '＋'),
    h('input', { type: 'file', accept: 'image/png', hidden: true, onchange: (event) => upload(expression, frame, event.target.files[0]) }));
  }

  function imagesPanel() {
    const rows = ['default', ...Object.keys(draft.expressions)];
    return panel('รูปภาพ',
      h('table', { class: 'frames' },
        h('thead', {}, h('tr', {}, h('th', {}, 'สีหน้า'), FRAME_NAMES.map((frame) => h('th', {}, FRAME_LABELS[frame])))),
        h('tbody', {}, rows.map((expression) => h('tr', {},
          h('th', {}, expression),
          FRAME_NAMES.map((frame) => h('td', {}, frameSlot(expression, frame))))))),
      h('p', { class: 'hint' }, 'PNG พื้นใส ขนาดเท่ากันทุกรูป ตัวละครอยู่ตำแหน่งเดียวกัน ขั้นต่ำต้องมี default / เงียบ ช่องที่ว่างจะใช้รูปสำรองให้อัตโนมัติ'));
  }

  function expressionRow(name, def) {
    return h('div', { class: 'row' },
      h('strong', { class: 'name' }, name),
      h('select', {
        onchange: (event) => change((d) => {
          const mode = event.target.value;
          d.expressions[name] = mode === 'timed' ? { key: def.key, mode, seconds: def.seconds ?? 3 } : { key: def.key, mode };
        }),
      },
      h('option', { value: 'timed', selected: def.mode === 'timed' }, 'แสดงชั่วคราว'),
      h('option', { value: 'toggle', selected: def.mode === 'toggle' }, 'กดเปิด / กดปิด')),
      def.mode === 'timed'
        ? h('label', {},
          h('input', { type: 'number', min: 0.5, max: 60, step: 0.5, value: def.seconds, onchange: (event) => change((d) => { d.expressions[name].seconds = Number(event.target.value); }) }),
          ' วินาที')
        : null,
      keyButton(`expression:${name}`, def.key, (key) => change((d) => { if (d.expressions[name]) d.expressions[name].key = key; })),
      h('button', { type: 'button', onclick: () => send({ type: 'expression', name }) }, 'ทดลอง'),
      h('button', { type: 'button', class: 'danger', onclick: () => change((d) => { delete d.expressions[name]; }) }, 'ลบ'));
  }

  function expressionsPanel() {
    const nameInput = h('input', {
      placeholder: 'ชื่อสีหน้า เช่น happy', maxlength: 32, value: newExpressionName,
      oninput: (event) => { newExpressionName = event.target.value; },
    });
    const add = () => {
      const name = newExpressionName.trim().toLowerCase();
      if (name === 'default' || !isValidName(name) || draft.expressions[name]) {
        errors = [`ชื่อสีหน้า${NAME_HINT} ห้ามซ้ำ และห้ามใช้ default`];
        render();
        return;
      }
      newExpressionName = '';
      change((d) => { d.expressions[name] = { key: null, mode: 'timed', seconds: 3 }; });
    };
    return panel('สีหน้า',
      Object.entries(draft.expressions).map(([name, def]) => expressionRow(name, def)),
      h('div', { class: 'row' },
        nameInput,
        h('button', { type: 'button', onclick: add }, '＋ เพิ่มสีหน้า'),
        h('button', { type: 'button', onclick: () => send({ type: 'expression', name: 'default' }) }, 'กลับสีหน้าปกติ')),
      h('p', { class: 'hint' }, 'แนะนำปุ่ม F1–F12 หรือกดคู่กับ Ctrl/Alt เพื่อไม่ให้ชนปุ่มที่ใช้เล่นเกม'));
  }

  function actionsPanel() {
    return panel('ท่า (ไม่ต้องมีรูปเพิ่ม)', BUILTIN_ACTIONS.map((name) => {
      const def = draft.actions[name];
      return h('div', { class: 'row' },
        h('label', { class: 'name' },
          h('input', {
            type: 'checkbox',
            checked: Boolean(def),
            onchange: (event) => change((d) => {
              if (event.target.checked) d.actions[name] = { key: null };
              else delete d.actions[name];
            }),
          }),
          ` ${ACTION_LABELS[name]}`),
        def ? keyButton(`action:${name}`, def.key, (key) => change((d) => { if (d.actions[name]) d.actions[name].key = key; })) : null,
        h('button', { type: 'button', onclick: () => send({ type: 'action', name }) }, 'ทดลอง'));
    }));
  }

  function motionPanel() {
    const motion = draft.motion;
    const bounceOut = h('output', {}, `${motion.talkBounce}px`);
    return panel('ขยับอัตโนมัติ',
      h('label', { class: 'row' },
        h('input', { type: 'checkbox', checked: motion.breathe, onchange: (event) => change((d) => { d.motion.breathe = event.target.checked; }) }),
        ' หายใจ'),
      h('label', { class: 'row' }, 'เด้งตอนพูด ',
        h('input', {
          type: 'range', min: 0, max: 40, step: 1, value: motion.talkBounce,
          oninput: (event) => { bounceOut.textContent = `${event.target.value}px`; },
          onchange: (event) => change((d) => { d.motion.talkBounce = Number(event.target.value); }),
        }),
        bounceOut),
      h('label', { class: 'row' }, 'กระพริบตาทุก ',
        h('input', { type: 'number', min: 0.5, max: 30, step: 0.5, value: motion.blinkEvery[0], onchange: (event) => change((d) => { d.motion.blinkEvery = [Number(event.target.value), d.motion.blinkEvery[1]]; }) }),
        ' ถึง ',
        h('input', { type: 'number', min: 0.5, max: 30, step: 0.5, value: motion.blinkEvery[1], onchange: (event) => change((d) => { d.motion.blinkEvery = [d.motion.blinkEvery[0], Number(event.target.value)]; }) }),
        ' วินาที'));
  }

  function render() {
    const errorBox = errors.length ? h('div', { class: 'errors' }, errors.map((text) => h('div', {}, `✗ ${text}`))) : null;
    if (!model?.avatar || !draft) {
      container.replaceChildren(...[errorBox, avatarPanel()].filter(Boolean));
      return;
    }
    container.replaceChildren(...[errorBox, avatarPanel(), imagesPanel(), expressionsPanel(), actionsPanel(), motionPanel()].filter(Boolean));
  }

  return {
    setModel(message) {
      if (model && message.avatar !== model.avatar) capturing = null;
      if (model && draft && message.avatar === model.avatar && (saveTimer || inFlight)) {
        // มีการแก้ค้าง/กำลังบันทึก: ห้ามให้ข้อความของรอบก่อนมาทับ draft
        const imagesChanged = message.imageRev !== model.imageRev;
        model = message;
        if (imagesChanged) render();
        return;
      }
      const unchanged = model && draft
        && message.avatar === model.avatar
        && message.imageRev === model.imageRev
        && JSON.stringify(message.config) === JSON.stringify(draft);
      model = message;
      if (unchanged) return; // ข้อความยืนยันการบันทึกของเราเอง ไม่ต้องวาดใหม่ (กันช่องกรอกเสียโฟกัส)
      draft = message.config ? structuredClone(message.config) : null;
      render();
    },
    setAvatars(names) {
      avatars = names;
      render();
    },
  };
}
