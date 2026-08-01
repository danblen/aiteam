import { spawn } from 'node:child_process';

/** @type {import('node:child_process').spawn|null} */
let _spawn = null;

export function configure(opts = {}) {
  if (opts.spawn) _spawn = opts.spawn;
}

export function getSpawn() {
  if (_spawn) return _spawn;
  return defaultSpawn;
}

function defaultSpawn(binPath, args, opts, _uid) {
  return spawn(binPath, args, opts);
}
