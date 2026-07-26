import { useState } from 'react';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { formatDate } from '@/lib/format';
import type { CreateDropInput, DropMeta, DropMetaPatch, Visibility } from '@/lib/types';

interface NewFolderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (name: string) => void;
}

export function NewFolderDialog({ open, onOpenChange, onSubmit }: NewFolderDialogProps) {
  const [name, setName] = useState('');

  function handleSubmit() {
    const trimmed = name.trim();
    if (!trimmed) return;
    onSubmit(trimmed);
    setName('');
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            handleSubmit();
          }}
        >
          <DialogHeader>
            <DialogTitle>Nueva carpeta</DialogTitle>
            <DialogDescription>
              Una carpeta organiza otras carpetas y drops. No guarda archivos.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-2 py-4">
            <Label htmlFor="folder-name">Nombre</Label>
            <Input
              id="folder-name"
              value={name}
              autoComplete="off"
              onChange={(e) => setName(e.target.value)}
              placeholder="Proyectos"
              required
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit">Crear</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

interface NewDropDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (input: Omit<CreateDropInput, 'parent'>) => void;
}

export function NewDropDialog({ open, onOpenChange, onSubmit }: NewDropDialogProps) {
  const [name, setName] = useState('');
  const [title, setTitle] = useState('');
  const [entrypoint, setEntrypoint] = useState('');
  const [visibility, setVisibility] = useState<Visibility>('public');

  function handleSubmit() {
    const trimmed = name.trim();
    if (!trimmed) return;
    onSubmit({ name: trimmed, title: title.trim(), entrypoint: entrypoint.trim(), visibility });
    setName('');
    setTitle('');
    setEntrypoint('');
    setVisibility('public');
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            handleSubmit();
          }}
        >
          <DialogHeader>
            <DialogTitle>Nuevo drop</DialogTitle>
            <DialogDescription>
              Un drop es la unidad publicable: lleva metadata propia y contiene archivos.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="drop-name">Nombre de carpeta</Label>
              <Input
                id="drop-name"
                value={name}
                autoComplete="off"
                onChange={(e) => setName(e.target.value)}
                placeholder="arquitectura"
                required
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="drop-title">Título</Label>
              <Input
                id="drop-title"
                value={title}
                autoComplete="off"
                onChange={(e) => setTitle(e.target.value)}
                placeholder="(igual al nombre si se deja vacío)"
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="drop-visibility">Visibilidad</Label>
              <Select value={visibility} onValueChange={(v) => setVisibility(v as Visibility)}>
                <SelectTrigger id="drop-visibility">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="private">private</SelectItem>
                  <SelectItem value="unlisted">unlisted</SelectItem>
                  <SelectItem value="public">public</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="drop-entrypoint">Entrypoint</Label>
              <Input
                id="drop-entrypoint"
                value={entrypoint}
                autoComplete="off"
                onChange={(e) => setEntrypoint(e.target.value)}
                placeholder="index.html"
              />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit">Crear</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

interface EditDropDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  meta: DropMeta;
  saving: boolean;
  onSubmit: (patch: DropMetaPatch) => void;
}

/**
 * Metadata editing lives in a dialog so the drop view itself stays a plain
 * file listing.
 */
export function EditDropDialog({
  open,
  onOpenChange,
  meta,
  saving,
  onSubmit,
}: EditDropDialogProps) {
  const [title, setTitle] = useState(meta.title);
  const [entrypoint, setEntrypoint] = useState(meta.entrypoint);
  const [visibility, setVisibility] = useState<Visibility>(meta.visibility);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit({ title, entrypoint, visibility });
          }}
        >
          <DialogHeader>
            <DialogTitle>Metadata del drop</DialogTitle>
            <DialogDescription>
              Se guarda en el archivo <code>.drop</code> junto a los archivos del drop.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="meta-title">Título</Label>
              <Input
                id="meta-title"
                value={title}
                autoComplete="off"
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="meta-visibility">Visibilidad</Label>
              <Select value={visibility} onValueChange={(v) => setVisibility(v as Visibility)}>
                <SelectTrigger id="meta-visibility" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="private">private</SelectItem>
                  <SelectItem value="unlisted">unlisted</SelectItem>
                  <SelectItem value="public">public</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="meta-entrypoint">Entrypoint</Label>
              <Input
                id="meta-entrypoint"
                value={entrypoint}
                autoComplete="off"
                onChange={(e) => setEntrypoint(e.target.value)}
              />
            </div>

            <dl className="grid gap-1 border-t pt-3 text-xs text-muted-foreground">
              <div className="flex justify-between gap-2">
                <dt>Slug</dt>
                <dd className="font-mono text-foreground">{meta.slug}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt>Creado</dt>
                <dd>{formatDate(meta.created_at)}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt>Actualizado</dt>
                <dd>{formatDate(meta.updated_at)}</dd>
              </div>
            </dl>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? 'Guardando…' : 'Guardar cambios'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel?: string;
  onConfirm: () => void;
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Eliminar',
  onConfirm,
}: ConfirmDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          {/*
            Use the component's own `variant` prop. Appending `bg-destructive` via
            className instead leaves both it and the default `bg-primary` on the
            element, and between two same-specificity utilities the stylesheet
            order wins — which rendered the confirm button primary-coloured.
          */}
          <AlertDialogAction variant="destructive" onClick={onConfirm}>
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
