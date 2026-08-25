// Drop badge injected into published pages: a bar pinned to the bottom of the
// document and a sidebar with the drop's details and version history.
//
// Everything lives in a shadow root so the host page's CSS cannot reach it and
// its own styles cannot leak out. The drop's metadata is inlined by the server
// rather than fetched: published pages run under `CSP: sandbox`, in an opaque
// origin, so a call back to the API would be cross-origin and blocked.
(() => {
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

  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  };

  const host = document.createElement('div');
  host.setAttribute('data-drop-badge', '');
  const root = host.attachShadow({ mode: 'closed' });

  // The bar is fixed, so the host element stands in for its height at the end
  // of the document. Reserving the space this way keeps the page's own bottom
  // content visible without overriding any of its style rules.
  const BAR_HEIGHT = 30;

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
    }

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
    .root.open .toggle { transform: translateY(-50%) translateX(-320px); }

    /* ── sidebar ──────────────────────────────────────────────── */
    .panel {
      position: fixed; top: 0; right: 0; bottom: 0; width: 320px; max-width: 88vw;
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
    .head svg { width: 18px; height: 18px; display: block; }
    .head .word { font-size: 13px; font-weight: 600; letter-spacing: .02em; }
    .close {
      all: unset; margin-left: auto; cursor: pointer;
      width: 26px; height: 26px; display: grid; place-items: center;
      border-radius: 6px; color: var(--fg-dim); font-size: 16px; line-height: 1;
    }
    .close:hover { background: var(--bg-soft); color: var(--fg); }
    .close:focus-visible { outline: 2px solid #8b7cf6; }

    .body { padding: 14px; overflow-y: auto; flex: 1 1 auto; }

    .title { margin: 0; font-size: 15px; font-weight: 600; line-height: 1.35; word-break: break-word; }
    .badges { display: flex; flex-wrap: wrap; gap: 6px; margin: 10px 0 0; }
    .badge {
      font-size: 11px; padding: 2px 8px; border-radius: 999px;
      background: var(--bg-soft); color: #cfcfe0; border: 1px solid #ffffff14;
    }
    .badge.version { background: #6d4aff2e; color: var(--accent); border-color: #8b7cf64d; }
    .badge.pinned { background: #f5a52333; color: #ffd79a; border-color: #f5a5234d; }

    .notice {
      margin: 12px 0 0; padding: 8px 10px; border-radius: 8px;
      background: #f5a5231f; border: 1px solid #f5a5233d;
      font-size: 11.5px; line-height: 1.45; color: #ffd79a;
    }
    .notice a { color: #ffe8c2; }

    section { margin: 16px 0 0; padding: 14px 0 0; border-top: 1px solid #ffffff14; }
    section:first-of-type { border-top: none; padding-top: 0; }
    h3 {
      margin: 0 0 8px; font-size: 10.5px; font-weight: 600; color: var(--fg-dim);
      text-transform: uppercase; letter-spacing: .06em;
    }

    dl { margin: 0; display: grid; grid-template-columns: auto 1fr; gap: 5px 12px; font-size: 11.5px; }
    dt { color: var(--fg-dim); }
    dd { margin: 0; text-align: right; word-break: break-word; }
    dd code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; }

    ul { margin: 0; padding: 0; list-style: none; }
    .files li { display: flex; justify-content: space-between; gap: 8px; font-size: 11.5px; padding: 3px 0; }
    .files a { color: var(--accent); text-decoration: none; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .files a:hover { text-decoration: underline; }
    .files .size { color: var(--fg-dim); white-space: nowrap; }

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
      letter-spacing: .06em; color: #7ee8c0;
    }

    @media (prefers-reduced-motion: reduce) {
      .panel, .toggle { transition: none; }
    }
    @media (max-width: 480px) {
      .root.open .toggle { transform: translateY(-50%) translateX(-88vw); }
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

  const body = el('div', 'body');

  const identity = el('section');
  identity.appendChild(el('h1', 'title', drop.title || drop.slug));

  const badges = el('div', 'badges');
  badges.appendChild(el('span', 'badge version', `v${drop.version ?? 1}`));
  badges.appendChild(el('span', 'badge', drop.visibility || 'public'));
  if (drop.pinned) badges.appendChild(el('span', 'badge pinned', 'versión anclada'));
  identity.appendChild(badges);

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
    identity.appendChild(notice);
  }
  body.appendChild(identity);

  const details = el('section');
  details.appendChild(el('h3', null, 'Detalles'));
  const dl = el('dl');
  const rows = [
    ['Slug', drop.slug, true],
    ['Entrypoint', drop.entrypoint, true],
    ['Publicado', fmtDate(drop.created_at), false],
    ['Actualizado', fmtDate(drop.updated_at), false],
  ];
  for (const [label, value, mono] of rows) {
    if (!value) continue;
    dl.appendChild(el('dt', null, label));
    const dd = el('dd');
    if (mono) dd.appendChild(el('code', null, value));
    else dd.textContent = value;
    dl.appendChild(dd);
  }
  details.appendChild(dl);
  body.appendChild(details);

  if (Array.isArray(drop.files) && drop.files.length > 0) {
    const files = el('section', 'files');
    files.appendChild(el('h3', null,
      `${drop.files.length} archivo${drop.files.length === 1 ? '' : 's'}`));
    const list = el('ul');
    for (const file of drop.files) {
      const li = el('li');
      const link = el('a', null, file.name);
      // Relative to the version root, which is where this page is served from,
      // so the link stays inside the snapshot being viewed.
      link.href = file.name;
      link.title = file.name;
      li.appendChild(link);
      li.appendChild(el('span', 'size', fmtSize(file.size)));
      list.appendChild(li);
    }
    files.appendChild(list);
    body.appendChild(files);
  }

  if (Array.isArray(drop.versions) && drop.versions.length > 0) {
    const history = el('section', 'versions');
    history.appendChild(el('h3', null, 'Historial de versiones'));
    const list = el('ul');
    for (const version of drop.versions) {
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
        `${version.files} archivo${version.files === 1 ? '' : 's'} · ${fmtSize(version.size)}`));
      link.appendChild(bottom);

      li.appendChild(link);
      list.appendChild(li);
    }
    history.appendChild(list);
    body.appendChild(history);
  }

  panel.appendChild(body);

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
