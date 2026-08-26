// Worker entry point. Its only job is to be a module of THIS app, so that
// `new URL("./html.worker.ts", import.meta.url)` in environment.ts resolves to
// a file the bundler emits — see the note there for why Monaco is not left to
// load its own workers.
import "monaco-editor/language/html/html.worker";
