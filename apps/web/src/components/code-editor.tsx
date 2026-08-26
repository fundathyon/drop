"use client";

import { useEffect, useRef, useState } from "react";
import type * as Monaco from "monaco-editor";
import { cn } from "@foundathyon/community-ui";
import { installMonacoEnvironment } from "@/lib/monaco/environment";
import { applyTheme } from "@/lib/monaco-theme";

export interface CursorPosition {
  line: number;
  column: number;
  /** Total lines in the document, for the "of N" half of the readout. */
  lines: number;
}

export interface CodeEditorProps {
  /**
   * Initial text. The editor is UNCONTROLLED past mount — the same contract
   * the textarea it replaces had with `defaultValue`, and the only one that
   * makes sense for something that owns an undo stack.
   */
  value: string;
  /** Monaco language id (`html`, `css`, `typescript`, `plaintext`…). */
  language: string;
  /** File name, used to give the model a URI the language services key off. */
  path: string;
  readOnly?: boolean;
  onChange?: (value: string) => void;
  onCursorChange?: (position: CursorPosition) => void;
  /** ⌘S / Ctrl-S pressed with focus inside the editor. */
  onSave?: () => void;
  ariaLabel?: string;
  className?: string;
}

/**
 * The file editor: Monaco, the editor from VS Code, themed from this app's own
 * design tokens rather than one of its stock themes (see lib/monaco-theme).
 *
 * Monaco is loaded with a dynamic import inside the effect rather than a top
 * level one for two reasons: it touches `self` while evaluating, which would
 * throw during SSR of this client component, and it is by far the heaviest
 * thing this app ships — this keeps it on the one route that needs it.
 */
export function CodeEditor({
  value,
  language,
  path,
  readOnly = false,
  onChange,
  onCursorChange,
  onSave,
  ariaLabel,
  className,
}: CodeEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);

  // Callbacks arrive fresh on every parent render. Held in refs so the effect
  // below can depend only on what genuinely requires a new editor — otherwise
  // every keystroke would tear the editor down and take the undo history,
  // selection and scroll position with it.
  const handlers = useRef({ onChange, onCursorChange, onSave });
  // No dependency array on purpose: every render republishes the current
  // callbacks, and they are only ever read from Monaco events, which fire
  // after commit.
  useEffect(() => {
    handlers.current = { onChange, onCursorChange, onSave };
  });

  // Read once: changing either afterwards is not something this app does, and
  // treating them as live props would mean rebuilding the editor mid-edit.
  const initial = useRef({ value, language, path, ariaLabel });

  useEffect(() => {
    let cancelled = false;
    let editor: Monaco.editor.IStandaloneCodeEditor | undefined;
    let model: Monaco.editor.ITextModel | undefined;
    let stopWatchingTheme: (() => void) | undefined;

    void (async () => {
      // Before the import: Monaco reads MonacoEnvironment lazily, but the
      // first worker can be requested as soon as a model exists.
      installMonacoEnvironment();

      const monaco = await import("monaco-editor");
      if (cancelled || !containerRef.current) return;

      // Files here are standalone — a page, a stylesheet, a script — not part
      // of a project with a tsconfig and node_modules. Semantic diagnostics
      // would flag every undeclared global and every bare import as an error,
      // so only the syntax half is kept.
      for (const defaults of [monaco.typescript.javascriptDefaults, monaco.typescript.typescriptDefaults]) {
        defaults.setDiagnosticsOptions({ noSemanticValidation: true, noSyntaxValidation: false });
        defaults.setCompilerOptions({
          ...defaults.getCompilerOptions(),
          allowNonTsExtensions: true,
          jsx: monaco.typescript.JsxEmit.React,
          target: monaco.typescript.ScriptTarget.ESNext,
        });
      }

      applyTheme(monaco);

      // A URI is what the html/css/json/ts services use to tell models apart.
      // Disposing any leftover under the same one keeps a remount (React runs
      // effects twice in development) from hitting "model already exists".
      const uri = monaco.Uri.parse(`inmemory://drop/${initial.current.path}`);
      monaco.editor.getModel(uri)?.dispose();
      model = monaco.editor.createModel(initial.current.value, initial.current.language, uri);

      editor = monaco.editor.create(containerRef.current, {
        model,
        ariaLabel: initial.current.ariaLabel,
        readOnly,
        domReadOnly: readOnly,
        automaticLayout: true,
        fontFamily: "var(--font-geist-mono), ui-monospace, SFMono-Regular, Menlo, monospace",
        fontSize: 13,
        lineHeight: 20,
        padding: { top: 12, bottom: 12 },
        tabSize: 2,
        insertSpaces: true,
        detectIndentation: true,
        renderLineHighlight: "all",
        renderWhitespace: "selection",
        roundedSelection: false,
        cursorBlinking: "smooth",
        smoothScrolling: true,
        scrollBeyondLastLine: false,
        overviewRulerBorder: false,
        minimap: { enabled: true, renderCharacters: false },
        stickyScroll: { enabled: true },
        guides: { indentation: true, bracketPairs: false },
        // Rainbow brackets would put six unrelated hues on screen; §20 allows
        // code four, and they all already mean something.
        bracketPairColorization: { enabled: false },
        scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10, useShadows: false },
        fixedOverflowWidgets: true,
      });

      const report = () => {
        const position = editor?.getPosition();
        if (!position || !model) return;
        handlers.current.onCursorChange?.({
          line: position.lineNumber,
          column: position.column,
          lines: model.getLineCount(),
        });
      };

      model.onDidChangeContent(() => {
        handlers.current.onChange?.(model?.getValue() ?? "");
        report();
      });
      editor.onDidChangeCursorPosition(report);
      report();

      // Monaco owns ⌘S here: the browser's "save page" is never what someone
      // means with a cursor in a file they are editing.
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => handlers.current.onSave?.());

      // The palette can move under a running editor — the theme toggle, the
      // accent picker, or the OS flipping while "system" is selected. Each of
      // those changes what the tokens resolve to, so the theme is rebuilt from
      // them rather than patched.
      const refresh = () => applyTheme(monaco);
      const observer = new MutationObserver(refresh);
      observer.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["data-fdn-theme", "data-accent"],
      });
      const system = window.matchMedia("(prefers-color-scheme: light)");
      system.addEventListener("change", refresh);
      stopWatchingTheme = () => {
        observer.disconnect();
        system.removeEventListener("change", refresh);
      };

      setReady(true);
    })();

    return () => {
      cancelled = true;
      stopWatchingTheme?.();
      editor?.dispose();
      model?.dispose();
    };
  }, [readOnly]);

  const frame = "border-border bg-bg-subtle overflow-hidden rounded-lg border";

  return (
    <div className={cn("relative", className)}>
      <div ref={containerRef} className={cn(frame, "h-full")} />
      {/* The file itself, at Monaco's own metrics, until Monaco takes over.
          A spinner would say less than the content does, there is no layout
          shift when the two swap, and if the editor never loads at all this is
          still the file — readable, if not editable. */}
      {!ready && (
        <pre
          aria-hidden="true"
          className={cn(frame, "text-text-muted absolute inset-0 p-3 font-mono text-[13px] leading-5")}
        >
          {value}
        </pre>
      )}
    </div>
  );
}
