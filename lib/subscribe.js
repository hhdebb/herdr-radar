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
// Neither `workspace.metadata_updated` nor `pane.updated` is subscribed: both
// are almost entirely the echo of this plugin's own token writes, and that
// echo is not merely noise. Herdr's server answers other requests late while
// it is flushing events to a subscriber — measured here at ~110ms per write
// with `pane.updated` on, against 1-2ms with it off — so listening to our own
// writes made every write slow, which an animation shows as a stutter. What
// `pane.updated` was kept for — agent status, titles, cwd — the daemon's own
// heartbeat picks up instead.

const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');

const { herdrConfigPath } = require('./paths');

// `pane.agent_status_changed` is not here, and cannot be: Herdr only offers it
// per pane (`pane_id` is required), and one malformed entry gets the WHOLE
// request refused — which is what happened for as long as it was listed. The
// stream then never opened, each refusal was read as an ack, and the daemon
// ran on the one-second retry instead of on events. A status change is picked
// up by the daemon's heartbeat.
const KINDS = [
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

// Only worth waking for when this plugin is the one moving workspaces
// (lib/workspace-order.js). Off - which is the default - nothing reacts to a
// reorder, so subscribing buys every user a wake they cannot use.
const REORDER_KINDS = ['workspace.moved', 'workspace.reordered'];

function kinds() {
  return require('./config').reorderWorkspaces ? [...KINDS, ...REORDER_KINDS] : KINDS;
}

// Whether the first line of a stream accepts the subscription.
function subscribed(line) {
  try {
    const reply = JSON.parse(line);
    return Boolean(reply) && !reply.error;
  } catch {
    return false;
  }
}

const RETRY_BASE_MS = 500;
const RETRY_CAP_MS = 30000;

function socketFile() {
  return process.env.HERDR_SOCKET_PATH ?? path.join(path.dirname(herdrConfigPath()), 'herdr.sock');
}

function pipePath() {
  const file = socketFile();
  return process.platform === 'win32' ? `\\\\.\\pipe\\${file}` : file;
}

// onWake(): any event arrived, or the stream just (re)connected — resync.
// onReconnect(): the stream came back after being lost. Whatever answered may
// be a different server — a live handoff swaps the process and keeps the
// socket path — and a new server has none of the tokens or the view override
// the old one held. Called before the onWake of the same connection.
// onGone(): the server is gone for good (its socket marker vanished).
// Reconnects forever with capped backoff otherwise: a reload hiccup or a
// live handoff is a disconnect too, and dying over one would leave the
// sidebar frozen until the next herdr restart.
function start({ onWake, onReconnect, onGone }) {
  let stopped = false;
  let attempts = 0;
  let connected = false;
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
          params: { subscriptions: kinds().map((type) => ({ type })) },
        })}\n`,
      );
    });
    stream.on('data', (chunk) => {
      body += chunk;
      let sawEvent = false;
      let newline;
      while ((newline = body.indexOf('\n')) >= 0) {
        const body0 = body.slice(0, newline);
        body = body.slice(newline + 1);
        if (!acked) {
          // The ack (or an error line, which the close handler will follow).
          acked = true;
          // An error line is followed by a close, and the retry after it is
          // no reconnection: counting it as one would repaint the whole
          // sidebar once a second for as long as the server keeps refusing.
          if (!subscribed(body0)) continue;
          attempts = 0;
          if (connected && !stopped) onReconnect?.();
          connected = true;
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
