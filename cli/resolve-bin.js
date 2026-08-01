import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const IS_WIN = process.platform === 'win32';

export function normalizeBinPath(p) {
  if (!p || typeof p !== 'string') return p;
  const trimmed = p.trim();
  if (IS_WIN && /^\/[a-zA-Z]\//.test(trimmed)) {
    const drive = trimmed[1].toUpperCase();
    const rest = trimmed.slice(3).replace(/\//g, '\\');
    return `${drive}:\\${rest}`;
  }
  return path.normalize(trimmed);
}

function fileExists(p) {
  try {
    fs.accessSync(p, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function npmGlobalCandidates(bin) {
  if (!IS_WIN) return [];
  const out = [];
  const appData = process.env.APPDATA;
  const progFiles = process.env.ProgramFiles;
  if (appData) {
    out.push(path.join(appData, 'npm', `${bin}.cmd`));
    out.push(path.join(appData, 'npm', bin));
  }
  if (progFiles) {
    out.push(path.join(progFiles, 'nodejs', `${bin}.cmd`));
    out.push(path.join(progFiles, 'nodejs', bin));
  }
  return out;
}

export function wellKnownCandidates(bin) {
  const home = os.homedir();
  switch (bin) {
    case 'opencode':
      if (IS_WIN) {
        return [
          path.join(home, '.opencode', 'bin', 'opencode.exe'),
          path.join(home, '.opencode', 'bin', 'opencode.cmd'),
        ];
      }
      return [
        path.join(home, '.opencode', 'bin', 'opencode'),
        '/Volumes/z/app/opencode/opencode.sh',
      ];
    default:
      return [];
  }
}

function tryWellKnown(bin) {
  for (const c of wellKnownCandidates(bin)) {
    if (fileExists(c)) return preferWinExecutable(c);
  }
  const envKey = `${bin.toUpperCase().replace(/-/g, '_')}_BIN`;
  const fromEnv = process.env[envKey];
  if (fromEnv) {
    const n = normalizeBinPath(fromEnv);
    if (fileExists(n)) return preferWinExecutable(n);
  }
  return null;
}

function pickBestWinCandidate(lines) {
  const cmd = lines.find((l) => l.toLowerCase().endsWith('.cmd'));
  if (cmd && fileExists(cmd)) return cmd;
  const exe = lines.find((l) => l.toLowerCase().endsWith('.exe'));
  if (exe && fileExists(exe)) return exe;
  for (const l of lines) {
    if (fileExists(l)) return l;
  }
  return null;
}

function preferWinExecutable(p) {
  if (!IS_WIN) return p;
  const lower = p.toLowerCase();
  if (lower.endsWith('.cmd') || lower.endsWith('.exe')) return p;
  const cmd = `${p}.cmd`;
  if (fileExists(cmd)) return cmd;
  return p;
}

export function resolveExecutable(bin) {
  if (!bin) return Promise.resolve(null);
  const normalized = normalizeBinPath(bin);
  if (path.isAbsolute(normalized) && fileExists(normalized)) {
    return Promise.resolve(preferWinExecutable(normalized));
  }
  return new Promise((resolve) => {
    if (IS_WIN) {
      execFile('where.exe', [bin], { timeout: 8000, windowsHide: true }, (err, stdout) => {
        if (!err && stdout) {
          const lines = stdout.trim().split(/\r?\n/).map((l) => normalizeBinPath(l.trim())).filter(Boolean);
          const picked = pickBestWinCandidate(lines);
          if (picked) return resolve(picked);
        }
        for (const c of npmGlobalCandidates(bin)) {
          if (fileExists(c)) return resolve(preferWinExecutable(c));
        }
        resolve(tryWellKnown(bin));
      });
      return;
    }
    execFile('which', [bin], { timeout: 5000 }, (err, stdout) => {
      if (!err && stdout) {
        const p = stdout.trim().split('\n')[0]?.trim();
        if (p) return resolve(normalizeBinPath(p));
      }
      resolve(tryWellKnown(bin));
    });
  });
}

export function needsShell(binPath) {
  if (!IS_WIN || !binPath) return false;
  const ext = path.extname(binPath).toLowerCase();
  return ext === '.cmd' || ext === '.bat';
}

export function resolveBinSync(bin, fallbackBins = []) {
  const tryPath = (p) => {
    const n = normalizeBinPath(p);
    if (!n) return null;
    if (path.isAbsolute(n) && fileExists(n)) return preferWinExecutable(n);
    return null;
  };
  let found = tryPath(bin);
  if (found) return found;
  for (const fb of fallbackBins) {
    found = tryPath(fb);
    if (found) return found;
  }
  return tryWellKnown(bin);
}
