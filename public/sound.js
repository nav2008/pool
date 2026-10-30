export class PoolSound {
  constructor() {
    try { this.enabled = localStorage.getItem('sidespin-sound') !== 'off'; } catch { this.enabled = true; }
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
    if (value) this.unlock();
  }
  play(event) {
    if (!this.enabled || !this.ctx || this.ctx.state !== 'running') return;
    const ctx = this.ctx, now = ctx.currentTime;
    const strength = Math.min(1, (event.strength ?? 400) / 750);
    const volume = event.type === 'pocket' ? .13 : .02 + strength * .11;
    const oscillator = ctx.createOscillator(), gain = ctx.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(event.type === 'pocket' ? 175 : event.type === 'cushion' ? 180 : event.type === 'strike' ? 420 : 650 + strength * 600, now);
    oscillator.frequency.exponentialRampToValueAtTime(event.type === 'pocket' ? 55 : 130, now + .055);
    gain.gain.setValueAtTime(volume, now); gain.gain.exponentialRampToValueAtTime(.001, now + .075);
    oscillator.connect(gain); gain.connect(ctx.destination); oscillator.start(now); oscillator.stop(now + .08);
  }
}
