export class PoolSound {
  constructor() {
    try { this.enabled = localStorage.getItem('sidespin-sound') !== 'off'; } catch { this.enabled = true; }
    this.voices = new Set();
    this.lastCollision = -Infinity;
    this.lastCelebration = -Infinity;
  }
  unlock() {
    if (!this.enabled) return;
    try {
      this.ctx ??= new (window.AudioContext || window.webkitAudioContext)();
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    } catch { /* Sound is optional; unsupported audio must not block play. */ }
  }
  setEnabled(value) {
    this.enabled = value;
    try { localStorage.setItem('sidespin-sound', value ? 'on' : 'off'); } catch { /* private browsing */ }
    if (!value) {
      for (const voice of this.voices) {
        try { voice.stop(); } catch { /* Already stopped. */ }
      }
      this.voices.clear();
    }
    if (value) this.unlock();
  }
  tone(frequency, time, duration, volume, endFrequency = frequency, type = 'sine') {
    const oscillator = this.ctx.createOscillator(), gain = this.ctx.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, time);
    oscillator.frequency.exponentialRampToValueAtTime(endFrequency, time + duration);
    gain.gain.setValueAtTime(.001, time);
    gain.gain.exponentialRampToValueAtTime(volume, time + .004);
    gain.gain.exponentialRampToValueAtTime(.001, time + duration);
    oscillator.connect(gain); gain.connect(this.ctx.destination);
    this.voices.add(oscillator);
    oscillator.onended = () => {
      this.voices.delete(oscillator); oscillator.disconnect(); gain.disconnect();
    };
    oscillator.start(time); oscillator.stop(time + duration + .01);
  }
  play(event) {
    if (!this.enabled || !this.ctx || this.ctx.state !== 'running') return;
    const ctx = this.ctx, now = ctx.currentTime;
    const strength = Math.max(0, Math.min(1, (event.strength ?? 400) / 750));
    if (event.type === 'win') {
      // A warm, rising fanfare with a final major chord. Only the winner hears it.
      [523.25, 659.25, 783.99, 1046.5].forEach((note, i) => this.tone(note, now + i * .13, .24, .075, note, 'triangle'));
      [523.25, 659.25, 783.99, 1046.5].forEach((note) => this.tone(note, now + .58, .65, .045, note, 'triangle'));
    } else if (event.type === 'pocket') {
      this.tone(175, now, .12, .12, 55);
      // Scratches are a low drop, not a celebration. The black's celebration
      // waits for the server's result so an early black never sounds like a win.
      if (event.ball !== 0 && event.ball !== 8 && now - this.lastCelebration > .18) {
        this.lastCelebration = now;
        [659.25, 880, 1046.5].forEach((note, i) => this.tone(note, now + .04 + i * .075, .18, .045, note, 'triangle'));
      }
    } else if (event.type === 'collision') {
      // Bound the number of clicks during a break without masking cue contact.
      const cueContact = event.a === 0 || event.b === 0;
      if (!cueContact && now - this.lastCollision < .025) return;
      this.lastCollision = now;
      this.tone(cueContact ? 1800 : 1400, now, .026, .025 + strength * .085, 620);
      this.tone(330, now, .055, .015 + strength * .055, 150);
    } else if (event.type === 'strike') {
      this.tone(420, now, .055, .035 + Math.min(1, event.power ?? .5) * .07, 130);
    } else if (event.type === 'cushion') {
      this.tone(180, now, .065, .02 + strength * .07, 85);
    }
  }
}
