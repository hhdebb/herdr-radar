'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createReader, format } = require('../lib/agent-label');
const config = require('../lib/config');
const herdr = require('../lib/herdr');
const state = require('../lib/state');
const { Frame } = require('../lib/frame');

function fixture(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'radar-label-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  return {
    home,
    reader: createReader({ home }),
    write(file, records) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, records.map((entry) => JSON.stringify(entry)).join('\n') + '\n');
    },
  };
}

const session = (agent, kind, value, tokens = {}) => ({ agent, agent_session: { kind, value }, tokens });

test('Pi uses the newest model and explicit session name; appended changes refresh without restarting', (t) => {
  const { home, reader, write } = fixture(t);
  const file = path.join(home, '.pi', 'agent', 'sessions', 'project', 'session.jsonl');
  write(file, [
    { type: 'model_change', modelId: 'first-model' },
    { type: 'session_info', name: 'Review 认证功能' },
    { type: 'message', message: { role: 'assistant', model: 'new-model' } },
  ]);
  const agent = session('pi', 'path', file);
  assert.equal(reader.label(agent, 10000), 'new-model · Review 认证功能');
  fs.appendFileSync(file, '{"type":"model_change","modelId":"');
  assert.equal(reader.label(agent, 11500), 'new-model · Review 认证功能', 'partial lines are ignored');
  fs.appendFileSync(file, 'latest-model"}\n{"type":"session_info","name":"新的任务"}\n');
  assert.equal(reader.label(agent, 13000), 'latest-model · 新的任务');
});

test('Claude follows assistant model and explicit title, with AI title as fallback', (t) => {
  const { home, reader, write } = fixture(t);
  const id = '11111111-2222-3333-4444-555555555555';
  const file = path.join(home, '.claude', 'projects', 'repo', `${id}.jsonl`);
  write(file, [
    { type: 'assistant', message: { model: 'claude-sonnet-4' } },
    { type: 'ai-title', aiTitle: 'Generated name' },
    { type: 'custom-title', customTitle: 'My named session' },
  ]);
  assert.equal(reader.label(session('claude', 'id', id), 10000), 'claude-sonnet-4 · My named session');
});

test('Codex reads the latest turn model, without inventing a session name from the id', (t) => {
  const { home, reader, write } = fixture(t);
  const id = '11111111-2222-3333-4444-555555555555';
  write(path.join(home, '.codex', 'sessions', '2026', '09', '29', `rollout-today-${id}.jsonl`), [
    { type: 'turn_context', payload: { model: 'gpt-test' } },
  ]);
  assert.equal(reader.label(session('codex', 'id', id), 10000), 'gpt-test');
});

test('custom display-only tokens work for other agents, and missing model falls back', (t) => {
  const { reader } = fixture(t);
  assert.equal(
    reader.label({ agent: 'kimi', tokens: { model: 'kimi-test', session_name: '调研' } }),
    'kimi-test · 调研',
  );
  assert.equal(reader.label({ agent: 'kimi', tokens: { session_name: 'No model' } }), '');
  assert.equal(reader.label(session('codex', 'id', 'not-a-uuid')), '');
  assert.equal(format('  gpt-test\nspoofed', ' A\u001b[31m B '), 'gpt-test spoofed · A B');
});

test('a large transcript keeps its header name and reads the latest model from its tail', (t) => {
  const { home, reader } = fixture(t);
  const file = path.join(home, '.pi', 'agent', 'sessions', 'repo', 'large.jsonl');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const fd = fs.openSync(file, 'w');
  try {
    fs.writeSync(fd, JSON.stringify({ type: 'session_info', name: '命名会话' }) + '\n');
    fs.writeSync(fd, ' '.repeat(33 * 1024 * 1024) + '\n');
    fs.writeSync(fd, JSON.stringify({ type: 'model_change', modelId: 'latest-model' }) + '\n');
  } finally {
    fs.closeSync(fd);
  }
  assert.equal(reader.label(session('pi', 'path', file), 10000), 'latest-model · 命名会话');
});

test('a reported Pi path outside the sessions root is never read', (t) => {
  const { home, reader, write } = fixture(t);
  const file = path.join(home, 'private.jsonl');
  write(file, [{ type: 'model_change', modelId: 'must-not-leak' }]);
  assert.equal(reader.label(session('pi', 'path', file)), '');
});

test('model mode publishes a state-coloured model label and keeps title as fallback', async (t) => {
  const before = config.rowLabel;
  config.rowLabel = 'model';
  t.after(() => {
    config.rowLabel = before;
  });
  t.mock.method(herdr, 'agentsAsync', async () => [
    {
      pane_id: 'w1:p1',
      agent: 'pi',
      agent_status: 'working',
      tokens: {
        model: 'test-model',
        session_name: 'named-session',
      },
    },
  ]);
  const [entry] = await state.snapshot();
  assert.equal(entry.modelLabel, 'test-model · named-session');

  const writes = [];
  t.mock.method(herdr, 'reportMetadataAsync', async (_pane, _source, tokens) => {
    writes.push(tokens);
    return true;
  });
  const frame = new Frame('plugin:test');
  const args = {
    tabs: new Map(),
    keys: {
      minuteKey: () => null,
      wsKeys: new Map(),
      tabKeys: new Map(),
    },
    indent: '',
    spinStep: 0,
  };
  const jobs = [];
  frame.paneJobs({ ...entry, title: 'Pi', name: 'pi' }, 'working', args, Date.now(), [], jobs);
  await Promise.all(jobs);
  assert.ok(writes.some((patch) => patch.title_working?.includes('test-model · named-session')));

  writes.length = 0;
  const fallbackJobs = [];
  frame.paneJobs(
    { ...entry, title: 'Original title', modelLabel: '', name: 'pi' },
    'idle',
    args,
    Date.now(),
    [],
    fallbackJobs,
  );
  await Promise.all(fallbackJobs);
  assert.ok(writes.some((patch) => patch.title_idle === 'Original title'));
});
