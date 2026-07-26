import Editor, { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
// monaco-editor's `exports` map is `"./*": "./esm/vs/*.js"`, so the worker
// specifiers omit the `esm/vs/` prefix — including it resolves to a doubled path.
import editorWorker from 'monaco-editor/editor/editor.worker?worker';
import cssWorker from 'monaco-editor/language/css/css.worker?worker';
import htmlWorker from 'monaco-editor/language/html/html.worker?worker';
import jsonWorker from 'monaco-editor/language/json/json.worker?worker';
import tsWorker from 'monaco-editor/language/typescript/ts.worker?worker';

// Monaco is bundled with the app rather than pulled from a CDN, so the editor
// works offline and on a locked-down network. This module is imported lazily —
// it touches `self` at load time and must never run during SSR.
self.MonacoEnvironment = {
  getWorker(_workerId: string, label: string) {
    switch (label) {
      case 'json':
        return new jsonWorker();
      case 'css':
      case 'scss':
      case 'less':
        return new cssWorker();
      case 'html':
      case 'handlebars':
      case 'razor':
        return new htmlWorker();
      case 'typescript':
      case 'javascript':
        return new tsWorker();
      default:
        return new editorWorker();
    }
  },
};

loader.config({ monaco });

interface Props {
  value: string;
  language: string;
  readOnly: boolean;
  dark: boolean;
  onChange: (value: string) => void;
}

export default function MonacoEditor({ value, language, readOnly, dark, onChange }: Props) {
  return (
    <Editor
      height="100%"
      language={language}
      value={value}
      theme={dark ? 'vs-dark' : 'light'}
      onChange={(next) => onChange(next ?? '')}
      options={{
        readOnly,
        domReadOnly: readOnly,
        minimap: { enabled: false },
        fontSize: 13,
        tabSize: 2,
        scrollBeyondLastLine: false,
        automaticLayout: true,
        padding: { top: 12, bottom: 12 },
      }}
    />
  );
}
