#!/usr/bin/env node
// Patch claude-code-router: allow empty-string text content blocks.
// Claude Code sends {"type":"text","text":""} blocks; the router's strict
// validation rejects them ("!block.text" is true for ""), breaking tool calls.
// See dist/cli.js validateContentBlocks().

const fs = require('fs');
const path = require('path');

const candidates = [
  '/usr/local/lib/node_modules/claude-code-router/dist/cli.js',
  path.join(process.env.HOME || '/root', '.claude', 'node_modules', 'claude-code-router', 'dist', 'cli.js'),
];

const TARGET = 'if (!block.text || typeof block.text !== "string") {';
const REPLACEMENT = 'if (typeof block.text !== "string") {';

for (const file of candidates) {
  if (!fs.existsSync(file)) continue;
  const src = fs.readFileSync(file, 'utf8');
  if (!src.includes(TARGET)) {
    console.log(`[patch-ccr] ${file}: pattern not found, already patched or version differs`);
    continue;
  }
  fs.writeFileSync(file, src.split(TARGET).join(REPLACEMENT));
  console.log(`[patch-ccr] patched ${file}`);
}
