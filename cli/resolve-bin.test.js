import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeBinPath, resolveExecutable, needsShell } from './resolve-bin.js';

describe('resolve-bin', () => {
  it('normalizeBinPath converts MSYS paths on Windows', () => {
    if (process.platform !== 'win32') return;
    assert.equal(normalizeBinPath('/c/Program Files/nodejs/claude'), 'C:\\Program Files\\nodejs\\claude');
  });

  it('needsShell for .cmd on Windows', () => {
    if (process.platform !== 'win32') {
      assert.equal(needsShell('foo.cmd'), false);
      return;
    }
    assert.equal(needsShell('C:\\x\\claude.cmd'), true);
  });

  it('resolveExecutable finds opencode in ~/.opencode/bin', async () => {
    const p = await resolveExecutable('opencode');
    if (!p) return;
    assert.match(p.toLowerCase(), /opencode/);
  });
});
