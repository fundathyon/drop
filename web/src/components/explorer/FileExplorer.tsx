import { useState } from 'react';
import { FolderPlus, LayoutGrid, List, Package, PackagePlus } from 'lucide-react';
import { toast } from 'sonner';

import { ThemeToggle } from '@/components/ThemeToggle';
import { DropView } from '@/components/explorer/DropView';
import { ExplorerBreadcrumb } from '@/components/explorer/ExplorerBreadcrumb';
import { FolderView, type ViewMode } from '@/components/explorer/FolderView';
import { ConfirmDialog, NewDropDialog, NewFolderDialog } from '@/components/explorer/dialogs';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Toaster } from '@/components/ui/sonner';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { reportError, useExplorer } from '@/hooks/use-explorer';
import { api } from '@/lib/api';
import { parentOf } from '@/lib/format';
import type { CreateDropInput, Node } from '@/lib/types';

export function FileExplorer() {
  const { path, view, loading, navigate, refresh } = useExplorer();
  const [mode, setMode] = useState<ViewMode>('grid');
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newDropOpen, setNewDropOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Node | null>(null);

  const inDrop = view?.kind === 'drop';

  async function createFolder(name: string) {
    try {
      await api.createFolder(path, name);
      toast.success(`Carpeta "${name}" creada`);
      void refresh();
    } catch (err) {
      reportError(err);
    }
  }

  async function createDrop(input: Omit<CreateDropInput, 'parent'>) {
    try {
      await api.createDrop({ ...input, parent: path });
      toast.success(`Drop "${input.name}" creado`);
      void refresh();
    } catch (err) {
      reportError(err);
    }
  }

  async function deleteNode(node: Node) {
    try {
      await api.deleteNode(node.path);
      toast.success(`Eliminado "${node.name}"`);
      void refresh();
    } catch (err) {
      reportError(err);
    }
  }

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-6 py-3">
          <span className="flex items-center gap-2 font-semibold">
            <Package className="size-5" />
            Drop <span className="font-normal text-muted-foreground">admin</span>
          </span>

          <div className="min-w-0 flex-1">
            <ExplorerBreadcrumb path={path} onNavigate={(p) => void navigate(p)} />
          </div>

          <div className="flex items-center gap-2">
            {!inDrop && (
              <>
                <ToggleGroup
                  type="single"
                  value={mode}
                  variant="outline"
                  onValueChange={(value) => value && setMode(value as ViewMode)}
                >
                  <ToggleGroupItem value="grid" aria-label="Vista de cuadrícula">
                    <LayoutGrid className="size-4" />
                  </ToggleGroupItem>
                  <ToggleGroupItem value="list" aria-label="Vista de lista">
                    <List className="size-4" />
                  </ToggleGroupItem>
                </ToggleGroup>

                <Button variant="outline" onClick={() => setNewFolderOpen(true)}>
                  <FolderPlus className="size-4" />
                  Nueva carpeta
                </Button>
                <Button onClick={() => setNewDropOpen(true)}>
                  <PackagePlus className="size-4" />
                  Nuevo drop
                </Button>
              </>
            )}
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-6">
        {loading || !view ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-3">
            {Array.from({ length: 8 }, (_, i) => (
              <Skeleton key={i} className="h-[132px] rounded-xl" />
            ))}
          </div>
        ) : view.kind === 'folder' ? (
          <FolderView
            nodes={view.children}
            mode={mode}
            onOpen={(node) => void navigate(node.path)}
            onDelete={setPendingDelete}
          />
        ) : (
          <DropView
            detail={view.detail}
            onChanged={() => void refresh()}
            onDeleted={() => void navigate(parentOf(path))}
          />
        )}
      </main>

      {/*
        Dialogs are mounted only while open. Leaving them mounted and merely
        toggling `open` leaves the closed node in the DOM after its exit
        animation, where it still catches clicks aimed at the live dialog.
      */}
      {newFolderOpen && (
        <NewFolderDialog
          open
          onOpenChange={setNewFolderOpen}
          onSubmit={(name) => void createFolder(name)}
        />
      )}
      {newDropOpen && (
        <NewDropDialog
          open
          onOpenChange={setNewDropOpen}
          onSubmit={(input) => void createDrop(input)}
        />
      )}
      {pendingDelete && (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && setPendingDelete(null)}
          title={pendingDelete.kind === 'drop' ? '¿Eliminar este drop?' : '¿Eliminar esta carpeta?'}
          description={`Se eliminará "${pendingDelete.name}" y todo su contenido. Esta acción no se puede deshacer.`}
          onConfirm={() => {
            void deleteNode(pendingDelete);
            setPendingDelete(null);
          }}
        />
      )}

      <Toaster richColors position="bottom-center" />
    </div>
  );
}
