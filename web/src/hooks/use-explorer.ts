import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';

import { ApiError, api } from '@/lib/api';
import type { DropDetail, Node } from '@/lib/types';

/**
 * What the main pane is showing. A path is either a plain folder (list its
 * children) or a drop (show the files it is composed of). The backend decides:
 * listing a drop fails with the `is_drop` code, which is our signal to switch.
 */
export type ExplorerView =
  | { kind: 'folder'; children: Node[] }
  | { kind: 'drop'; detail: DropDetail };

export function reportError(err: unknown): void {
  toast.error(err instanceof Error ? err.message : String(err));
}

export function useExplorer() {
  const [path, setPath] = useState('');
  const [view, setView] = useState<ExplorerView | null>(null);
  const [loading, setLoading] = useState(true);

  const navigate = useCallback(async (target: string) => {
    setLoading(true);
    try {
      const listing = await api.listNodes(target);
      setView({ kind: 'folder', children: listing.children ?? [] });
      setPath(target);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'is_drop') {
        try {
          const detail = await api.getDrop(target);
          setView({ kind: 'drop', detail });
          setPath(target);
        } catch (inner) {
          reportError(inner);
        }
      } else {
        reportError(err);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  /** Re-read the current location after a mutation. */
  const refresh = useCallback(() => navigate(path), [navigate, path]);

  useEffect(() => {
    void navigate('');
  }, [navigate]);

  return { path, view, loading, navigate, refresh };
}
