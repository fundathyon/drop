import { Suspense, lazy, useEffect, useState } from 'react';
import { Download, Lock } from 'lucide-react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { reportError } from '@/hooks/use-explorer';
import { api } from '@/lib/api';
import { fileType } from '@/lib/file-types';
import { formatSize, joinPath } from '@/lib/format';
import type { FileInfo } from '@/lib/types';

// Monaco is heavy and browser-only: load it on demand, never during SSR.
const MonacoEditor = lazy(() => import('@/components/explorer/MonacoEditor'));

interface Props {
  dropPath: string;
  file: FileInfo;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}

export function FileEditorDialog({ dropPath, file, onOpenChange, onSaved }: Props) {
  const type = fileType(file.name);
  const path = joinPath(dropPath, file.name);
  // The `.drop` descriptor is derived from the drop's metadata, so editing it
  // here would be overwritten on the next save. Show it, don't let it be typed into.
  const readOnly = file.generated || !type.editable;

  const [content, setContent] = useState<string | null>(null);
  const [original, setOriginal] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [dark, setDark] = useState(false);

  useEffect(() => {
    setDark(document.documentElement.classList.contains('dark'));
  }, []);

  useEffect(() => {
    if (type.editable === false && !file.generated) return;
    let cancelled = false;
    void (async () => {
      try {
        const text = await api.readFileText(path);
        if (cancelled) return;
        setContent(text);
        setOriginal(text);
      } catch (err) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [path, type.editable, file.generated]);

  const dirty = content !== null && content !== original;

  async function save() {
    if (content === null) return;
    setSaving(true);
    try {
      await api.writeFileText(dropPath, file.name, content, type.contentType);
      toast.success(`"${file.name}" guardado`);
      setOriginal(content);
      onSaved();
      onOpenChange(false);
    } catch (err) {
      reportError(err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent
        className="flex h-[85vh] w-[95vw] flex-col gap-3 sm:max-w-5xl"
        showCloseButton={!dirty}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <type.Icon className={`size-4 ${type.className}`} />
            {file.name}
            <Badge variant="outline">{type.label}</Badge>
            {readOnly && (
              <Badge variant="secondary" className="gap-1">
                <Lock className="size-3" />
                solo lectura
              </Badge>
            )}
          </DialogTitle>
          <DialogDescription>
            {file.generated
              ? 'Lo mantiene la API a partir de la metadata del drop; se regenera en cada cambio.'
              : `${formatSize(file.size)} · ${path}`}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-hidden rounded-lg border">
          {loadError ? (
            <div className="flex h-full items-center justify-center p-6 text-center text-sm text-destructive">
              {loadError}
            </div>
          ) : type.image && !type.editable ? (
            <div className="flex h-full items-center justify-center bg-muted/30 p-6">
              <img
                src={api.fileUrl(path)}
                alt={file.name}
                className="max-h-full max-w-full object-contain"
              />
            </div>
          ) : !type.editable ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
              <p className="text-sm text-muted-foreground">
                Este tipo de archivo no se puede editar como texto.
              </p>
              <Button variant="outline" size="sm" asChild>
                <a href={api.fileUrl(path)} target="_blank" rel="noopener">
                  <Download className="size-4" />
                  Descargar
                </a>
              </Button>
            </div>
          ) : content === null ? (
            <Skeleton className="h-full w-full rounded-none" />
          ) : (
            <Suspense fallback={<Skeleton className="h-full w-full rounded-none" />}>
              <MonacoEditor
                value={content}
                language={type.language}
                readOnly={readOnly}
                dark={dark}
                onChange={setContent}
              />
            </Suspense>
          )}
        </div>

        <DialogFooter className="sm:justify-between">
          <span className="self-center text-xs text-muted-foreground">
            {dirty ? 'Cambios sin guardar' : ' '}
          </span>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              {readOnly ? 'Cerrar' : 'Cancelar'}
            </Button>
            {!readOnly && (
              <Button onClick={() => void save()} disabled={!dirty || saving}>
                {saving ? 'Guardando…' : 'Guardar'}
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
