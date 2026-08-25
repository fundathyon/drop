"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@/components/icon";
import { formatSize } from "@/lib/format";
import { cn } from "@/lib/utils";

export function Dropzone({ id, name }: { id: string; name: string }) {
  const t = useTranslations("explorer");
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);

  // The native <input> is the only thing the surrounding <form action> reads
  // on submit, so every add/remove has to rebuild its FileList through
  // DataTransfer (the documented way to set input.files programmatically),
  // not just update the React list used for display.
  function sync(next: File[]) {
    setFiles(next);
    const input = inputRef.current;
    if (!input) return;
    const transfer = new DataTransfer();
    for (const file of next) transfer.items.add(file);
    input.files = transfer.files;
  }

  function addFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    sync([...files, ...Array.from(list)]);
  }

  function removeFile(index: number) {
    sync(files.filter((_, i) => i !== index));
  }

  return (
    <div className="grid gap-2">
      <input
        ref={inputRef}
        id={id}
        name={name}
        type="file"
        multiple
        className="sr-only"
        onChange={(e) => addFiles(e.target.files)}
      />
      <label
        htmlFor={id}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          addFiles(e.dataTransfer.files);
        }}
        className={cn(
          "flex cursor-pointer flex-col items-center gap-1.5 rounded-lg border border-dashed px-4 py-6 text-center text-sm text-text-muted transition-colors",
          dragging ? "border-accent-border bg-accent-bg" : "hover:bg-surface-hover"
        )}
      >
        <Icon name="upload" size={20} />
        <span>{t("newDropDialog.dropzoneInstructions")}</span>
      </label>

      {files.length > 0 && (
        <ul className="flex flex-col gap-1">
          {files.map((file, index) => (
            <li
              key={`${file.name}-${file.size}-${index}`}
              className="flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-sm"
            >
              <span className="flex-1 truncate">{file.name}</span>
              <span className="shrink-0 text-xs text-text-muted">{formatSize(file.size)}</span>
              <button
                type="button"
                onClick={() => removeFile(index)}
                aria-label={t("newDropDialog.removeFileAriaLabel", { name: file.name })}
                className="shrink-0 text-text-muted hover:text-text"
              >
                <Icon name="x" size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
