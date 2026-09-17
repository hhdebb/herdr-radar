'use strict';

// Keep Herdr's real workspace order aligned with Radar's activity order.
// Radar's agent.view projection only changes what the Agents panel displays;
// indexed workspace shortcuts still use Herdr's ordered workspace list. This
// module bridges those two surfaces without changing focus or workspace data.

const ipc = require('./ipc');
const config = require('./config');

const RETRY_MS = 5000;

function same(a, b) {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function sameMembers(a, b) {
  return a.length === b.length && new Set(a).size === new Set(b).size && a.every((value) => b.includes(value));
}

function descending(a, b) {
  if (a === b) return 0;
  return a > b ? -1 : 1;
}

function rootOf(workspaceId, parents) {
  let root = workspaceId;
  const seen = new Set();
  while (parents.has(root) && !seen.has(root)) {
    seen.add(root);
    root = parents.get(root);
  }
  return root;
}

// Sort whole worktree families, not individual workspaces. A parent with no
// active agent still has to stay ahead of its active child in Herdr's Spaces
// tree, even though the child is the member that supplies the activity key.
function desiredOrder(currentOrder, activityKeys, parents) {
  if (activityKeys.size === 0) return currentOrder;

  const groups = new Map();
  currentOrder.forEach((workspaceId, index) => {
    const root = rootOf(workspaceId, parents);
    let group = groups.get(root);
    if (!group) {
      group = { ids: [], first: index, key: null };
      groups.set(root, group);
    }
    group.ids.push(workspaceId);
    const key = activityKeys.get(workspaceId);
    if (key !== undefined && (group.key === null || descending(key, group.key) < 0)) group.key = key;
  });

  const groupsInOrder = [...groups.values()];
  const active = groupsInOrder
    .filter((group) => group.key !== null)
    .sort((a, b) => descending(a.key, b.key) || a.first - b.first);
  const inactive = groupsInOrder.filter((group) => group.key === null).sort((a, b) => a.first - b.first);
  return [...active, ...inactive].flatMap((group) => group.ids);
}

function responseOrder(reply, fallback) {
  const rows = reply?.result?.workspaces;
  if (!Array.isArray(rows)) return fallback;
  const ids = rows
    .map((row) => (typeof row === 'string' ? row : row?.workspace_id))
    .filter((workspaceId) => typeof workspaceId === 'string');
  return sameMembers(ids, fallback) ? ids : fallback;
}

class WorkspaceOrder {
  constructor() {
    this.order = [];
    this.retryAt = 0;
  }

  async sync(currentOrder, activityKeys, parents, now = Date.now()) {
    if (!config.reorderWorkspaces || currentOrder.length < 2 || activityKeys.size === 0) {
      this.order = currentOrder;
      return false;
    }

    // labels() is cached for five seconds. Once this module has received an
    // authoritative response, keep using that order while the label cache
    // catches up, so a stale snapshot cannot undo the move.
    const baseline = sameMembers(this.order, currentOrder) ? this.order : currentOrder;
    const wanted = desiredOrder(baseline, activityKeys, parents);
    if (same(wanted, baseline)) {
      this.order = baseline;
      return false;
    }
    if (now < this.retryAt) return false;

    const reply = await ipc.call('workspace.move_block', { workspace_ids: wanted });
    if (!reply || reply.error) {
      this.retryAt = now + RETRY_MS;
      return false;
    }

    this.order = responseOrder(reply, wanted);
    this.retryAt = 0;
    return true;
  }
}

module.exports = { WorkspaceOrder, desiredOrder };
