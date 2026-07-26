import { useEffect, useRef } from 'react';
import { css } from '@codemirror/lang-css';
import { html } from '@codemirror/lang-html';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { xml } from '@codemirror/lang-xml';
import { yaml } from '@codemirror/lang-yaml';
import { syntaxHighlighting } from '@codemirror/language';
import { Compartment, EditorState, type Extension } from '@codemirror/state';
import { oneDarkHighlightStyle } from '@codemirror/theme-one-dark';
import { EditorView } from '@codemirror/view';
import { basicSetup } from 'codemirror';

// CodeMirror is bundled with the app rather than pulled from a CDN, so the
// editor works offline and on a locked-down network. This module is imported
// lazily: it builds a DOM-bound view and must never run during SSR.

/** Maps the ids in file-types.ts to the grammars that back them. */
const LANGUAGES: Record<string, () => Extension> = {
  html: () => html(),
  css: () => css(),
  javascript: () => javascript(),
  typescript: () => javascript({ typescript: true }),
  json: () => json(),
  markdown: () => markdown(),
  yaml: () => yaml(),
  xml: () => xml(),
};

/**
 * Dresses the editor in the app's own tokens instead of shipping a second
 * palette, so it follows the light/dark toggle like everything else. Only the
 * chrome is themed here; the syntax colours come from the highlight style.
 */
function chromeTheme(dark: boolean) {
  return EditorView.theme(
    {
      '&': {
        height: '100%',
        fontSize: '13px',
        backgroundColor: 'transparent',
        color: 'var(--foreground)',
      },
      '&.cm-focused': { outline: 'none' },
      '.cm-scroller': {
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
        lineHeight: '1.6',
      },
      '.cm-content': { padding: '10px 0', caretColor: 'var(--foreground)' },
      '.cm-gutters': {
        backgroundColor: 'transparent',
        color: 'var(--muted-foreground)',
        border: 'none',
      },
      '.cm-activeLine': { backgroundColor: 'color-mix(in oklab, var(--muted) 55%, transparent)' },
      '.cm-activeLineGutter': {
        backgroundColor: 'transparent',
        color: 'var(--foreground)',
      },
      '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--foreground)' },
      '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, .cm-content ::selection': {
        backgroundColor: 'color-mix(in oklab, var(--primary) 30%, transparent)',
      },
      '.cm-panels': {
        backgroundColor: 'var(--popover)',
        color: 'var(--popover-foreground)',
        border: 'none',
      },
      '.cm-searchMatch': {
        backgroundColor: 'color-mix(in oklab, var(--primary) 25%, transparent)',
      },
      '.cm-searchMatch.cm-searchMatch-selected': {
        backgroundColor: 'color-mix(in oklab, var(--primary) 45%, transparent)',
      },
      '.cm-tooltip': {
        backgroundColor: 'var(--popover)',
        color: 'var(--popover-foreground)',
        border: '1px solid var(--border)',
      },
    },
    { dark },
  );
}

interface Props {
  value: string;
  language: string;
  readOnly: boolean;
  dark: boolean;
  onChange: (value: string) => void;
}

export default function CodeEditor({ value, language, readOnly, dark, onChange }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);

  // The callback is read through a ref so a new function identity on every
  // render does not tear the editor down and lose the cursor.
  const notify = useRef(onChange);
  notify.current = onChange;

  // Reconfigured in place rather than remounted, so switching theme or
  // read-only state keeps the document, history and cursor intact.
  const languageConf = useRef(new Compartment());
  const themeConf = useRef(new Compartment());
  const readOnlyConf = useRef(new Compartment());

  useEffect(() => {
    if (!host.current) return;

    const editor = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          basicSetup,
          languageConf.current.of(LANGUAGES[language]?.() ?? []),
          themeConf.current.of(themeFor(dark)),
          readOnlyConf.current.of(readOnlyExtension(readOnly)),
          EditorView.lineWrapping,
          EditorView.updateListener.of((update) => {
            if (update.docChanged) notify.current(update.state.doc.toString());
          }),
        ],
      }),
    });
    view.current = editor;

    return () => {
      editor.destroy();
      view.current = null;
    };
    // Deliberately empty: the view is built once and every prop is applied
    // through a compartment or a dispatch below, never by remounting.
  }, []);

  useEffect(() => {
    view.current?.dispatch({
      effects: languageConf.current.reconfigure(LANGUAGES[language]?.() ?? []),
    });
  }, [language]);

  useEffect(() => {
    view.current?.dispatch({ effects: themeConf.current.reconfigure(themeFor(dark)) });
  }, [dark]);

  useEffect(() => {
    view.current?.dispatch({
      effects: readOnlyConf.current.reconfigure(readOnlyExtension(readOnly)),
    });
  }, [readOnly]);

  // Only when the document really differs: echoing back what the editor just
  // reported would reset the cursor on every keystroke.
  useEffect(() => {
    const editor = view.current;
    if (!editor || editor.state.doc.toString() === value) return;
    editor.dispatch({
      changes: { from: 0, to: editor.state.doc.length, insert: value },
    });
  }, [value]);

  return <div ref={host} className="h-full overflow-hidden" />;
}

function themeFor(dark: boolean): Extension {
  // basicSetup registers its highlight style as a fallback, so this one wins
  // wherever it is present and the default applies in light mode.
  return dark
    ? [chromeTheme(true), syntaxHighlighting(oneDarkHighlightStyle)]
    : chromeTheme(false);
}

function readOnlyExtension(readOnly: boolean): Extension {
  // `editable` hides the cursor as well; `readOnly` is what actually blocks
  // programmatic edits, and both are needed for a genuinely inert view.
  return readOnly ? [EditorState.readOnly.of(true), EditorView.editable.of(false)] : [];
}
