import { createRenderer } from '/shared/renderer.js';
import { connectSocket } from '/shared/socket.js';
import { createVoiceGate } from '/shared/voice-gate.js';
import { api } from '/studio/api.js';
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
let settings = await api.getSettings();
const gate = createVoiceGate(settings.voice);
let mic = null;
let micWarning = null;
let serverWarnings = [];

function setPill(id, ok, text, title = '') {
  const el = $(id);
  el.textContent = text;
  el.dataset.ok = ok ? 'yes' : 'no';
  el.title = title;
}

function renderWarnings() {
  const all = micWarning ? [micWarning, ...serverWarnings] : serverWarnings;
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
    if (message.type === 'config') preview.setModel(message);
    else if (message.type === 'state') preview.setState(message);
    else if (message.type === 'play') preview.play(message.action);
    else if (message.type === 'status') {
      setPill('st-hotkeys', message.hotkeys.ok, message.hotkeys.ok ? 'ปุ่มลัด ✓' : 'ปุ่มลัดใช้ไม่ได้', message.hotkeys.error ?? '');
      setPill('st-avatars', message.avatars > 0, `OBS: ${message.avatars}`, 'จำนวนหน้า /avatar ที่เปิดอยู่ (เช่นใน OBS)');
      serverWarnings = message.warnings;
      renderWarnings();
    }
  },
});

const saveSettingsSoon = debounce(async () => {
  try {
    settings = await api.saveSettings(settings);
  } catch (error) {
    serverWarnings = [...serverWarnings, error.message];
    renderWarnings();
  }
}, 400);

// ---- ไมค์ ----

function onLevel(level) {
  const talking = gate.update(level, performance.now());
  socket.send({ type: 'voice', level, talking });
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

async function restartMic() {
  await mic?.stop();
  mic = null;
  try {
    try {
      mic = await startMic({ deviceId: settings.voice.deviceId, onLevel, onEnded: () => setMicProblem('ไมค์หลุด — เสียบกลับแล้วระบบจะลองใหม่เอง') });
    } catch (error) {
      if (error.name !== 'OverconstrainedError' && error.name !== 'NotFoundError') throw error;
      mic = await startMic({ deviceId: null, onLevel, onEnded: () => setMicProblem('ไมค์หลุด — เสียบกลับแล้วระบบจะลองใหม่เอง') });
    }
    if (mic.context.state === 'suspended') {
      setMicProblem('คลิกที่ใดก็ได้ในหน้านี้ 1 ครั้งเพื่อเปิดไมค์');
      window.addEventListener('pointerdown', async () => {
        await mic.context.resume();
        setMicOk();
      }, { once: true });
    } else {
      setMicOk();
    }
    await fillMicList();
  } catch (error) {
    setMicProblem(error.name === 'NotAllowedError'
      ? 'เบราว์เซอร์ยังไม่ได้รับอนุญาตให้ใช้ไมค์ — กดไอคอนข้างช่อง URL เลือก "อนุญาต" ไมโครโฟน แล้วรีเฟรชหน้า'
      : `เปิดไมค์ไม่ได้: ${error.message}`);
  }
}

navigator.mediaDevices.addEventListener('devicechange', () => {
  if (micWarning) restartMic();
  else fillMicList();
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
  await navigator.clipboard.writeText(`${location.origin}/avatar/`);
  const button = $('copy-obs');
  button.textContent = 'คัดลอกแล้ว ✓';
  setTimeout(() => { button.textContent = 'คัดลอก URL สำหรับ OBS'; }, 1500);
});

showVoiceSettings();
restartMic();
