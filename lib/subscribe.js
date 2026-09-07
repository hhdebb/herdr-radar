'use strict';

// The daemon's long-lived event subscription — the reason it can sleep.
//
// One read-only connection carries `events.subscribe`; every line that
// arrives after the ack is treated as a WAKE HINT and nothing more. The
// payloads are deliberately ignored: replays (up to 512 historical events on
// every connect), the 10-events-per-second per-subscription throttle, and the
// two envelope naming styles (snake_case for broadcast kinds, dotted for
// parameterised ones) all stop mattering when the only response to any event
// is "go take a fresh snapshot".
//
// The connection must stay write-silent after the initial request: the server
// treats client bytes on a streaming connection as a disconnect (unix) or
// lets them rot unread (windows). Ordinary requests go through lib/ipc.js on
// their own short connections.
//
// `workspace.metadata_updated` is deliberately NOT subscribed: it is almost
// entirely the echo of this plugin's own Spaces-mark writes. `pane.updated`
// echoes our pane token writes the same way, but it is also the only global
// carrier of agent_status changes, so it stays — the daemon's scheduler
// coalesces the echo storm instead.

const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');

const { herdrConfigPath } = require('./paths');

const KINDS = [
  'pane.updated',
  'pane.created',
  'pane.closed',
  'pane.exited',
  'pane.agent_detected',
  'pane.focused',
  'workspace.created',
  'workspace.closed',
  'workspace.renamed',
  'workspace.focused',
  'tab.renamed',
];

const RETRY_BASE_MS = 500;
const RETRY_CAP_MS = 30000;

function socketFile() {
  return (
    process.env.HERDR_SOCKET_PATH ?? path.join(path.dirname(herdrConfigPath()), 'herdr.sock')
  );
}

function pipePath() {
  const file = socketFile();
  return process.platform === 'win32' ? `\\\\.\\pipe\\${file}` : file;
}

// onWake(): any event arrived, or the stream just (re)connected — resync.
// onGone(): the server is gone for good (its socket marker vanished).
// Reconnects forever with capped backoff otherwise: a reload hiccup or a
// live handoff is a disconnect too, and dying over one would leave the
// sidebar frozen until the next herdr restart.
function start({ onWake, onGone }) {
  let stopped = false;
  let attempts = 0;
  let current = null;

  const connect = () => {
    if (stopped) return;
    const stream = net.connect({ path: pipePath() });
    current = stream;
    let body = '';
    let acked = false;
    let ended = false;

    const retry = () => {
      if (ended) return;
      ended = true;
      stream.destroy();
      if (stopped) return;
      current = null;
      if (!fs.existsSync(socketFile())) {
        onGone();
        return;
      }
      attempts += 1;
      setTimeout(connect, Math.min(RETRY_CAP_MS, RETRY_BASE_MS * 2 ** Math.min(attempts, 6)));
    };

    stream.on('connect', () => {
      stream.write(
        `${JSON.stringify({
          id: 'daemon-sub',
          method: 'events.subscribe',
          params: { subscriptions: KINDS.map((type) => ({ type })) },
        })}\n`,
      );
    });
    stream.on('data', (chunk) => {
      body += chunk;
      let sawEvent = false;
      let newline;
      while ((newline = body.indexOf('\n')) >= 0) {
        body = body.slice(newline + 1);
        if (!acked) {
          // The ack (or an error line, which the close handler will follow).
          acked = true;
          attempts = 0;
          sawEvent = true; // resync after every (re)connect
          continue;
        }
        sawEvent = true;
      }
      if (sawEvent && !stopped) onWake();
    });
    stream.on('error', retry);
    stream.on('close', retry);
  };

  connect();
  return {
    stop() {
      stopped = true;
      current?.destroy();
    },
  };
}

module.exports = { start, KINDS };
