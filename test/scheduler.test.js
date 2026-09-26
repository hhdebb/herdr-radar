'use strict';

// The daemon's frame scheduler (lib/scheduler.js).
//
// Driven for real, on its own default clock — that default is part of what is
// under test — with every timer it arms collected, so none outlives a test
// whatever clock it ends up running on.

const test = require('node:test');
const assert = require('node:assert/strict');

const { createScheduler } = require('../lib/scheduler');

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function scheduler(t, run) {
  const pending = new Set();
  t.after(() => {
    for (const handle of pending) clearTimeout(handle);
  });
  return createScheduler({
    floorMs: 120,
    pollMs: 150,
    debounceMs: 50,
    run,
    setTimer: (fn, ms) => {
      const handle = setTimeout(() => {
        pending.delete(handle);
        fn();
      }, ms);
      pending.add(handle);
      return handle;
    },
    clearTimer: (handle) => {
      pending.delete(handle);
      clearTimeout(handle);
    },
  });
}

// #18. The floor used to compare Date.now() with the last frame, and a clock
// stepped backwards made that negative: every wake looked too soon, was pushed
// minutes into the future, and the panel froze for the length of the step
// while the process answered pings.
test('a wall clock stepped back six minutes does not stop the frames', async (t) => {
  let frames = 0;
  const s = scheduler(t, async () => {
    frames += 1;
  });
  s.wake();
  await pause(300);
  const before = frames;
  assert.ok(before >= 1, 'no frame before the step — the test itself is broken');

  // NTP correcting a fast RTC by six minutes, the way #18's machine booted.
  const real = Date.now;
  t.mock.method(Date, 'now', () => real.call(Date) - 6 * 60 * 1000);
  for (let i = 0; i < 4; i += 1) {
    s.wake();
    await pause(220);
  }
  assert.ok(
    frames - before >= 3,
    `${frames - before} frame(s) in four wakes after the step; the floor reads the wall clock`,
  );
});

// The watchdog judges a silent timer at thirty seconds, so the heartbeat must
// keep reaching the scheduler while a frame is in flight — there it only notes
// a rerun. If a slow frame aged the timer, a slow Herdr would get the daemon
// killed, and its replacement after it.
test('a frame in flight keeps the timer counted as firing', async (t) => {
  let release;
  const s = scheduler(t, () => new Promise((resolve) => (release = resolve)));
  t.after(() => release?.());
  s.wake();
  await pause(300);
  s.wake();
  await pause(150);
  assert.ok(s.runningForMs() >= 250, `a ~400ms frame reports ${Math.round(s.runningForMs())}ms running`);
  assert.ok(s.fireAgeMs() <= 150, `the timer reads ${Math.round(s.fireAgeMs())}ms silent during a frame`);
});

test('no frame is running when none has started', (t) => {
  const s = scheduler(t, async () => {});
  assert.equal(s.runningForMs(), 0);
});
