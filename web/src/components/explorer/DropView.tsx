import { useRef, useState } from 'react';
import { Download, FileText, Lock, Pencil, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';

import { FileEditorDialog } from '@/components/explorer/FileEditorDialog';
import { ConfirmDialog, EditDropDialog } from '@/components/explorer/dialogs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { reportError } from '@/hooks/use-explorer';
import { api } from '@/lib/api';
import { fileType } from '@/lib/file-types';
import { formatDate, formatSize, joinPath } from '@/lib/format';
import type { DropDetail, DropMetaPatch, FileInfo } from '@/lib/types';

interface Props {
  detail: DropDetail;
  onChanged: () => void;
  onDeleted: () => void;
}

/** A drop's contents: the files it is composed of. Metadata is edited in a dialog. */
export function DropView({ detail, onChanged, onDeleted }: Props) {
  const [saving, setSaving] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [openFile, setOpenFile] = useState<FileInfo | null>(null);
  const [pendingFile, setPendingFile] = useState<FileInfo | null>(null);
  const [confirmDrop, setConfirmDrop] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  async function saveMeta(patch: DropMetaPatch) {
    setSaving(true);
    try {
      await api.patchDrop(detail.path, patch);
      toast.success('Metadata actualizada');
      setEditOpen(false);
      onChanged();
    } catch (err) {
      reportError(err);
    } finally {
      setSaving(false);
    }
  }

  async function uploadFiles(files: FileList) {
    try {
      await api.uploadFiles(detail.path, files);
      toast.success(files.length === 1 ? 'Archivo subido' : `${files.length} archivos subidos`);
      onChanged();
    } catch (err) {
      reportError(err);
    } finally {
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  async function deleteFile(file: FileInfo) {
    try {
      await api.deleteFile(joinPath(detail.path, file.name));
      toast.success(`Archivo "${file.name}" eliminado`);
      onChanged();
    } catch (err) {
      reportError(err);
    }
  }

  async function deleteDrop() {
    try {
      await api.deleteNode(detail.path);
      toast.success('Drop eliminado');
      onDeleted();
    } catch (err) {
      reportError(err);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold">Archivos</h2>
        <Badge variant="secondary">{detail.meta.visibility}</Badge>

        <div className="ml-auto flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
            <Pencil className="size-4" />
            Metadata
          </Button>
          <Button variant="outline" size="sm" onClick={() => fileInput.current?.click()}>
            <Upload className="size-4" />
            Subir archivo
          </Button>
          <Button variant="destructive" size="sm" onClick={() => setConfirmDrop(true)}>
            <Trash2 className="size-4" />
            Eliminar drop
          </Button>
        </div>

        <input
          ref={fileInput}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            const files = e.target.files;
            if (files && files.length > 0) void uploadFiles(files);
          }}
        />
      </div>

      {detail.files.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed py-20 text-center">
          <FileText className="size-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Sin archivos todavía.</p>
        </div>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nombre</TableHead>
                <TableHead className="w-24">Tipo</TableHead>
                <TableHead className="w-28">Tamaño</TableHead>
                <TableHead className="w-48">Modificado</TableHead>
                <TableHead className="w-28" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {detail.files.map((file) => {
                const type = fileType(file.name);
                return (
                  <TableRow
                    key={file.name}
                    tabIndex={0}
                    role="button"
                    aria-label={`Abrir ${file.name}`}
                    className="cursor-pointer"
                    onClick={() => setOpenFile(file)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setOpenFile(file);
                      }
                    }}
                  >
                    <TableCell className="font-medium">
                      <span className="flex items-center gap-2">
                        <type.Icon className={`size-4 ${type.className}`} />
                        {file.name}
                        {file.generated && (
                          <Lock
                            className="size-3 text-muted-foreground"
                            aria-label="mantenido por la API"
                          />
                        )}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{type.label}</Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{formatSize(file.size)}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDate(file.modified_at)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8"
                        asChild
                        onClick={(e) => e.stopPropagation()}
                      >
                        <a
                          href={api.fileUrl(joinPath(detail.path, file.name))}
                          target="_blank"
                          rel="noopener"
                          aria-label={`Descargar ${file.name}`}
                        >
                          <Download className="size-4" />
                        </a>
                      </Button>
                      {/* The descriptor is maintained by the API — nothing to delete here. */}
                      {!file.generated && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8"
                          aria-label={`Eliminar ${file.name}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            setPendingFile(file);
                          }}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Mounted only while open — see the note in FileExplorer. */}
      {openFile && (
        <FileEditorDialog
          dropPath={detail.path}
          file={openFile}
          onOpenChange={(open) => !open && setOpenFile(null)}
          onSaved={onChanged}
        />
      )}

      {editOpen && (
        <EditDropDialog
          open
          onOpenChange={setEditOpen}
          meta={detail.meta}
          saving={saving}
          onSubmit={(patch) => void saveMeta(patch)}
        />
      )}

      {pendingFile && (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && setPendingFile(null)}
          title="¿Eliminar archivo?"
          description={`Se eliminará "${pendingFile.name}" de este drop. Esta acción no se puede deshacer.`}
          onConfirm={() => {
            void deleteFile(pendingFile);
            setPendingFile(null);
          }}
        />
      )}

      {confirmDrop && (
        <ConfirmDialog
          open
          onOpenChange={setConfirmDrop}
          title="¿Eliminar este drop?"
          description="Se eliminarán el drop y todos sus archivos. Esta acción no se puede deshacer."
          onConfirm={() => {
            setConfirmDrop(false);
            void deleteDrop();
          }}
        />
      )}
    </div>
  );
}
