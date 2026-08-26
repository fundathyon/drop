/**
 * Tell Monaco how to spawn its web workers.
 *
 * Monaco 0.56 can find them on its own — every worker is referenced as
 * `new Worker(new URL(…, import.meta.url))`, which bundlers understand — but
 * only for the language services. The core editor worker takes a different
 * route: Monaco resolves it to a URL and then boots it through a generated
 * `blob:` module that re-imports that URL. A blob has no base URL, so the
 * `/_next/static/…` path the bundler produced is not a resolvable specifier
 * from inside it, and the worker dies with "Failed to resolve module
 * specifier" — taking tokenization, diffing and word-based suggestions with it
 * while the editor still renders, which makes the failure a quiet one.
 *
 * Returning a real `Worker` from `getWorker` skips that blob bootstrap
 * entirely. The entry modules next to this file exist for the same reason: a
 * relative `new URL` from inside our own source is the one form every bundler
 * resolves without configuration.
 */
const workers: Record<string, () => Worker> = {
  html: () => new Worker(new URL("./html.worker.ts", import.meta.url), { type: "module" }),
  css: () => new Worker(new URL("./css.worker.ts", import.meta.url), { type: "module" }),
  json: () => new Worker(new URL("./json.worker.ts", import.meta.url), { type: "module" }),
  typescript: () => new Worker(new URL("./ts.worker.ts", import.meta.url), { type: "module" }),
};

/** Labels Monaco gives services that share one worker with another language. */
const aliases: Record<string, string> = {
  handlebars: "html",
  razor: "html",
  scss: "css",
  less: "css",
  javascript: "typescript",
};

export function installMonacoEnvironment(): void {
  if (globalThis.MonacoEnvironment) return;
  globalThis.MonacoEnvironment = {
    getWorker(_workerId: string, label: string) {
      const spawn = workers[aliases[label] ?? label];
      return spawn ? spawn() : new Worker(new URL("./editor.worker.ts", import.meta.url), { type: "module" });
    },
  };
}
