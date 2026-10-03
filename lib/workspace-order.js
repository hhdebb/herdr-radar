'use strict';

// Keep Herdr's real workspace order aligned with Radar's activity order.
// Radar's agent.view projection only changes what the Agents panel displays;
// indexed workspace shortcuts still use Herdr's ordered workspace list. This
// module bridges those two surfaces without changing focus or workspace data.

const ipc = require('./ipc');
const config = require('./config');
const view = require('./view');

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
//
// Known duplication: lib/frame.js sortKeys already encodes the same rule in
// the key itself - family key first, then a 1/0 flag putting the parent ahead
// of its children - and this rebuilds it from the parent map. Two statements
// of one rule, which drift the day only one is updated. The property that
// matters (idempotence) is held by tools/check.js either way.
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
  return [...active, ...inactive].flatMap((group) => {
    // Configured families put a real parent first even if the current Spaces
    // order has a child ahead of it. Unconfigured git families keep their order.
    if (config.parentToken || config.parentLabelToken) {
      const root = rootOf(group.ids[0], parents);
      const index = group.ids.indexOf(root);
      if (index > 0) group.ids.unshift(...group.ids.splice(index, 1));
    }
    return group.ids;
  });
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
    // Nothing to align to when the panel is in Herdr's own order. This module
    // exists to stop the indices disagreeing with what the panel shows, and
    // reordering while the panel is off produces exactly that disagreement the
    // other way round: the list in Herdr's order, the numbers in ours.
    if (view.mode() === null) {
      this.order = currentOrder;
      return false;
    }
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
