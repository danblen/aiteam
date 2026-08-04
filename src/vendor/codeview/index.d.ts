// Type declarations for the `codeview` package.
// Hand-written to accompany the JS (.jsx) source. Kept in sync manually.

import type { ReactNode } from 'react';

// ── Core data shapes ──────────────────────────────────────────────

/** A directory entry as returned by `listDir`. */
export interface DirEntry {
  name: string;
  kind: 'file' | 'directory';
  path: string;
}

/** A lazily-expanded tree node used by the sidebar. */
export interface TreeNode {
  id: string;
  name: string;
  kind: 'file' | 'directory';
  path: string;
  /** null until the directory's children have been loaded. */
  children: TreeNode[] | null;
}

/** Result of a capped text read. */
export interface ReadTextResult {
  text: string;
  /** Full (untruncated) byte size of the file. */
  size: number;
  /** True when `text` was cut off at the byte cap. */
  truncated: boolean;
}

/** A single search hit within a line. */
export interface SearchMatch {
  lineNum: number;
  text: string;
  start: number;
  length: number;
}

/** All matches for one file. */
export interface SearchFileResult {
  path: string;
  name: string;
  matches: SearchMatch[];
}

export interface SearchOptions {
  useRegex?: boolean;
  caseSensitive?: boolean;
  signal?: AbortSignal;
  onResult?: (result: SearchFileResult) => void;
  onProgress?: (progress: { files: number; matches: number }) => void;
}

/** Which optional features a provider supports. */
export interface ProviderCapabilities {
  /** Inline edit + save. */
  write: boolean;
  /** Create / delete / rename entries. */
  fileOps: boolean;
  /** Full-text search panel. */
  search: boolean;
  /** Git diff panel. */
  git: boolean;
}

/** Host-injected git backend (keeps isomorphic-git out of the package). */
export interface GitBackend {
  status(): Promise<{ changes: GitChange[]; branch?: string }>;
  diff(path: string, status?: string): Promise<string | { oldText: string; newText: string }>;
}

export interface GitChange {
  path: string;
  status: string;
}

/**
 * The abstraction every data source implements. Only `listDir`,
 * `readFileText`, `readFileBlob` and `capabilities` are required.
 */
export interface FileProvider {
  capabilities: ProviderCapabilities;
  git?: GitBackend;

  listDir(path?: string): Promise<DirEntry[]>;
  readFileText(path: string, maxBytes?: number): Promise<ReadTextResult>;
  readFileBlob(path: string): Promise<Blob>;

  writeFile?(path: string, content: string): Promise<void>;
  createFile?(dirPath: string, name: string): Promise<void>;
  createDir?(dirPath: string, name: string): Promise<void>;
  deleteEntry?(path: string, kind: 'file' | 'directory'): Promise<void>;
  renameEntry?(path: string, newName: string, kind: 'file' | 'directory'): Promise<void>;

  search?(query: string, opts?: SearchOptions): Promise<void>;
}

// ── Provider implementations ──────────────────────────────────────

export interface FsaProviderOptions {
  git?: GitBackend;
}
export class FsaProvider implements FileProvider {
  constructor(rootHandle: FileSystemDirectoryHandle, options?: FsaProviderOptions);
  capabilities: ProviderCapabilities;
  git?: GitBackend;
  listDir(path?: string): Promise<DirEntry[]>;
  readFileText(path: string, maxBytes?: number): Promise<ReadTextResult>;
  readFileBlob(path: string): Promise<Blob>;
  writeFile(path: string, content: string): Promise<void>;
  createFile(dirPath: string, name: string): Promise<void>;
  createDir(dirPath: string, name: string): Promise<void>;
  deleteEntry(path: string, kind: 'file' | 'directory'): Promise<void>;
  renameEntry(path: string, newName: string, kind: 'file' | 'directory'): Promise<void>;
  search(query: string, opts?: SearchOptions): Promise<void>;
  /** Resolve a directory path to its handle (for host “open as space”). */
  getDirHandle(path: string): Promise<FileSystemDirectoryHandle>;
}

export interface ServerProviderOptions {
  /** Custom fetch (e.g. for auth headers). Defaults to global `fetch`. */
  fetch?: typeof fetch;
  /** LRU size for file reads; `0` disables cache. Default 32. */
  readCacheSize?: number;
  git?: GitBackend;
}
export class ServerProvider implements FileProvider {
  constructor(baseUrl: string, rootPath: string, options?: ServerProviderOptions);
  capabilities: ProviderCapabilities;
  git?: GitBackend;
  /** Drop cached file reads after external writes. */
  invalidateReadCache(): void;
  listDir(path?: string): Promise<DirEntry[]>;
  readFileText(path: string, maxBytes?: number): Promise<ReadTextResult>;
  readFileBlob(path: string): Promise<Blob>;
}

export interface MemoryFile {
  path: string;
  content: string;
}
export interface MemoryProviderOptions {
  /** Called after an in-memory write so the host can persist / round-trip. */
  onWrite?: (path: string, content: string) => void | Promise<void>;
  /** Enable inline edit + save (also implied by providing `onWrite`). */
  writable?: boolean;
}
export class MemoryProvider implements FileProvider {
  constructor(files?: MemoryFile[], options?: MemoryProviderOptions);
  capabilities: ProviderCapabilities;
  /** Replace the backing file list (rebuilds the directory index). */
  setFiles(files: MemoryFile[]): void;
  listDir(path?: string): Promise<DirEntry[]>;
  readFileText(path: string, maxBytes?: number): Promise<ReadTextResult>;
  readFileBlob(path: string): Promise<Blob>;
  writeFile(path: string, content: string): Promise<void>;
  search(query: string, opts?: SearchOptions): Promise<void>;
}
export function createMemoryProvider(
  files?: MemoryFile[],
  options?: MemoryProviderOptions,
): MemoryProvider;

// ── Main component ────────────────────────────────────────────────

export type LayoutMode = 'top-left' | 'left-only' | 'auto-hide';

export interface Space {
  id: string;
  name: string;
  [key: string]: unknown;
}

/** A host-injected right-side panel (e.g. RAG) — kept out of the package. */
export interface ExtraPanel {
  id: string;
  title: string;
  icon?: ReactNode;
  badge?: ReactNode;
  render(ctx: { revealFile: (target: { path: string; name?: string; line?: number }) => void }): ReactNode;
}

export interface CodeWorkspaceProps {
  /** The data source. All file I/O routes through it. */
  provider: FileProvider;
  /** Changing this key resets the tree/selection (e.g. on space switch). */
  providerKey?: string | null;
  /** Changing this token refreshes expanded dirs without resetting selection. */
  refreshToken?: string | number | null;
  /** Refresh tree/git on window focus. Default true. */
  autoRefreshOnFocus?: boolean;
  /** Display name for the current root. */
  rootName?: string | null;

  spaces?: Space[];
  activeSpaceId?: string | null;
  onSwitchSpace?: (id: string) => void;
  onSelectDirectory?: () => void;
  onDeleteSpace?: (id: string) => void;
  onCloneGithub?: () => void;
  onOpenAsWorkspace?: (node: TreeNode) => void;

  /** Controlled layout; omit to let the component persist it in localStorage. */
  layoutMode?: LayoutMode;
  onChangeLayout?: (mode: LayoutMode) => void;
  /**
   * Show the layout-switcher control in the sidebar header. Defaults to `true`.
   * Set to `false` for a bare viewer with a fixed layout (no layout switching).
   */
  layoutSwitcher?: boolean;

  /** Toggle the built-in right panels. */
  panels?: { search?: boolean; git?: boolean };
  /** Additional host-provided right panels (e.g. RAG). */
  extraPanels?: ExtraPanel[];

  /** Reports unsaved-edit state so the host can guard space switches. */
  onDirtyChange?: (dirty: boolean) => void;

  /**
   * Drop the centered reading-column cap so content fills the whole area
   * (and hide the width resizer). Defaults to `false`. Useful for a pure
   * code viewer that should span the full width.
   */
  fullWidth?: boolean;

  loading?: boolean;
}

export declare function CodeWorkspace(props: CodeWorkspaceProps): JSX.Element;
export default CodeWorkspace;

// ── Utility re-exports ────────────────────────────────────────────

export type FileType =
  | 'markdown' | 'code' | 'image' | 'pdf' | 'audio' | 'video' | 'html' | 'binary' | 'text';

export function getFileType(name: string): FileType;
export function getCodeLanguage(name: string): string;
export function looksBinary(bytes: Uint8Array): boolean;
export function formatFileSize(bytes: number): string;
export function sortEntries(entries: DirEntry[]): DirEntry[];
export function toTreeNode(entry: DirEntry): TreeNode;
export function buildChangeTree(changes: GitChange[]): TreeNode[];
export function isSearchableFile(name: string): boolean;
export const MAX_TEXT_VIEW_SIZE: number;
