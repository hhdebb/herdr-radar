'use strict';

// Text-level edits to a TOML file we do not parse: values inside one named
// table, and delimited blocks appended at the tail. Herdr's config.toml is
// the user's file; the plugin only ever touches the lines it put there, and
// a full parse-and-serialise round trip would reorder and re-comment
// everything else.

const fs = require('node:fs');

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Slice `[table]` and its bare keys out of the file: from the header to the
// next header or the end. Other tables may carry the same key names.
function tableSpan(text, table) {
  const start = text.search(new RegExp(`^\\[${escapeRegExp(table)}\\]\\s*$`, 'm'));
  if (start === -1) return null;
  const rest = text.slice(start + 1);
  const nextHeader = rest.search(/^\[/m);
  return {
    head: text.slice(0, start),
    body: nextHeader === -1 ? text.slice(start) : text.slice(start, start + 1 + nextHeader),
    tail: nextHeader === -1 ? '' : text.slice(start + 1 + nextHeader),
  };
}

// The double-quoted value of a bare key in `[table]`, or null.
function tableValue(text, table, key) {
  const span = tableSpan(text, table);
  if (!span) return null;
  return span.body.match(new RegExp(`^${escapeRegExp(key)}\\s*=\\s*"([^"]+)"`, 'm'))?.[1] ?? null;
}

// Rewrite bare keys in `[table]`; returns null when the table is absent.
// Values are inserted verbatim, so quote strings at the call site.
function editTable(text, table, edits) {
  const span = tableSpan(text, table);
  if (!span) return null;
  let edited = span.body;
  for (const [key, value] of Object.entries(edits)) {
    const line = `${key} = ${value}`;
    // Only uncommented assignments at the start of a line; Herdr's file ships
    // with a commented template of every key.
    const pattern = new RegExp(`^${escapeRegExp(key)}\\s*=.*$`, 'm');
    edited = pattern.test(edited) ? edited.replace(pattern, line) : `${edited.replace(/\n*$/, '')}\n${line}\n`;
  }
  return span.head + edited + span.tail;
}

// Rewrite bare keys at the top level — everything before the first table
// header. New keys are appended to that region so they never land inside a
// table by accident. Values are inserted verbatim.
function editTopLevel(text, edits) {
  const firstHeader = text.search(/^\[/m);
  let head = firstHeader === -1 ? text : text.slice(0, firstHeader);
  const tail = firstHeader === -1 ? '' : text.slice(firstHeader);
  for (const [key, value] of Object.entries(edits)) {
    const line = `${key} = ${value}`;
    const pattern = new RegExp(`^${escapeRegExp(key)}\\s*=.*$`, 'm');
    head = pattern.test(head) ? head.replace(pattern, line) : `${head.replace(/\n*$/, '')}\n${line}\n`;
  }
  // Keep one blank line between the top-level keys and the first table.
  if (tail && !head.endsWith('\n\n')) head = `${head.replace(/\n*$/, '')}\n\n`;
  return head.replace(/^\n+/, '') + tail;
}

// Replace the block between the `start` and `end` marker lines, or append it.
function upsertTail(text, start, end, body) {
  const pattern = new RegExp(`\\n*${escapeRegExp(start)}[\\s\\S]*?${escapeRegExp(end)}`);
  if (pattern.test(text)) return text.replace(pattern, `\n\n${body}`);
  return `${text.replace(/\n+$/, '')}\n\n${body}\n`;
}

function dropBlock(text, start, end) {
  return text
    .replace(new RegExp(`\\n*${escapeRegExp(start)}[\\s\\S]*?${escapeRegExp(end)}\\n*`), '\n\n')
    .replace(/\n{3,}/g, '\n\n');
}

// Herdr watches its config directory and reloads on change; a partial write
// would be read as a broken file. Write beside it and rename into place.
function writeAtomic(file, text, suffix = '.tmp') {
  const tmp = `${file}${suffix}`;
  fs.writeFileSync(tmp, text, 'utf8');
  fs.renameSync(tmp, file);
}

module.exports = { escapeRegExp, tableValue, editTable, editTopLevel, upsertTail, dropBlock, writeAtomic };
