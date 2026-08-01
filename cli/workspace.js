import fs from 'node:fs';
import path from 'node:path';
import { INSTRUCTION_FILES } from './adapter.js';

export function scanWorkspace(dir) {
  const files = [];
  function walk(current) {
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.git'
        || entry.name === '.published' || entry.name === '.previews'
        || entry.name === '.workspaces' || entry.name === '.loop-data') continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) {
        if (INSTRUCTION_FILES.has(entry.name)) continue;
        try {
          files.push({ path: path.relative(dir, full), content: fs.readFileSync(full, 'utf8') });
        } catch { /* skip */ }
      }
    }
  }
  walk(dir);
  return files;
}
