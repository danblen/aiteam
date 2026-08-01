import { registry, BaseAdapter, INSTRUCTION_FILES } from './adapter.js';
import claudeAdapter from './adapters/claude.js';
import opencodeAdapter from './adapters/opencode.js';
import aiderAdapter from './adapters/aider.js';

registry.register(claudeAdapter);
registry.register(opencodeAdapter);
registry.register(aiderAdapter);

export function getAdapter(id) {
  return registry.get(id);
}

export function listAdapters() {
  return registry.list().map((a) => ({
    id: a.id,
    name: a.config.name,
    emoji: a.config.emoji,
    desc: a.config.desc,
    supportsModel: a.supportsModel(),
    instructionFile: a.instructionFile(),
  }));
}

export function supportedClis() {
  return registry.ids();
}

export async function availableClis() {
  return registry.availableIds();
}

export async function isCliAvailable(id) {
  const a = registry.get(id);
  return a ? Boolean(await a.isAvailable()) : false;
}

export function registerAdapter(adapter) {
  registry.register(adapter);
}

export { BaseAdapter, INSTRUCTION_FILES, registry };
