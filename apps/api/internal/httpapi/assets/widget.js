// Drop badge injected into published pages: a bar pinned to the bottom of the
// document and a sidebar with the drop's identity, details, files and version
// history.
//
// Everything lives in a shadow root so the host page's CSS cannot reach it and
// its own styles cannot leak out. The drop's metadata is inlined by the server
// rather than fetched: published pages run under `CSP: sandbox`, in an opaque
// origin, so a call back to the API would be cross-origin and blocked. That
// same constraint is why nothing here mutates anything — the badge is what a
// VISITOR sees, with no session and no way to reach the API. Everything that
// changes a drop lives in the admin.
(() => {
  // Not inside a frame. The details panel previews the drop's own entrypoint in
  // an iframe, and without this the preview would load a page that injects this
  // script, which previews itself, forever.
  if (window.self !== window.top) return;

  const source = document.getElementById('__drop_meta');
  if (!source) return;

  let drop;
  try {
    drop = JSON.parse(source.textContent || '{}');
  } catch {
    return;
  }
  if (!drop.slug) return;

  const MARK = `
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="dg" x1="0" y1="24" x2="24" y2="0">
          <stop offset="0" stop-color="#6d4aff"/>
          <stop offset=".55" stop-color="#7c6cf6"/>
          <stop offset="1" stop-color="#7ee8c0"/>
        </linearGradient>
      </defs>
      <path d="M8.2 10.6 15.4 6.6M8.2 13.4l7.2 4" stroke="url(#dg)" stroke-width="1.9" stroke-linecap="round"/>
      <circle cx="17.4" cy="5.6" r="3.4" fill="url(#dg)"/>
      <circle cx="6.2" cy="12" r="3.4" fill="url(#dg)"/>
      <circle cx="17.4" cy="18.4" r="3.4" fill="url(#dg)"/>
    </svg>`;

  // Line icons, 24-grid, 1.6 stroke — the same weight as MARK so the panel
  // reads as one set. Inlined rather than pulled from a library: this file is
  // appended to every published page and has no dependencies by design.
  const glyph = (d, extra = '') =>
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"
      stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}${extra}</svg>`;

  const ICON = {
    file: glyph('<path d="M14 3v5h5"/><path d="M19 8.5V20a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h8z"/>'),
    code: glyph('<path d="M14 3v5h5"/><path d="M19 8.5V20a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h8z"/><path d="m9.5 12.5-1.5 1.75 1.5 1.75M14 12.5l1.5 1.75-1.5 1.75"/>'),
    image: glyph('<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="m4.5 17 4.2-4.2a1.5 1.5 0 0 1 2.1 0l5.4 5.4M15 14.2l1.4-1.4a1.5 1.5 0 0 1 2.1 0l1.5 1.5"/>'),
    pdf: glyph('<path d="M14 3v5h5"/><path d="M19 8.5V20a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h8z"/><path d="M8.5 16.5c3-1 4.5-4.5 3.5-5.5s-2 1.5-.5 4 3 3 4 2.5"/>'),
    text: glyph('<path d="M14 3v5h5"/><path d="M19 8.5V20a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h8z"/><path d="M8.5 12.5h5M8.5 15.5h7M8.5 18h4"/>'),
    archive: glyph('<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M12 4.5v4M10.5 8.5h3M12 11.5v2.5"/>'),
    link: glyph('<path d="M10 13.5a3.5 3.5 0 0 0 5 0l2.5-2.5a3.5 3.5 0 0 0-5-5L11 7.5"/><path d="M14 10.5a3.5 3.5 0 0 0-5 0L6.5 13a3.5 3.5 0 0 0 5 5l1.5-1.5"/>'),
    copy: glyph('<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a1 1 0 0 1 1-1h9"/>'),
    check: glyph('<path d="m5 12.5 4.5 4.5L19 7.5"/>'),
    share: glyph('<circle cx="17.5" cy="6" r="2.8"/><circle cx="6.5" cy="12" r="2.8"/><circle cx="17.5" cy="18" r="2.8"/><path d="m9 10.7 6-3.4M9 13.3l6 3.4"/>'),
    external: glyph('<path d="M14 4h6v6"/><path d="m20 4-8.5 8.5"/><path d="M18 14.5V19a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h4.5"/>'),
    download: glyph('<path d="M12 4v11"/><path d="m8 11.5 4 4 4-4"/><path d="M5 19h14"/>'),
    clock: glyph('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 1.8"/>'),
    hash: glyph('<path d="M5.5 9.5h13M5 14.5h13M10 4.5 8.5 19.5M15.5 4.5 14 19.5"/>'),
    eye: glyph('<path d="M2.8 12S6.5 5.8 12 5.8 21.2 12 21.2 12 17.5 18.2 12 18.2 2.8 12 2.8 12Z"/><circle cx="12" cy="12" r="2.8"/>'),
    calendar: glyph('<rect x="3.5" y="5.5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8.5 3.5v4M15.5 3.5v4"/>'),
    scale: glyph('<path d="M4.5 7.5 12 3.5l7.5 4v9L12 20.5l-7.5-4z"/><path d="M4.5 7.5 12 11.6l7.5-4.1M12 11.6v8.9"/>'),
    layers: glyph('<path d="m12 3.5 8.5 4.3L12 12 3.5 7.8z"/><path d="m3.5 12 8.5 4.2 8.5-4.2M3.5 16.2l8.5 4.3 8.5-4.3"/>'),
  };

  const fmtDate = (iso) => {
    if (!iso) return '—';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
  };
  const fmtShortDate = (iso) => {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short' }) +
      ' · ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  };
  const fmtSize = (bytes) => {
    if (typeof bytes !== 'number') return '';
    if (bytes < 1024) return `${bytes} B`;
    const units = ['KB', 'MB', 'GB'];
    let v = bytes / 1024;
    let i = 0;
    while (v >= 1024 && i < units.length - 1) {
      v /= 1024;
      i += 1;
    }
    return `${v.toFixed(1)} ${units[i]}`;
  };
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

  // ── file kinds ───────────────────────────────────────────────
  // Driven by the stored content type, falling back to the extension only when
  // the server had nothing better than a generic octet-stream.
  const kindOf = (file) => {
    const type = (file.type || '').split(';')[0].trim().toLowerCase();
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    if (type.startsWith('image/')) return { icon: 'image', label: 'Imagen', preview: 'image' };
    if (type === 'application/pdf') return { icon: 'pdf', label: 'PDF', preview: 'frame' };
    if (type === 'text/html' || ext === 'html' || ext === 'htm')
      return { icon: 'code', label: 'HTML', preview: 'frame' };
    if (type === 'text/css' || type.includes('javascript') || type === 'application/json' ||
        ['css', 'js', 'mjs', 'json', 'ts'].includes(ext))
      return { icon: 'code', label: ext.toUpperCase() || 'Código', preview: 'frame' };
    if (type.startsWith('text/')) return { icon: 'text', label: ext.toUpperCase() || 'Texto', preview: 'frame' };
    if (['zip', 'gz', 'tar', 'rar', '7z'].includes(ext)) return { icon: 'archive', label: ext.toUpperCase(), preview: null };
    return { icon: 'file', label: ext ? ext.toUpperCase() : 'Archivo', preview: null };
  };

  const files = Array.isArray(drop.files) ? drop.files : [];
  const versions = Array.isArray(drop.versions) ? drop.versions : [];
  const served = versions.find((v) => v.seq === drop.version);
  const entryFile = files.find((f) => f.name === drop.entrypoint);
  const identity = kindOf(entryFile || { name: drop.entrypoint || '', type: 'text/html' });

  const VISIBILITY = {
    public: { label: 'Público', tone: 'ok' },
    unlisted: { label: 'No listado', tone: 'warn' },
    private: { label: 'Privado', tone: 'off' },
  };
  const visibility = VISIBILITY[drop.visibility] || VISIBILITY.public;

  // ── clipboard ────────────────────────────────────────────────
  // The Clipboard API needs a permission this document cannot be granted: a
  // sandbox without `allow-same-origin` is an opaque origin, and opaque origins
  // are refused. execCommand still works from a user gesture, so it is the one
  // that usually lands; the async call is tried first for browsers that allow
  // it, and the selection is left behind so ⌘C works when neither does.
  const copyText = async (text) => {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch {
      // fall through
    }
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none';
    document.body.appendChild(area);
    area.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    document.body.removeChild(area);
    return ok;
  };

  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  };
  const icon = (name, className = 'ic') => {
    const span = el('span', className);
    span.innerHTML = ICON[name] || ICON.file;
    return span;
  };

  const host = document.createElement('div');
  host.setAttribute('data-drop-badge', '');
  const root = host.attachShadow({ mode: 'closed' });

  // The bar is fixed, so the host element stands in for its height at the end
  // of the document. Reserving the space this way keeps the page's own bottom
  // content visible without overriding any of its style rules.
  const BAR_HEIGHT = 30;
  const PANEL_WIDTH = 340;

  const style = document.createElement('style');
  style.textContent = `
    :host { all: initial; display: block; height: ${BAR_HEIGHT}px; }
    * { box-sizing: border-box; }
    .root {
      font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
      --bg: #12121a;
      --bg-soft: #ffffff0f;
      --line: #ffffff1f;
      --fg: #e9e9f0;
      --fg-dim: #9a9ab0;
      --accent: #c4b5ff;
      --accent-solid: #6d4aff;
      --ok: #7ee8c0;
      --warn: #ffd79a;
    }
    .ic { display: inline-grid; place-items: center; flex: none; }
    .ic svg { width: 14px; height: 14px; display: block; }

    /* ── bottom bar ───────────────────────────────────────────── */
    .bar {
      position: fixed; left: 0; right: 0; bottom: 0; height: ${BAR_HEIGHT}px;
      z-index: 2147483646;
      display: flex; align-items: center; justify-content: center; gap: 6px;
      background: #0d0d14f2; border-top: 1px solid var(--line);
      color: var(--fg-dim); font-size: 11.5px; letter-spacing: .01em;
      cursor: pointer; user-select: none;
      backdrop-filter: blur(6px);
    }
    .bar:hover { color: var(--fg); }
    .bar svg { width: 14px; height: 14px; display: block; }
    .bar strong { color: var(--fg); font-weight: 600; }

    /* ── edge toggle ──────────────────────────────────────────── */
    .toggle {
      all: unset; box-sizing: border-box;
      position: fixed; top: 50%; right: 0; transform: translateY(-50%);
      z-index: 2147483647;
      width: 44px; height: 44px; display: grid; place-items: center;
      background: var(--bg); border: 1px solid var(--line); border-right: none;
      border-radius: 12px 0 0 12px;
      cursor: pointer; transition: transform .22s ease, background .15s ease;
    }
    .toggle:hover { background: #1c1c28; }
    .toggle:focus-visible { outline: 2px solid #8b7cf6; outline-offset: -2px; }
    .toggle svg { width: 22px; height: 22px; display: block; }
    .root.open .toggle { transform: translateY(-50%) translateX(-${PANEL_WIDTH}px); }

    /* ── sidebar ──────────────────────────────────────────────── */
    .panel {
      position: fixed; top: 0; right: 0; bottom: 0; width: ${PANEL_WIDTH}px; max-width: 92vw;
      z-index: 2147483647;
      display: flex; flex-direction: column;
      background: var(--bg); color: var(--fg);
      border-left: 1px solid var(--line);
      box-shadow: -16px 0 40px #00000059;
      transform: translateX(100%); transition: transform .22s ease;
    }
    .root.open .panel { transform: translateX(0); }

    .head {
      display: flex; align-items: center; gap: 8px;
      padding: 12px 14px; border-bottom: 1px solid var(--line); flex: none;
    }
    .head > span:first-child svg { width: 18px; height: 18px; display: block; }
    .head .word { font-size: 13px; font-weight: 600; letter-spacing: .02em; }
    .close {
      all: unset; margin-left: auto; cursor: pointer;
      width: 26px; height: 26px; display: grid; place-items: center;
      border-radius: 6px; color: var(--fg-dim); font-size: 16px; line-height: 1;
    }
    .close:hover { background: var(--bg-soft); color: var(--fg); }
    .close:focus-visible { outline: 2px solid #8b7cf6; }

    /* ── identity ─────────────────────────────────────────────── */
    .ident { padding: 14px 14px 10px; flex: none; }
    .ident .top { display: flex; align-items: flex-start; gap: 10px; }
    .mark {
      width: 34px; height: 34px; flex: none; display: grid; place-items: center;
      border-radius: 9px; background: #6d4aff26; border: 1px solid #8b7cf64d;
      color: var(--accent);
    }
    .mark svg { width: 18px; height: 18px; }
    .title { margin: 0; font-size: 14.5px; font-weight: 600; line-height: 1.3; word-break: break-word; }
    .open-ext {
      all: unset; cursor: pointer; flex: none; margin-left: auto;
      width: 26px; height: 26px; display: grid; place-items: center;
      border-radius: 6px; color: var(--fg-dim);
    }
    .open-ext:hover { background: var(--bg-soft); color: var(--fg); }
    .open-ext:focus-visible { outline: 2px solid #8b7cf6; }
    .badges { display: flex; flex-wrap: wrap; gap: 6px; margin: 9px 0 0; }
    .badge {
      font-size: 10.5px; padding: 2px 8px; border-radius: 999px;
      background: var(--bg-soft); color: #cfcfe0; border: 1px solid #ffffff14;
    }
    .badge.version { background: #6d4aff2e; color: var(--accent); border-color: #8b7cf64d; }
    .badge.pinned { background: #f5a52333; color: var(--warn); border-color: #f5a5234d; }

    .notice {
      margin: 10px 0 0; padding: 8px 10px; border-radius: 8px;
      background: #f5a5231f; border: 1px solid #f5a5233d;
      font-size: 11.5px; line-height: 1.45; color: var(--warn);
    }
    .notice a { color: #ffe8c2; }

    /* ── tabs ─────────────────────────────────────────────────── */
    .tabs {
      display: flex; gap: 2px; padding: 0 10px; flex: none;
      border-bottom: 1px solid var(--line);
    }
    .tab {
      all: unset; cursor: pointer; flex: 1 1 0;
      display: flex; align-items: center; justify-content: center; gap: 5px;
      padding: 8px 4px; font-size: 11.5px; color: var(--fg-dim);
      border-bottom: 2px solid transparent; margin-bottom: -1px;
      white-space: nowrap;
    }
    .tab:hover { color: var(--fg); }
    .tab[aria-selected="true"] { color: var(--fg); border-bottom-color: var(--accent-solid); }
    .tab:focus-visible { outline: 2px solid #8b7cf6; outline-offset: -2px; border-radius: 4px; }
    .tab .ic svg { width: 13px; height: 13px; }

    .body { padding: 14px; overflow-y: auto; flex: 1 1 auto; }
    [role="tabpanel"][hidden] { display: none; }

    section { margin: 16px 0 0; }
    section:first-child { margin-top: 0; }
    h3 {
      margin: 0 0 8px; font-size: 10.5px; font-weight: 600; color: var(--fg-dim);
      text-transform: uppercase; letter-spacing: .06em;
      display: flex; align-items: baseline; gap: 8px;
    }
    h3 .more { all: unset; cursor: pointer; margin-left: auto; color: var(--accent); text-transform: none; letter-spacing: 0; font-size: 11px; }
    h3 .more:hover { text-decoration: underline; }
    h3 .more:focus-visible { outline: 2px solid #8b7cf6; border-radius: 4px; }

    /* ── info rows ────────────────────────────────────────────── */
    .rows { display: flex; flex-direction: column; }
    .row {
      display: flex; align-items: center; gap: 8px; min-height: 30px;
      font-size: 11.5px; padding: 3px 0; border-bottom: 1px solid #ffffff0a;
    }
    .row:last-child { border-bottom: none; }
    .row .ic { color: var(--fg-dim); }
    .row .k { color: var(--fg-dim); }
    .row .v { margin-left: auto; text-align: right; word-break: break-word; min-width: 0; }
    .row .v code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; }
    .row .v.trunc { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .dot { width: 7px; height: 7px; border-radius: 999px; display: inline-block; margin-right: 5px; vertical-align: 1px; }
    .dot.ok { background: var(--ok); }
    .dot.warn { background: var(--warn); }
    .dot.off { background: var(--fg-dim); }
    .mini {
      all: unset; cursor: pointer; flex: none; width: 22px; height: 22px;
      display: grid; place-items: center; border-radius: 5px; color: var(--fg-dim);
    }
    .mini:hover { background: var(--bg-soft); color: var(--fg); }
    .mini:focus-visible { outline: 2px solid #8b7cf6; }
    .mini.done { color: var(--ok); }
    .mini .ic svg { width: 13px; height: 13px; }

    /* ── preview ──────────────────────────────────────────────── */
    .preview {
      border: 1px solid var(--line); border-radius: 10px; overflow: hidden;
      background: #ffffff08;
    }
    .shot { position: relative; height: 148px; overflow: hidden; background: #ffffff05; }
    .shot iframe, .shot img {
      position: absolute; top: 0; left: 0; border: 0; display: block;
    }
    /* A page is authored for a full viewport, so it is rendered at one and
       scaled down — laying it out at 340px would show the mobile breakpoint,
       which is not what the drop serves. */
    .shot iframe {
      width: 1280px; height: 800px;
      transform: scale(.265); transform-origin: top left;
      pointer-events: none;
    }
    .shot img { width: 100%; height: 100%; object-fit: contain; }
    .shot.empty { display: grid; place-items: center; color: var(--fg-dim); font-size: 11.5px; height: 90px; }
    .preview .act {
      all: unset; box-sizing: border-box; cursor: pointer; display: flex;
      align-items: center; justify-content: center; gap: 6px; width: 100%;
      padding: 8px; font-size: 11.5px; color: var(--fg);
      border-top: 1px solid var(--line); background: var(--bg-soft);
    }
    .preview .act:hover { background: #6d4aff26; color: var(--accent); }
    .preview .act:focus-visible { outline: 2px solid #8b7cf6; outline-offset: -2px; }

    /* ── files ────────────────────────────────────────────────── */
    ul { margin: 0; padding: 0; list-style: none; }
    .files li { display: flex; align-items: center; gap: 8px; font-size: 11.5px; padding: 5px 0; }
    .files .ic { color: var(--fg-dim); }
    .files a { color: var(--fg); text-decoration: none; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
    .files a:hover { color: var(--accent); text-decoration: underline; }
    .files .entry { font-size: 9.5px; text-transform: uppercase; letter-spacing: .05em; color: var(--ok); flex: none; }
    .files .size { margin-left: auto; color: var(--fg-dim); white-space: nowrap; flex: none; }

    /* ── versions ─────────────────────────────────────────────── */
    .versions li { margin: 0 0 4px; }
    .versions a {
      display: block; padding: 7px 9px; border-radius: 8px; text-decoration: none;
      background: var(--bg-soft); border: 1px solid transparent; color: var(--fg);
    }
    .versions a:hover { border-color: #8b7cf64d; background: #6d4aff1f; }
    .versions a[aria-current="true"] { border-color: #8b7cf666; background: #6d4aff26; }
    /* Two lines rather than one: the date and the file count together overflow
       the sidebar's width and wrap mid-label. */
    .versions .line { display: flex; align-items: baseline; gap: 8px; }
    .versions .seq { font-size: 12px; font-weight: 600; color: var(--accent); }
    .versions .when { font-size: 11px; color: var(--fg-dim); }
    .versions .meta { margin-left: auto; font-size: 10.5px; color: var(--fg-dim); white-space: nowrap; }
    .versions .now {
      margin-left: auto; font-size: 9.5px; text-transform: uppercase;
      letter-spacing: .06em; color: var(--ok);
    }

    /* ── footer actions ───────────────────────────────────────── */
    .foot {
      flex: none; display: flex; gap: 8px; padding: 10px 14px;
      border-top: 1px solid var(--line); background: #0d0d1480;
    }
    .btn {
      all: unset; box-sizing: border-box; cursor: pointer; flex: 1 1 0;
      display: flex; align-items: center; justify-content: center; gap: 6px;
      height: 32px; border-radius: 8px; font-size: 11.5px; font-weight: 600;
    }
    .btn.primary { background: var(--accent-solid); color: #fff; }
    .btn.primary:hover { background: #7c5cff; }
    .btn.ghost { background: var(--bg-soft); color: var(--fg); border: 1px solid var(--line); }
    .btn.ghost:hover { background: #ffffff1a; }
    .btn:focus-visible { outline: 2px solid #8b7cf6; outline-offset: 2px; }
    .btn .ic svg { width: 13px; height: 13px; }

    .empty { font-size: 11.5px; color: var(--fg-dim); }

    @media (prefers-reduced-motion: reduce) {
      .panel, .toggle { transition: none; }
    }
    @media (max-width: 480px) {
      .root.open .toggle { transform: translateY(-50%) translateX(-92vw); }
    }
  `;

  const wrapper = el('div', 'root');

  // ── sidebar ──────────────────────────────────────────────────
  const panel = el('aside', 'panel');
  panel.setAttribute('aria-label', 'Detalles del drop');

  const head = el('div', 'head');
  const headMark = el('span');
  headMark.innerHTML = MARK;
  head.appendChild(headMark);
  head.appendChild(el('span', 'word', 'Drop'));
  const close = el('button', 'close', '✕');
  close.type = 'button';
  close.setAttribute('aria-label', 'Cerrar');
  head.appendChild(close);
  panel.appendChild(head);

  // ── identity ─────────────────────────────────────────────────
  const ident = el('div', 'ident');
  const identTop = el('div', 'top');
  identTop.appendChild(icon(identity.icon, 'mark'));

  const identText = el('div');
  identText.appendChild(el('h1', 'title', drop.title || drop.slug));
  identTop.appendChild(identText);

  if (drop.url) {
    const openExt = el('a', 'open-ext');
    openExt.href = drop.url;
    openExt.target = '_blank';
    openExt.rel = 'noreferrer';
    openExt.setAttribute('aria-label', 'Abrir el drop en una pestaña nueva');
    openExt.appendChild(icon('external'));
    identTop.appendChild(openExt);
  }
  ident.appendChild(identTop);

  const badges = el('div', 'badges');
  badges.appendChild(el('span', 'badge version', `v${drop.version ?? 1}`));
  badges.appendChild(el('span', 'badge', visibility.label.toLowerCase()));
  badges.appendChild(el('span', 'badge', identity.label));
  if (drop.pinned) badges.appendChild(el('span', 'badge pinned', 'versión anclada'));
  ident.appendChild(badges);

  // Viewing an old snapshot is easy to do by accident from a shared link, so
  // say so and offer the way back to what is published now.
  if (drop.pinned && drop.url) {
    const notice = el('div', 'notice');
    notice.appendChild(document.createTextNode(
      `Estás viendo la versión ${drop.version} de este drop. La actual es la ${drop.current}: `));
    const latest = el('a', null, 'ver la última');
    latest.href = drop.url;
    notice.appendChild(latest);
    notice.appendChild(document.createTextNode('.'));
    ident.appendChild(notice);
  }
  panel.appendChild(ident);

  // ── tabs ─────────────────────────────────────────────────────
  const TABS = [
    { id: 'details', label: 'Detalles', icon: 'file' },
    { id: 'history', label: 'Historial', icon: 'clock' },
    { id: 'files', label: 'Archivos', icon: 'layers' },
  ];
  const tablist = el('div', 'tabs');
  tablist.setAttribute('role', 'tablist');
  tablist.setAttribute('aria-label', 'Secciones del drop');

  const body = el('div', 'body');
  const tabButtons = new Map();
  const tabPanels = new Map();

  for (const tab of TABS) {
    const button = el('button', 'tab');
    button.type = 'button';
    button.id = `drop-tab-${tab.id}`;
    button.setAttribute('role', 'tab');
    button.setAttribute('aria-controls', `drop-panel-${tab.id}`);
    button.appendChild(icon(tab.icon));
    button.appendChild(el('span', null, tab.label));
    tablist.appendChild(button);
    tabButtons.set(tab.id, button);

    const region = el('div');
    region.id = `drop-panel-${tab.id}`;
    region.setAttribute('role', 'tabpanel');
    region.setAttribute('aria-labelledby', button.id);
    region.tabIndex = 0;
    body.appendChild(region);
    tabPanels.set(tab.id, region);
  }
  panel.appendChild(tablist);

  const selectTab = (id) => {
    for (const tab of TABS) {
      const selected = tab.id === id;
      tabButtons.get(tab.id).setAttribute('aria-selected', String(selected));
      // Only the selected tab stays in the tab order; the rest are reached with
      // the arrow keys, which is what a tablist is supposed to do.
      tabButtons.get(tab.id).tabIndex = selected ? 0 : -1;
      tabPanels.get(tab.id).hidden = !selected;
    }
    body.scrollTop = 0;
  };
  tablist.addEventListener('click', (event) => {
    for (const [id, button] of tabButtons) if (button.contains(event.target)) selectTab(id);
  });
  tablist.addEventListener('keydown', (event) => {
    const order = TABS.map((t) => t.id);
    const current = order.findIndex((id) => tabButtons.get(id).getAttribute('aria-selected') === 'true');
    let next = -1;
    if (event.key === 'ArrowRight') next = (current + 1) % order.length;
    else if (event.key === 'ArrowLeft') next = (current - 1 + order.length) % order.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = order.length - 1;
    if (next < 0) return;
    event.preventDefault();
    selectTab(order[next]);
    tabButtons.get(order[next]).focus();
  });

  // ── copy control, shared by the link row and the footer ──────
  const copyControl = (node, doneLabel) => {
    let timer = 0;
    return async () => {
      const ok = await copyText(drop.url);
      node.innerHTML = '';
      node.appendChild(icon(ok ? 'check' : 'copy'));
      if (doneLabel) node.appendChild(el('span', null, ok ? doneLabel : 'No se pudo copiar'));
      node.classList.toggle('done', ok);
      clearTimeout(timer);
      timer = setTimeout(() => {
        node.innerHTML = '';
        node.appendChild(icon('copy'));
        if (doneLabel) node.appendChild(el('span', null, 'Copiar enlace'));
        node.classList.remove('done');
      }, 1600);
    };
  };

  // ── details tab ──────────────────────────────────────────────
  const details = tabPanels.get('details');

  const infoSection = el('section');
  infoSection.appendChild(el('h3', null, 'Información general'));
  const rows = el('div', 'rows');

  const addRow = (glyphName, key, build) => {
    const row = el('div', 'row');
    row.appendChild(icon(glyphName));
    row.appendChild(el('span', 'k', key));
    const value = el('span', 'v');
    build(value, row);
    row.appendChild(value);
    rows.appendChild(row);
    return row;
  };

  addRow('hash', 'Slug', (v) => v.appendChild(el('code', null, drop.slug)));

  if (drop.url) {
    const row = addRow('link', 'Enlace', (v) => {
      v.className = 'v trunc';
      const link = el('a', null, drop.url.replace(/^https?:\/\//, ''));
      link.href = drop.url;
      link.target = '_blank';
      link.rel = 'noreferrer';
      link.style.color = 'inherit';
      link.title = drop.url;
      v.appendChild(link);
    });
    const copyBtn = el('button', 'mini');
    copyBtn.type = 'button';
    copyBtn.setAttribute('aria-label', 'Copiar el enlace del drop');
    copyBtn.appendChild(icon('copy'));
    copyBtn.addEventListener('click', copyControl(copyBtn, null));
    row.appendChild(copyBtn);
  }

  addRow('eye', 'Visibilidad', (v) => {
    v.appendChild(el('span', `dot ${visibility.tone}`));
    v.appendChild(document.createTextNode(visibility.label));
  });
  addRow('file', 'Entrypoint', (v) => v.appendChild(el('code', null, drop.entrypoint || '—')));
  addRow('calendar', 'Publicado', (v) => { v.textContent = fmtDate(drop.created_at); });
  addRow('clock', 'Actualizado', (v) => { v.textContent = fmtDate(drop.updated_at); });
  if (served) addRow('scale', 'Tamaño', (v) => { v.textContent = fmtSize(served.size); });
  addRow('layers', 'Tipo', (v) => { v.textContent = identity.label; });

  infoSection.appendChild(rows);
  details.appendChild(infoSection);

  // Preview of what the drop actually serves — its entrypoint, which is not
  // necessarily the page this badge is on.
  if (drop.url && entryFile) {
    const previewSection = el('section');
    previewSection.appendChild(el('h3', null, 'Vista previa'));
    const preview = el('div', 'preview');
    const shot = el('div', 'shot');

    if (identity.preview === 'image') {
      const img = document.createElement('img');
      img.src = drop.entrypoint;
      img.alt = '';
      img.loading = 'lazy';
      shot.appendChild(img);
    } else if (identity.preview === 'frame') {
      const frame = document.createElement('iframe');
      frame.src = drop.entrypoint;
      frame.loading = 'lazy';
      frame.setAttribute('aria-hidden', 'true');
      frame.setAttribute('tabindex', '-1');
      frame.setAttribute('scrolling', 'no');
      shot.appendChild(frame);
    } else {
      shot.className = 'shot empty';
      shot.textContent = 'Sin vista previa para este tipo';
    }
    preview.appendChild(shot);

    const openPreview = el('a', 'act');
    openPreview.href = drop.url;
    openPreview.target = '_blank';
    openPreview.rel = 'noreferrer';
    openPreview.appendChild(icon('external'));
    openPreview.appendChild(el('span', null, 'Abrir vista previa'));
    preview.appendChild(openPreview);

    previewSection.appendChild(preview);
    details.appendChild(previewSection);
  }

  // A peek at the history, with the way through to all of it.
  if (versions.length > 0) {
    const recent = el('section', 'versions');
    const heading = el('h3', null, 'Historial de versiones');
    if (versions.length > 2) {
      const more = el('button', 'more', 'Ver todas');
      more.type = 'button';
      more.addEventListener('click', () => {
        selectTab('history');
        tabButtons.get('history').focus();
      });
      heading.appendChild(more);
    }
    recent.appendChild(heading);
    recent.appendChild(versionList(versions.slice(0, 2)));
    details.appendChild(recent);
  }

  // ── history tab ──────────────────────────────────────────────
  const history = tabPanels.get('history');
  const historySection = el('section', 'versions');
  historySection.appendChild(el('h3', null, plural(versions.length, 'versión', 'versiones')));
  if (versions.length > 0) historySection.appendChild(versionList(versions));
  else historySection.appendChild(el('p', 'empty', 'Todavía no hay versiones publicadas.'));
  history.appendChild(historySection);

  // ── files tab ────────────────────────────────────────────────
  const filesPanel = tabPanels.get('files');
  const filesSection = el('section', 'files');
  filesSection.appendChild(el('h3', null, plural(files.length, 'archivo', 'archivos')));
  if (files.length > 0) {
    const list = el('ul');
    for (const file of files) {
      const kind = kindOf(file);
      const li = el('li');
      li.appendChild(icon(kind.icon));
      // Relative to the version root, which is where this page is served from,
      // so the link stays inside the snapshot being viewed.
      const link = el('a', null, file.name);
      link.href = file.name;
      link.title = `${file.name} · ${kind.label}`;
      li.appendChild(link);
      if (file.name === drop.entrypoint) li.appendChild(el('span', 'entry', 'entrypoint'));
      li.appendChild(el('span', 'size', fmtSize(file.size)));

      const dl = el('a', 'mini');
      dl.href = file.name;
      dl.setAttribute('download', file.name);
      dl.setAttribute('aria-label', `Descargar ${file.name}`);
      dl.appendChild(icon('download'));
      li.appendChild(dl);

      list.appendChild(li);
    }
    filesSection.appendChild(list);
  } else {
    filesSection.appendChild(el('p', 'empty', 'Este drop no sirve ningún archivo todavía.'));
  }
  filesPanel.appendChild(filesSection);

  panel.appendChild(body);

  // ── footer actions ───────────────────────────────────────────
  // Read-only on purpose. This badge runs on the published page, for whoever
  // opened it: there is no session here and no way to reach the API, so
  // sharing and copying are the only actions that mean anything. Editing,
  // cloning and deleting live in the admin, behind an account.
  if (drop.url) {
    const foot = el('div', 'foot');

    const shareBtn = el('button', 'btn primary');
    shareBtn.type = 'button';
    shareBtn.appendChild(icon('share'));
    shareBtn.appendChild(el('span', null, 'Compartir'));
    shareBtn.addEventListener('click', async () => {
      if (navigator.share) {
        try {
          await navigator.share({ title: drop.title || drop.slug, url: drop.url });
          return;
        } catch {
          // Dismissed, or unavailable in this context — fall back to copying.
        }
      }
      const ok = await copyText(drop.url);
      shareBtn.innerHTML = '';
      shareBtn.appendChild(icon(ok ? 'check' : 'share'));
      shareBtn.appendChild(el('span', null, ok ? 'Enlace copiado' : 'No se pudo copiar'));
      setTimeout(() => {
        shareBtn.innerHTML = '';
        shareBtn.appendChild(icon('share'));
        shareBtn.appendChild(el('span', null, 'Compartir'));
      }, 1600);
    });
    foot.appendChild(shareBtn);

    const copyBtn = el('button', 'btn ghost');
    copyBtn.type = 'button';
    copyBtn.appendChild(icon('copy'));
    copyBtn.appendChild(el('span', null, 'Copiar enlace'));
    copyBtn.addEventListener('click', copyControl(copyBtn, 'Enlace copiado'));
    foot.appendChild(copyBtn);

    panel.appendChild(foot);
  }

  selectTab('details');

  function versionList(items) {
    const list = el('ul');
    for (const version of items) {
      const li = el('li');
      const link = el('a');
      link.href = version.url;
      if (version.seq === drop.version) link.setAttribute('aria-current', 'true');

      const top = el('div', 'line');
      top.appendChild(el('span', 'seq', `v${version.seq}`));
      if (version.current) top.appendChild(el('span', 'now', 'actual'));
      link.appendChild(top);

      const bottom = el('div', 'line');
      bottom.appendChild(el('span', 'when', fmtShortDate(version.published_at)));
      bottom.appendChild(el('span', 'meta',
        `${plural(version.files, 'archivo', 'archivos')} · ${fmtSize(version.size)}`));
      link.appendChild(bottom);

      li.appendChild(link);
      list.appendChild(li);
    }
    return list;
  }

  // ── edge toggle ──────────────────────────────────────────────
  const toggle = el('button', 'toggle');
  toggle.type = 'button';
  toggle.setAttribute('aria-label', 'Detalles del drop');
  toggle.setAttribute('aria-expanded', 'false');
  toggle.innerHTML = MARK;

  // ── bottom bar ───────────────────────────────────────────────
  const bar = el('div', 'bar');
  bar.setAttribute('role', 'button');
  bar.setAttribute('tabindex', '0');
  bar.setAttribute('aria-label', 'powered by Drop — ver detalles');
  const barMark = el('span');
  barMark.innerHTML = MARK;
  bar.appendChild(barMark);
  bar.appendChild(document.createTextNode('powered by '));
  bar.appendChild(el('strong', null, 'drop'));

  let open = false;
  const setOpen = (next) => {
    open = next;
    wrapper.classList.toggle('open', open);
    toggle.setAttribute('aria-expanded', String(open));
    if (open) close.focus();
  };
  toggle.addEventListener('click', () => setOpen(!open));
  close.addEventListener('click', () => setOpen(false));
  bar.addEventListener('click', () => setOpen(!open));
  bar.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setOpen(!open);
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && open) setOpen(false);
  });

  wrapper.appendChild(bar);
  wrapper.appendChild(panel);
  wrapper.appendChild(toggle);
  root.appendChild(style);
  root.appendChild(wrapper);

  const mount = () => document.body && document.body.appendChild(host);
  if (document.body) mount();
  else document.addEventListener('DOMContentLoaded', mount, { once: true });
})();
