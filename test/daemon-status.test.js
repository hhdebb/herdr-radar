'use strict';

// What the watchdog decides from a ping (lib/state.js daemonStatus).
//
// `stalled` is the state that gets a daemon ended and replaced, so both
// directions matter: a stall must be named, and a healthy daemon — or one too
// old to report its ages — must not be. Liveness is asked of the control
// endpoint rather than a pid file, because a pid reused after a restart passes
// kill(pid, 0) and kept the daemon from ever starting (#19).

const test = require('node:test');
const assert = require('node:assert/strict');

const control = require('../lib/control');
const state = require('../lib/state');

const alive = { ok: true, pid: 7, fire_age_ms: 900, frame_running_ms: 0 };

const CASES = [
  [null, 'none', 'nothing answers the endpoint'],
  [alive, 'healthy', 'a daemon whose timer fired a second ago'],
  [{ ...alive, fire_age_ms: state.STALLED_MS + 1 }, 'stalled', 'a daemon whose timer has stopped'],
  // A slow Herdr: a frame waiting on IPC timeouts for a minute is still a
  // daemon doing its job. Killing it starts a replacement that waits on the
  // same Herdr, so judging frames on the timer's clock was a kill loop.
  [{ ...alive, frame_running_ms: 60000 }, 'healthy', 'a minute-long frame against a slow Herdr'],
  [{ ...alive, frame_running_ms: state.HUNG_FRAME_MS + 1 }, 'stalled', 'a frame that never finishes'],
  // Taken at its word on upgrade rather than killed for not knowing the fields.
  [{ ok: true, pid: 7, uptime_ms: 5 }, 'healthy', 'a pre-upgrade daemon that reports no ages'],
];

for (const [reply, want, label] of CASES) {
  test(`${label} reads as ${want}`, async (t) => {
    t.mock.method(control, 'request', async () => reply);
    assert.equal((await state.daemonStatus()).state, want);
  });
}

test('a stall names its reason and the pid to end', async (t) => {
  t.mock.method(control, 'request', async () => ({ ...alive, fire_age_ms: 34000 }));
  const status = await state.daemonStatus();
  assert.equal(status.pid, 7);
  assert.match(status.reason, /timer has not fired for 34s/);
});
