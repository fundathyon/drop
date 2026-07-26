import { Folder, MoreVertical, Package, Trash2 } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { Node } from '@/lib/types';

export type ViewMode = 'grid' | 'list';

interface Props {
  nodes: Node[];
  mode: ViewMode;
  onOpen: (node: Node) => void;
  onDelete: (node: Node) => void;
}

/**
 * A drop is a publishable bundle, not a container you browse into, so it gets
 * its own mark instead of a folder variant. Plain folders stay folders.
 */
function NodeIcon({ node, className }: { node: Node; className?: string }) {
  return node.kind === 'drop' ? (
    <Package className={className} />
  ) : (
    <Folder className={className} />
  );
}

function KindBadge({ node }: { node: Node }) {
  return node.kind === 'drop' ? (
    <Badge variant="default">drop</Badge>
  ) : (
    <Badge variant="secondary">carpeta</Badge>
  );
}

function ItemMenu({ node, onDelete }: { node: Node; onDelete: (node: Node) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          aria-label={`Acciones de ${node.name}`}
          onClick={(e) => e.stopPropagation()}
        >
          <MoreVertical className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          variant="destructive"
          onClick={(e) => {
            e.stopPropagation();
            onDelete(node);
          }}
        >
          <Trash2 className="size-4" />
          Eliminar
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function FolderView({ nodes, mode, onOpen, onDelete }: Props) {
  if (nodes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed py-20 text-center">
        <Folder className="size-8 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Esta carpeta está vacía.</p>
      </div>
    );
  }

  if (mode === 'list') {
    return (
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nombre</TableHead>
              <TableHead className="w-32">Tipo</TableHead>
              <TableHead className="w-16" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {nodes.map((node) => (
              <TableRow
                key={node.path}
                tabIndex={0}
                role="button"
                aria-label={`${node.kind === 'drop' ? 'Drop' : 'Carpeta'} ${node.name}`}
                className="cursor-pointer"
                onClick={() => onOpen(node)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onOpen(node);
                  }
                }}
              >
                <TableCell className="font-medium">
                  <span className="flex items-center gap-2">
                    <NodeIcon
                      node={node}
                      className={
                        node.kind === 'drop' ? 'size-4 text-primary' : 'size-4 text-muted-foreground'
                      }
                    />
                    {node.name}
                  </span>
                </TableCell>
                <TableCell>
                  <KindBadge node={node} />
                </TableCell>
                <TableCell className="text-right">
                  <ItemMenu node={node} onDelete={onDelete} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-3">
      {nodes.map((node) => (
        <Card
          key={node.path}
          tabIndex={0}
          role="button"
          aria-label={`${node.kind === 'drop' ? 'Drop' : 'Carpeta'} ${node.name}`}
          className="group cursor-pointer gap-0 p-4 transition-colors hover:border-primary/40 hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          onClick={() => onOpen(node)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onOpen(node);
            }
          }}
        >
          <div className="flex items-start justify-between">
            <NodeIcon
              node={node}
              className={
                node.kind === 'drop' ? 'size-8 text-primary' : 'size-8 text-muted-foreground'
              }
            />
            <div className="opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
              <ItemMenu node={node} onDelete={onDelete} />
            </div>
          </div>
          <p className="mt-3 truncate text-sm font-medium" title={node.name}>
            {node.name}
          </p>
          <div className="mt-2">
            <KindBadge node={node} />
          </div>
        </Card>
      ))}
    </div>
  );
}
