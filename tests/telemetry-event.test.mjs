import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { normalizeTelemetryEvent } = require('../electron/telemetry/event-normalizer.cjs');

assert.deepEqual(
  normalizeTelemetryEvent({ type: 'mouse', t_us: 123456, dx: 8, dy: -3, secret: 'discard-me' }),
  { type: 'mouse', t_us: 123456, dx: 8, dy: -3 }
);

assert.deepEqual(
  normalizeTelemetryEvent({ type: 'key', t_us: 10, key: 'a', state: 'down', text: 'password' }),
  { type: 'key', t_us: 10, key: 'A', state: 'down' }
);

assert.equal(
  normalizeTelemetryEvent({ type: 'key', t_us: 10, key: 'Q', state: 'down' }),
  null,
  'keys outside WASD must never be persisted'
);

assert.equal(
  normalizeTelemetryEvent({ type: 'button', t_us: 10, button: 'RMB', state: 'down' }),
  null,
  'buttons outside LMB must never be persisted'
);

assert.deepEqual(
  normalizeTelemetryEvent({
    type: 'focus',
    t_us: 55,
    valorant: true,
    process: 'C:\\Riot Games\\VALORANT-Win64-Shipping.exe'
  }),
  {
    type: 'focus',
    t_us: 55,
    valorant: true,
    process: 'VALORANT-Win64-Shipping.exe'
  }
);

assert.equal(normalizeTelemetryEvent({ type: 'clipboard', t_us: 1, value: 'secret' }), null);
assert.equal(normalizeTelemetryEvent({ type: 'mouse', t_us: -1, dx: 1, dy: 1 }), null);
assert.equal(normalizeTelemetryEvent({ type: 'mouse', t_us: 1, dx: 999999, dy: 1 }), null);

console.log('Telemetry event validation tests passed.');
