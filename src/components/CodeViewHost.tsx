import { Suspense, lazy, useEffect, useMemo } from 'react';
import { workspaceFetch } from '../lib/api';
import type { ProjectFile } from '../lib/types';

interface Props {
  projectDir?: string;
  files: ProjectFile[];
  refreshKey?: string | number;
}

interface InnerProps extends Props {
  CodeWorkspace: typeof import('../vendor/codeview/codeview').CodeWorkspace;
  MemoryProvider: typeof import('../vendor/codeview/codeview').MemoryProvider;
  ServerProvider: typeof import('../vendor/codeview/codeview').ServerProvider;
}

function CodeViewInner({ projectDir, files, refreshKey = 0, CodeWorkspace, MemoryProvider, ServerProvider }: InnerProps) {
  const serverProvider = useMemo(
    () => (projectDir ? new ServerProvider('', projectDir, {
      fetch: (input, init) => workspaceFetch(String(input), init),
    }) : null),
    [projectDir, ServerProvider],
  );

  const memoryProvider = useMemo(
    () => (projectDir ? null : new MemoryProvider(files)),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- recreate only when switching to memory mode
    [projectDir, MemoryProvider],
  );

  useEffect(() => {
    if (memoryProvider) memoryProvider.setFiles(files);
  }, [memoryProvider, files]);

  if (projectDir && serverProvider) {
    return (
      <div className="tab-pane code-tab codeview-host">
        <div className="codeview-host-body">
          <CodeWorkspace
            provider={serverProvider}
            providerKey={projectDir}
            refreshToken={refreshKey}
            autoRefreshOnFocus={false}
            rootName="项目文件"
            layoutMode="left-only"
            layoutSwitcher={false}
            fullWidth
            panels={{ search: false, git: false }}
          />
        </div>
      </div>
    );
  }

  if (files.length === 0 || !memoryProvider) return null;

  return (
    <div className="tab-pane code-tab codeview-host">
      <div className="codeview-host-body">
        <CodeWorkspace
          provider={memoryProvider}
          providerKey="memory"
          refreshToken={refreshKey}
          autoRefreshOnFocus={false}
          rootName="项目文件"
          layoutMode="left-only"
          layoutSwitcher={false}
          fullWidth
          panels={{ search: true, git: false }}
        />
      </div>
    </div>
  );
}

const LazyCodeView = lazy(async () => {
  await import('../vendor/codeview/codeview.css');
  const mod = await import('../vendor/codeview/codeview');
  return {
    default: (props: Props) => (
      <CodeViewInner
        {...props}
        CodeWorkspace={mod.CodeWorkspace}
        MemoryProvider={mod.MemoryProvider}
        ServerProvider={mod.ServerProvider}
      />
    ),
  };
});

export default function CodeViewHost(props: Props) {
  return (
    <Suspense
      fallback={(
        <div className="tab-pane">
          <div className="pane-empty">
            <p>加载代码编辑器…</p>
          </div>
        </div>
      )}
    >
      <LazyCodeView {...props} />
    </Suspense>
  );
}
