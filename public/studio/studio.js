import { createRenderer } from '/shared/renderer.js';
import { connectSocket } from '/shared/socket.js';
import { createVoiceGate } from '/shared/voice-gate.js';
import { api } from '/studio/api.js';
import { createEditor } from '/studio/editor.js';
import { listMics, startMic } from '/studio/mic.js';

const $ = (id) => document.getElementById(id);
const debounce = (fn, ms) => {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
};

const preview = createRenderer($('preview'));
const editor = createEditor($('editor'), {
  api,
  send: (message) => socket.send(message),
  onSelectAvatar: selectAvatar,
});
let settings;
let startupWarning = null;
try {
  settings = await api.getSettings();
} catch {
  settings = { voice: { threshold: 0.08, releaseMs: 150, deviceId: null }, activeAvatar: null };
  startupWarning = 'ต่อ server ไม่ได้ — เปิด start.bat ไว้หรือยัง?';
}
const gate = createVoiceGate(settings.voice);
let mic = null;
let micWarning = null;
let serverWarnings = [];
let saveWarning = null;
let pendingResume = null;

function setPill(id, ok, text, title = '') {
  const el = $(id);
  el.textContent = text;
  el.dataset.ok = ok ? 'yes' : 'no';
  el.title = title;
}

function renderWarnings() {
  const all = [micWarning, startupWarning, saveWarning, ...serverWarnings].filter(Boolean);
  const box = $('warnings');
  box.hidden = all.length === 0;
  box.replaceChildren(...all.map((text) => Object.assign(document.createElement('div'), { textContent: `⚠ ${text}` })));
}

const socket = connectSocket({
  role: 'studio',
  onOpen() {
    setPill('st-server', true, 'server ✓');
  },
  onClose() {
    setPill('st-server', false, 'server หลุด — กำลังต่อใหม่', 'เปิด start.bat ไว้หรือยัง?');
  },
  onMessage(message) {
    if (message.type === 'config') {
      preview.setModel(message);
      editor.setModel(message);
    } else if (message.type === 'state') preview.setState(message);
    else if (message.type === 'play') preview.play(message.action);
    else if (message.type === 'status') {
      setPill('st-hotkeys', message.hotkeys.ok, message.hotkeys.ok ? 'ปุ่มลัด ✓' : 'ปุ่มลัดใช้ไม่ได้', message.hotkeys.error ?? '');
      setPill('st-avatars', message.avatars > 0, `OBS: ${message.avatars}`, 'จำนวนหน้า /avatar ที่เปิดอยู่ (เช่นใน OBS)');
      serverWarnings = message.warnings;
      renderWarnings();
    }
  },
});

// `settings` ในหน่วยความจำคือแหล่งความจริง — การบันทึกแค่เขียนมันลง server ไม่เอา response มาทับ
async function saveSettingsNow() {
  try {
    await api.saveSettings(settings);
    saveWarning = null;
  } catch (error) {
    saveWarning = error.message;
    throw error;
  } finally {
    renderWarnings();
  }
}

const saveSettingsSoon = debounce(() => saveSettingsNow().catch(() => {}), 400);

async function selectAvatar(name) {
  settings.activeAvatar = name;
  await saveSettingsNow();
  editor.setAvatars((await api.listAvatars()).avatars);
}

// ---- ไมค์ ----

function onLevel(level) {
  const talking = gate.update(level, performance.now());
  socket.send({ type: 'voice', level, talking });
  preview.setLevel(level);
  $('meter-fill').style.width = `${level * 100}%`;
}

function setMicOk() {
  micWarning = null;
  setPill('st-mic', true, `ไมค์ ✓ ${mic?.label ?? ''}`);
  renderWarnings();
}

function setMicProblem(text) {
  micWarning = text;
  setPill('st-mic', false, 'ไมค์ ✗');
  renderWarnings();
  socket.send({ type: 'voice', level: 0, talking: false });
}

async function fillMicList() {
  const select = $('mic-device');
  const mics = await listMics();
  select.replaceChildren(
    new Option('ไมค์หลักของเครื่อง', ''),
    ...mics.map((m) => new Option(m.label, m.id)),
  );
  select.value = mics.some((m) => m.id === settings.voice.deviceId) ? settings.voice.deviceId : '';
}

function clearPendingResume() {
  if (pendingResume) window.removeEventListener('pointerdown', pendingResume);
  pendingResume = null;
}

async function doRestartMic() {
  clearPendingResume();
  const old = mic;
  mic = null;
  try {
    await old?.stop().catch(() => {});
    const onEnded = () => setMicProblem('ไมค์หลุด — เสียบกลับแล้วระบบจะลองใหม่เอง');
    try {
      mic = await startMic({ deviceId: settings.voice.deviceId, onLevel, onEnded });
    } catch (error) {
      if (error.name !== 'OverconstrainedError' && error.name !== 'NotFoundError') throw error;
      mic = await startMic({ deviceId: null, onLevel, onEnded });
    }
    const current = mic;
    if (current.context.state === 'suspended') {
      setMicProblem('คลิกที่ใดก็ได้ในหน้านี้ 1 ครั้งเพื่อเปิดไมค์');
      pendingResume = async () => {
        pendingResume = null;
        await current.context.resume();
        if (mic === current && current.context.state === 'running') setMicOk();
      };
      window.addEventListener('pointerdown', pendingResume, { once: true });
    } else {
      setMicOk();
    }
    await fillMicList();
  } catch (error) {
    if (error.name === 'NotFoundError') {
      setMicProblem('ไม่พบไมค์ในเครื่อง — เสียบไมค์แล้วระบบจะลองใหม่เอง');
      await fillMicList().catch(() => {});
    } else {
      let message = `เปิดไมค์ไม่ได้: ${error.message}`;
      if (error.name === 'NotAllowedError') message = 'เบราว์เซอร์ยังไม่ได้รับอนุญาตให้ใช้ไมค์ — กดไอคอนข้างช่อง URL เลือก "อนุญาต" ไมโครโฟน แล้วรีเฟรชหน้า';
      else if (error.name === 'NotReadableError') message = 'ไมค์ถูกโปรแกรมอื่นใช้อยู่ — ปิดโปรแกรมนั้น (เช่น Discord/โปรแกรมอัดเสียง) แล้วเลือกไมค์ใหม่อีกครั้ง';
      setMicProblem(message);
    }
  }
}

// ทำทีละรอบ: การรีสตาร์ทที่ซ้อนกันจะรอรอบก่อนหน้าจบก่อน
let restartChain = Promise.resolve();
function restartMic() {
  restartChain = restartChain.then(doRestartMic, doRestartMic);
  return restartChain;
}

navigator.mediaDevices.addEventListener('devicechange', () => {
  (micWarning ? restartMic() : fillMicList()).catch(() => {});
});

$('mic-device').addEventListener('change', (event) => {
  settings.voice.deviceId = event.target.value || null;
  saveSettingsSoon();
  restartMic();
});

function showVoiceSettings() {
  const { threshold, releaseMs } = settings.voice;
  $('threshold').value = threshold;
  $('threshold-out').textContent = threshold.toFixed(2);
  $('release').value = releaseMs;
  $('release-out').textContent = `${releaseMs} ms`;
  $('meter-threshold').style.left = `${threshold * 100}%`;
}

function setVoice(patch) {
  settings.voice = { ...settings.voice, ...patch };
  gate.setOptions(settings.voice);
  showVoiceSettings();
  saveSettingsSoon();
}

$('threshold').addEventListener('input', (event) => setVoice({ threshold: Number(event.target.value) }));
$('release').addEventListener('input', (event) => setVoice({ releaseMs: Number(event.target.value) }));
$('meter').addEventListener('pointerdown', (event) => {
  const rect = event.currentTarget.getBoundingClientRect();
  const threshold = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
  setVoice({ threshold: Math.round(threshold * 100) / 100 });
});

$('copy-obs').addEventListener('click', async () => {
  const button = $('copy-obs');
  try {
    await navigator.clipboard.writeText(`${location.origin}/avatar/`);
    button.textContent = 'คัดลอกแล้ว ✓';
  } catch {
    button.textContent = 'คัดลอกไม่ได้';
  }
  setTimeout(() => { button.textContent = 'คัดลอก URL สำหรับ OBS'; }, 1500);
});

showVoiceSettings();
restartMic();
try {
  editor.setAvatars((await api.listAvatars()).avatars);
} catch {
  // เซิร์ฟเวอร์ยังไม่พร้อม — ปล่อยรายการตัวละครว่างไว้
}
