const CutShutterSound = (() => {
  "use strict";

  let audioContext;

  async function prepare() {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) {
      return;
    }
    try {
      audioContext ||= new AudioContext();
      if (audioContext.state === "suspended") {
        await audioContext.resume();
      }
      if (audioContext.state === "running") {
        return audioContext;
      }
    } catch (_error) {
      // Audio is optional and should not block saving.
    }
  }

  async function play(preparedAudio) {
    const context = await preparedAudio;
    if (!context || context.state !== "running") {
      return;
    }
    const start = context.currentTime + 0.01;
    playClickTone(context, start, 1250, 0.04, 0.14);
    playClickTone(context, start + 0.055, 760, 0.06, 0.1);
    playShutterNoise(context, start + 0.015, 0.075, 0.04);
  }

  function playClickTone(context, start, frequency, duration, volume) {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "square";
    oscillator.frequency.setValueAtTime(frequency, start);
    gain.gain.setValueAtTime(volume, start);
    gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(start);
    oscillator.stop(start + duration);
  }

  function playShutterNoise(context, start, duration, volume) {
    const sampleCount = Math.max(1, Math.floor(context.sampleRate * duration));
    const buffer = context.createBuffer(1, sampleCount, context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < sampleCount; i += 1) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / sampleCount);
    }

    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const gain = context.createGain();
    filter.type = "bandpass";
    filter.frequency.setValueAtTime(1800, start);
    filter.Q.setValueAtTime(0.8, start);
    source.buffer = buffer;
    gain.gain.setValueAtTime(volume, start);
    gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(context.destination);
    source.start(start);
    source.stop(start + duration);
  }

  return { prepare, play };
})();
