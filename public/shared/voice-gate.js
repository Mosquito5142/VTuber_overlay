export function createVoiceGate({ threshold = 0.08, releaseMs = 150 } = {}) {
  let talking = false;
  let lastLoudAt = -Infinity;
  return {
    update(level, now) {
      if (level >= threshold) {
        talking = true;
        lastLoudAt = now;
      } else if (talking && now - lastLoudAt >= releaseMs) {
        talking = false;
      }
      return talking;
    },
    setOptions(options) {
      if (typeof options.threshold === 'number') threshold = options.threshold;
      if (typeof options.releaseMs === 'number') releaseMs = options.releaseMs;
    },
    get talking() {
      return talking;
    },
  };
}
