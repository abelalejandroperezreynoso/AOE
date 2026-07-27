// Sonido sintetizado con WebAudio: no hace falta descargar ningún archivo.

export class Audio {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.volume = 0.35;
    this.last = {};
  }

  ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) { this.enabled = false; return null; }
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  tone(freq, dur, type = 'sine', gain = 0.3, slide = 0) {
    const ctx = this.ensure();
    if (!ctx || !this.enabled) return;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, ctx.currentTime);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), ctx.currentTime + dur);
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(gain, ctx.currentTime + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
    o.connect(g); g.connect(this.master);
    o.start(); o.stop(ctx.currentTime + dur + 0.02);
  }

  noise(dur, gain = 0.2, filterFreq = 1200, type = 'lowpass') {
    const ctx = this.ensure();
    if (!ctx || !this.enabled) return;
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = type; f.frequency.value = filterFreq;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start();
  }

  /** Evita que el mismo sonido se dispare decenas de veces por segundo. */
  throttle(name, ms) {
    const now = performance.now();
    if (this.last[name] && now - this.last[name] < ms) return false;
    this.last[name] = now;
    return true;
  }

  play(name) {
    if (!this.enabled) return;
    switch (name) {
      case 'click': this.tone(880, 0.05, 'square', 0.09, -300); break;
      case 'select': if (this.throttle(name, 90)) this.tone(660, 0.07, 'triangle', 0.14, 220); break;
      case 'order': if (this.throttle(name, 90)) { this.tone(420, 0.09, 'triangle', 0.14, 180); } break;
      case 'build': if (this.throttle(name, 200)) { this.tone(300, 0.12, 'triangle', 0.16, 220); this.noise(0.2, 0.1, 900); } break;
      case 'train': if (this.throttle(name, 200)) this.tone(520, 0.14, 'sine', 0.16, 180); break;
      case 'tech': this.tone(600, 0.2, 'sine', 0.18, 400); break;
      case 'age': {
        [392, 494, 587, 784].forEach((f, i) => setTimeout(() => this.tone(f, 0.5, 'triangle', 0.2), i * 150));
        break;
      }
      case 'hit': if (this.throttle(name, 70)) this.noise(0.09, 0.12, 2600, 'bandpass'); break;
      case 'bow': if (this.throttle(name, 90)) this.noise(0.07, 0.07, 3600, 'highpass'); break;
      case 'catapult': if (this.throttle(name, 200)) this.tone(140, 0.2, 'sawtooth', 0.12, -60); break;
      case 'impact': if (this.throttle(name, 120)) { this.noise(0.3, 0.18, 700); this.tone(90, 0.25, 'sine', 0.16, -40); } break;
      case 'die': if (this.throttle(name, 300)) this.tone(220, 0.18, 'sawtooth', 0.1, -120); break;
      case 'collapse': if (this.throttle(name, 250)) { this.noise(0.7, 0.22, 500); this.tone(70, 0.6, 'sine', 0.14, -30); } break;
      case 'error': this.tone(180, 0.16, 'square', 0.1, -60); break;
      case 'bell': [784, 784, 587].forEach((f, i) => setTimeout(() => this.tone(f, 0.35, 'sine', 0.2), i * 180)); break;
      case 'victory': [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => this.tone(f, 0.6, 'triangle', 0.22), i * 190)); break;
      case 'defeat': [440, 392, 330, 262].forEach((f, i) => setTimeout(() => this.tone(f, 0.7, 'sine', 0.2), i * 240)); break;
    }
  }
}
