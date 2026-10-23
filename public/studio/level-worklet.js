// ทำงานบนเธรดเสียงของเบราว์เซอร์ จึงไม่ถูกลดความเร็วตอนแท็บถูกย่อหรืออยู่เบื้องหลัง
class LevelMeter extends AudioWorkletProcessor {
  constructor() {
    super();
    this.sum = 0;
    this.count = 0;
    this.window = Math.round(sampleRate / 30);
  }

  process(inputs) {
    const channel = inputs[0]?.[0];
    if (channel) {
      for (let i = 0; i < channel.length; i += 1) this.sum += channel[i] * channel[i];
      this.count += channel.length;
      if (this.count >= this.window) {
        this.port.postMessage(Math.sqrt(this.sum / this.count));
        this.sum = 0;
        this.count = 0;
      }
    }
    return true;
  }
}

registerProcessor('level-meter', LevelMeter);
