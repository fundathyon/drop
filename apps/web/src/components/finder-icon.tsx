"use client";

import { useId } from "react";
import { cn } from "@/lib/utils";
import { ACCENT_FILL, typeOf } from "@/lib/filetype";

// macOS-style artwork for the explorer: the blue tabbed folder and the white
// document with its folded corner and per-filetype color band.
//
// This is a client component for one reason: the gradients need ids, and ids
// have to be unique per instance or the document ends up with duplicates.
// `useId` gives that for free. The alternative — a shared <defs> sprite mounted
// once in the layout — is smaller but silently renders every icon invisible the
// day a page forgets to mount it.
//
// All the color lives in CSS custom properties (globals.css), which is what
// lets the art change between light and dark instead of just dimming.

const FOLDER_VIEWBOX = "0 0 64 56";
const DOC_VIEWBOX = "0 0 64 64";

/** Below this the extension label stops being legible, so it isn't drawn. */
const LABEL_MIN_SIZE = 40;

interface ArtProps {
  size?: number;
  className?: string;
}

function FolderShape({ id }: { id: string }) {
  return (
    <>
      <defs>
        <linearGradient id={`${id}-front`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--finder-folder-top)" />
          <stop offset="1" stopColor="var(--finder-folder-body)" />
        </linearGradient>
      </defs>

      {/* Back wall plus the tab. Only the sliver above the front panel is ever
          visible, which is what gives the icon its depth. */}
      <path
        d="M2 12a6 6 0 0 1 6-6h13.5a6 6 0 0 1 4.24 1.76l2.5 2.5A6 6 0 0 0 32.5 12H56a6 6 0 0 1 6 6v28a6 6 0 0 1-6 6H8a6 6 0 0 1-6-6V12Z"
        fill="var(--finder-folder-edge)"
      />

      {/* Front panel. */}
      <path
        d="M2 21a4 4 0 0 1 4-4h52a4 4 0 0 1 4 4v25a6 6 0 0 1-6 6H8a6 6 0 0 1-6-6V21Z"
        fill={`url(#${id}-front)`}
      />

      {/* Specular sliver along the front panel's top edge. */}
      <path d="M6 17h52a4 4 0 0 1 4 4v1.5H2V21a4 4 0 0 1 4-4Z" fill="#fff" fillOpacity="0.18" />
    </>
  );
}

/** A plain folder. */
export function FolderIcon({ size = 64, className }: ArtProps) {
  const id = useId();
  return (
    <svg
      viewBox={FOLDER_VIEWBOX}
      width={size}
      height={(size * 56) / 64}
      className={cn("shrink-0", className)}
      aria-hidden="true"
      focusable="false"
    >
      <FolderShape id={id} />
    </svg>
  );
}

/**
 * A drop — a folder that is also a publishable unit. Same folder, badged the
 * way macOS badges a folder whose contents are shared out, so the two read as
 * the same kind of thing at a glance and differ only in what they can do.
 */
export function DropIcon({ size = 64, className }: ArtProps) {
  const id = useId();
  return (
    <svg
      viewBox={FOLDER_VIEWBOX}
      width={size}
      height={(size * 56) / 64}
      className={cn("shrink-0", className)}
      aria-hidden="true"
      focusable="false"
    >
      <FolderShape id={id} />

      {/* Badge well: a hole punched in the folder so the badge sits in it
          rather than on top of it. */}
      <circle cx="49" cy="39" r="12.5" fill="var(--fdn-bg)" />
      <circle cx="49" cy="39" r="10.5" className="fill-accent-solid" />

      {/* Package glyph — an open box seen from above, at 1.5px stroke to match
          the icon set's weight. */}
      <g
        fill="none"
        stroke="var(--fdn-accent-on-solid)"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M49 33.2 55.4 36.6v6.8L49 46.8l-6.4-3.4v-6.8Z" />
        <path d="M42.6 36.6 49 40l6.4-3.4M49 40v6.8" />
      </g>
    </svg>
  );
}

/**
 * A document, colored and labelled by extension. `typeOf` decides both, so the
 * band here and the small inline icon in a table row always agree.
 */
export function DocumentIcon({ name, size = 64, className }: ArtProps & { name: string }) {
  const id = useId();
  const type = typeOf(name);
  const showLabel = size >= LABEL_MIN_SIZE;

  return (
    <svg
      viewBox={DOC_VIEWBOX}
      width={size}
      height={size}
      className={cn("shrink-0", className)}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id={`${id}-paper`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--finder-paper)" />
          <stop offset="1" stopColor="var(--finder-fold)" />
        </linearGradient>
      </defs>

      {/* Sheet, with the top-right corner cut where the fold sits. */}
      <path
        d="M14 6a4 4 0 0 1 4-4h20l14 14v42a4 4 0 0 1-4 4H18a4 4 0 0 1-4-4V6Z"
        fill={`url(#${id}-paper)`}
        stroke="var(--finder-paper-edge)"
        strokeWidth="1"
      />

      {/* The folded corner itself. */}
      <path d="M38 2l14 14H42a4 4 0 0 1-4-4V2Z" fill="var(--finder-paper-edge)" fillOpacity="0.75" />

      {/* Ruled lines standing in for content. They stop above the band so the
          sheet never looks like it is holding text behind the label. */}
      <g fill="var(--finder-rule)">
        <rect x="20" y="24" width="26" height="2" rx="1" />
        <rect x="20" y="30" width="20" height="2" rx="1" />
        <rect x="20" y="36" width="24" height="2" rx="1" />
      </g>

      {/* Kind band. Present at every size — it is what makes the file readable
          as "an HTML" from across the grid — but the text only appears once
          there are enough pixels to read it. */}
      <rect x="14" y="44" width="38" height="14" rx="3" className={ACCENT_FILL[type.accent]} />
      {showLabel && (
        <text
          x="33"
          y="53.5"
          textAnchor="middle"
          fontSize="8.5"
          fontWeight="700"
          letterSpacing="0.4"
          fill="#fff"
          fontFamily="var(--font-sans, system-ui), system-ui, sans-serif"
        >
          {type.label}
        </text>
      )}
    </svg>
  );
}

/**
 * Dispatcher for an explorer node. `name` is only consulted for files, where
 * the extension picks the color and the label.
 */
export function FinderIcon({
  kind,
  name,
  size = 64,
  className,
}: ArtProps & { kind: "folder" | "drop" | "file"; name?: string }) {
  if (kind === "folder") return <FolderIcon size={size} className={className} />;
  if (kind === "drop") return <DropIcon size={size} className={className} />;
  return <DocumentIcon name={name ?? ""} size={size} className={className} />;
}
