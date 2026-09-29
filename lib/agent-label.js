'use strict';

// Optional model + session-name labels. Herdr's agent.list reports session
// identity, not a model or a friendly name. Read only local transcripts for
// the three clients whose formats we know; other clients can publish the
// display-only `model` and `session_name` metadata tokens themselves.
// No transcript text is published: just the model identifier and name.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CHECK_MS = 1000;
const LOOKUP_MS = 15000;
const CHUNK_BYTES = 64 * 1024;
// Do not stall a sidebar frame on an unbounded historic transcript. For very
// large files, scan the header and recent tail, then follow new appends.
const INITIAL_BYTES = 32 * 1024 * 1024;
const TAIL_BYTES = 8 * 1024 * 1024;
const HEADER_BYTES = 128 * 1024;
const UUID = /^[0-9a-f-]{36}$/i;

function clean(value, limit) {
  if (typeof value !== 'string') return '';
  return value
    .replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')
    .replace(/[\x00-\x1f\x7f-\x9f]/g, ' ')
    .trim()
    .slice(0, limit)
    .trim();
}

function format(model, name) {
  const id = clean(model, 80);
  const sessionName = clean(name, 120);
  return id ? `${id}${sessionName ? ` · ${sessionName}` : ''}` : '';
}

function entries(dir) {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

function inside(file, root) {
  try {
    const realRoot = fs.realpathSync(root);
    const realFile = fs.realpathSync(file);
    return realFile.startsWith(`${realRoot}${path.sep}`) && realFile.endsWith('.jsonl');
  } catch {
    return false;
  }
}

function createReader({ home = os.homedir(), piDir = process.env.PI_CODING_AGENT_DIR } = {}) {
  const sessions = new Map();
  const files = new Map();
  const piRoot = path.join(piDir || path.join(home, '.pi', 'agent'), 'sessions');
  const claudeRoot = path.join(home, '.claude', 'projects');
  const codexRoot = path.join(home, '.codex', 'sessions');

  function resolve(agent, session, now) {
    if (!session || typeof session.value !== 'string') return '';
    if (agent === 'pi' && session.kind === 'path') {
      const key = `pi:${session.value}`;
      const cached = sessions.get(key);
      if (cached && now - cached.at < LOOKUP_MS) return cached.file;
      const file = inside(session.value, piRoot) ? session.value : '';
      sessions.set(key, { at: now, file });
      return file;
    }
    if (!['claude', 'codex'].includes(agent) || session.kind !== 'id' || !UUID.test(session.value)) return '';
    const key = `${agent}:${session.value}`;
    const cached = sessions.get(key);
    if (cached && now - cached.at < LOOKUP_MS) return cached.file;

    let file = '';
    if (agent === 'claude') {
      for (const dir of entries(claudeRoot)) {
        const candidate = path.join(claudeRoot, dir, `${session.value}.jsonl`);
        if (inside(candidate, claudeRoot)) {
          file = candidate;
          break;
        }
      }
    } else {
      for (const year of entries(codexRoot)) {
        if (file) break;
        for (const month of entries(path.join(codexRoot, year))) {
          if (file) break;
          const monthDir = path.join(codexRoot, year, month);
          for (const day of entries(monthDir)) {
            if (file) break;
            const dir = path.join(monthDir, day);
            const name = entries(dir).find((entry) => entry.endsWith(`-${session.value}.jsonl`));
            if (name && inside(path.join(dir, name), codexRoot)) file = path.join(dir, name);
          }
        }
      }
    }
    sessions.set(key, { at: now, file });
    return file;
  }

  function apply(record, agent, data) {
    if (agent === 'pi') {
      if (record.type === 'model_change') data.model = clean(record.modelId, 80) || data.model;
      if (record.type === 'message' && record.message?.role === 'assistant')
        data.model = clean(record.message.model, 80) || data.model;
      if (record.type === 'session_info') data.name = clean(record.name, 120);
    } else if (agent === 'claude') {
      if (record.type === 'assistant') data.model = clean(record.message?.model, 80) || data.model;
      if (record.type === 'custom-title') data.name = clean(record.customTitle, 120);
      if (record.type === 'ai-title') data.aiTitle = clean(record.aiTitle, 120);
    } else if (agent === 'codex' && record.type === 'turn_context') {
      data.model = clean(record.payload?.model, 80) || data.model;
    }
  }

  function scan(fd, start, end, agent, data, initial = Buffer.alloc(0)) {
    let pending = initial;
    let offset = start;
    while (offset < end) {
      const chunk = Buffer.allocUnsafe(Math.min(CHUNK_BYTES, end - offset));
      const count = fs.readSync(fd, chunk, 0, chunk.length, offset);
      if (!count) break;
      offset += count;
      const bytes = Buffer.concat([pending, chunk.subarray(0, count)]);
      const last = bytes.lastIndexOf(10);
      if (last < 0) {
        pending = bytes.length < CHUNK_BYTES * 2 ? bytes : Buffer.alloc(0);
        continue;
      }
      for (const line of bytes.subarray(0, last).toString('utf8').split('\n')) {
        // Skip giant message bodies before parsing. A single line can contain
        // a whole conversation, while model/name events are small.
        if (line.length > 1024 * 1024) continue;
        try {
          apply(JSON.parse(line), agent, data);
        } catch {
          // Part of a record, or a malformed record: never surface it.
        }
      }
      pending = bytes.subarray(last + 1);
    }
    return { offset, pending };
  }

  function read(file, agent, now) {
    const cached = files.get(file);
    if (cached && now - cached.checkedAt < CHECK_MS) return cached.data;
    try {
      const stat = fs.statSync(file);
      if (!stat.isFile()) return {};
      if (cached && stat.size === cached.offset && stat.mtimeMs === cached.mtimeMs) {
        cached.checkedAt = now;
        return cached.data;
      }
      const fd = fs.openSync(file, 'r');
      try {
        const reset =
          !cached || stat.size < cached.offset || (stat.size === cached.offset && stat.mtimeMs !== cached.mtimeMs);
        const data = reset ? {} : cached.data;
        let progress = reset
          ? { offset: 0, pending: Buffer.alloc(0) }
          : { offset: cached.offset, pending: cached.pending };
        if (reset && stat.size > INITIAL_BYTES) {
          progress = scan(fd, 0, HEADER_BYTES, agent, data);
          const tailStart = stat.size - TAIL_BYTES;
          // A partial first line cannot be parsed; skip through its newline.
          const tail = scan(fd, tailStart, stat.size, agent, data);
          progress = { offset: tail.offset, pending: tail.pending };
        } else {
          progress = scan(fd, progress.offset, stat.size, agent, data, progress.pending);
        }
        files.set(file, { ...progress, checkedAt: now, mtimeMs: stat.mtimeMs, data });
        return data;
      } finally {
        fs.closeSync(fd);
      }
    } catch {
      // Missing or unreadable transcripts do not hide the normal title.
      return cached?.data ?? {};
    }
  }

  function label(agent, now = Date.now()) {
    const tokens = agent.tokens ?? {};
    const model = clean(tokens.model, 80);
    const name = clean(tokens.session_name, 120);
    // A reporter can supply either field. Fill only the missing values from
    // the matching local transcript, never a random pane's session.
    if (model && name) return format(model, name);
    const file = resolve(agent.agent, agent.agent_session, now);
    const data = file ? read(file, agent.agent, now) : {};
    return format(model || data.model, name || data.name || data.aiTitle);
  }

  return { label };
}

module.exports = { createReader, clean, format };
