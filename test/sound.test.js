import test from 'node:test';
import assert from 'node:assert/strict';
import { PoolSound } from '../public/sound.js';

function audio() {
  const voices = [];
  const parameter = () => ({ setValueAtTime() {}, exponentialRampToValueAtTime() {} });
  const sound = new PoolSound();
  sound.enabled = true;
  sound.ctx = {
    state: 'running', currentTime: 1, destination: {},
    createOscillator() {
      const voice = { frequency: parameter(), connect() {}, disconnect() {}, start(time) { this.time = time; }, stop() { this.stops = (this.stops || 0) + 1; } };
      voices.push(voice); return voice;
    },
    createGain() { return { gain: parameter(), connect() {}, disconnect() {} }; },
  };
  return { sound, voices };
}

test('cue-ball impact plays a layered click and break chatter is limited', () => {
  const { sound, voices } = audio();
  sound.play({ type: 'collision', a: 0, b: 1, strength: 600 });
  assert.equal(voices.length, 2);
  sound.play({ type: 'collision', a: 1, b: 9, strength: 600 });
  assert.equal(voices.length, 2);
  sound.play({ type: 'collision', a: 2, b: 0, strength: 600 });
  assert.equal(voices.length, 4);
});

test('coloured pots celebrate; white and black only play the pocket drop', () => {
  for (const ball of [1, 9]) {
    const { sound, voices } = audio(); sound.play({ type: 'pocket', ball });
    assert.equal(voices.length, 4);
    assert.ok(voices[3].time > voices[1].time);
  }
  for (const ball of [0, 8]) {
    const { sound, voices } = audio(); sound.play({ type: 'pocket', ball });
    assert.equal(voices.length, 1);
  }
});

test('victory schedules a fanfare and mute cancels active and queued notes', () => {
  const { sound, voices } = audio(); sound.play({ type: 'win' });
  assert.equal(voices.length, 8);
  assert.ok(voices.some((v) => v.time > sound.ctx.currentTime + .5));
  sound.setEnabled(false);
  assert.ok(voices.every((v) => v.stops === 2));
  assert.equal(sound.voices.size, 0);
  sound.play({ type: 'win' }); sound.play({ type: 'collision', a: 0, b: 1 });
  assert.equal(voices.length, 8);
});

test('unsupported or suspended audio does not interrupt gameplay', () => {
  const sound = new PoolSound(); sound.enabled = true;
  assert.doesNotThrow(() => sound.play({ type: 'win' }));
  sound.ctx = { state: 'suspended' };
  assert.doesNotThrow(() => sound.play({ type: 'pocket', ball: 1 }));
});
