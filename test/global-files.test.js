'use strict';

// AC6 — the other half of the split. Moving the runtime files under
// runtimeDir() must not drag the setup and config files along: the font is
// installed once per machine, not once per socket, and a second session that
// re-ran first-run setup would rewrite Herdr's managed blocks behind the first
// one's back. These two tests are green today and their job is to stay that
// way while everything around them moves.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { childEnv, runNode, sandbox } = require('./helpers');

test('AC6a setup.stamp() bleibt flach im stateRoot', (t) => {
  const box = sandbox(t);
  const result = runNode(
    childEnv(box, { socket: path.join(box.base, 'named', 'herdr.sock') }),
    `
      const paths = lib('paths.js');
      emit({ stamp: lib('setup.js').stamp(), expected: path.join(paths.stateRoot, 'setup.done') });
    `,
  );

  assert.equal(
    result.stamp,
    result.expected,
    `setup.stamp() ist ${result.stamp}, erwartet ${result.expected} — pro Socket einmal Setup schreibt Herdrs ` +
      'verwaltete Blöcke mehrfach',
  );
});

test('AC6b paths.stateRoot folgt weiterhin HERDR_RADAR_STATE', (t) => {
  const box = sandbox(t);
  const result = runNode(
    childEnv(box, { socket: path.join(box.base, 'named', 'herdr.sock') }),
    "emit({ stateRoot: lib('paths.js').stateRoot });",
  );

  assert.equal(result.stateRoot, box.state, `paths.stateRoot ist ${result.stateRoot}, erwartet ${box.state}`);
});
