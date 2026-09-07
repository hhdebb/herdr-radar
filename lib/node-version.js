'use strict';

// Refuse to run on a Node older than the floor this plugin is tested against,
// with a message that says so. Without this, an old runtime fails on the first
// `??` or `node:` import it meets — a syntax error deep in lib/ that reads as a
// bug in the plugin rather than a runtime that is too old.
//
// Required first thing by every entry point in bin/. Deliberately written
// without modern syntax so that it parses everywhere the check could matter.

var MIN_MAJOR = 18;
var major = Number(String(process.versions.node).split('.')[0]);

if (major < MIN_MAJOR) {
  process.stderr.write(
    require('./identity').NAME + ': Node ' + MIN_MAJOR + ' or newer is required (running ' + process.versions.node + ').\n' +
      'Herdr runs plugin commands with whatever `node` is on its PATH; check `herdr plugin log list`.\n',
  );
  process.exit(1);
}
