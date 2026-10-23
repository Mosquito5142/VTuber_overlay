export async function listMics() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter((d) => d.kind === 'audioinput' && d.deviceId !== 'default').map((d) => ({ id: d.deviceId, label: d.label || 'ไมค์' }));
}

export async function startMic({ deviceId, onLevel, onEnded }) {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      deviceId: deviceId ? { exact: deviceId } : undefined,
      echoCancellation: false,
      noiseSuppression: true,
      autoGainControl: false,
    },
  });
  const context = new AudioContext();
  await context.audioWorklet.addModule('/studio/level-worklet.js');
  const source = context.createMediaStreamSource(stream);
  const meter = new AudioWorkletNode(context, 'level-meter');
  // RMS ของเสียงพูดมักอยู่ราว 0.01–0.2 ใช้รากที่สองให้แถบระดับเสียงอ่านง่ายขึ้น
  meter.port.onmessage = (event) => onLevel(Math.min(1, Math.sqrt(event.data)));
  source.connect(meter);
  meter.connect(context.destination); // ไม่มีเสียงออก (worklet ไม่เขียน output) แต่ทำให้ worklet ทำงานต่อเนื่อง
  const [track] = stream.getAudioTracks();
  track.addEventListener('ended', () => onEnded?.());
  return {
    context,
    label: track.label,
    async stop() {
      meter.port.onmessage = null;
      source.disconnect();
      meter.disconnect();
      for (const t of stream.getTracks()) t.stop();
      await context.close();
    },
  };
}
