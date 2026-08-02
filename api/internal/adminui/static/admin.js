// Progressive enhancement for the admin. Every mutation is a real form POST
// that works on its own; this only adds the dialogs, the theme switch and the
// editor's tab handling on top.
(() => {
  'use strict';

  /* ---------- theme ---------- */

  const THEME_KEY = 'drop-theme';

  document.querySelectorAll('[data-theme-toggle]').forEach((button) => {
    button.addEventListener('click', () => {
      const dark = document.documentElement.classList.toggle('dark');
      localStorage.setItem(THEME_KEY, dark ? 'dark' : 'light');
      syncThemeIcon();
    });
  });

  function syncThemeIcon() {
    const dark = document.documentElement.classList.contains('dark');
    document.querySelectorAll('[data-theme-icon]').forEach((el) => {
      el.hidden = el.dataset.themeIcon !== (dark ? 'dark' : 'light');
    });
  }
  syncThemeIcon();

  /* ---------- password visibility ---------- */

  document.querySelectorAll('[data-toggle-password]').forEach((button) => {
    const input = document.getElementById(button.dataset.togglePassword);
    if (!input) return;
    button.addEventListener('click', () => {
      const showing = input.type === 'text';
      input.type = showing ? 'password' : 'text';
      button.setAttribute('aria-label', showing ? 'Mostrar contraseña' : 'Ocultar contraseña');
      button.querySelectorAll('[data-password-icon]').forEach((el) => {
        el.hidden = el.dataset.passwordIcon !== (showing ? 'show' : 'hide');
      });
    });
  });

  /* ---------- dialogs ---------- */

  document.querySelectorAll('[data-open]').forEach((button) => {
    button.addEventListener('click', () => {
      document.getElementById(button.dataset.open)?.showModal();
    });
  });

  document.querySelectorAll('[data-close]').forEach((button) => {
    button.addEventListener('click', () => button.closest('dialog')?.close());
  });

  /* ---------- confirmations ---------- */

  // A destructive action is an ordinary form; the dialog is interposed in front
  // of its submit. With scripting off the form still posts — losing the
  // confirmation step, not the ability to act.
  const confirmDialog = document.getElementById('confirm-dialog');
  if (confirmDialog) {
    const titleEl = confirmDialog.querySelector('[data-confirm-title]');
    const textEl = confirmDialog.querySelector('[data-confirm-text]');
    const okEl = confirmDialog.querySelector('[data-confirm-ok]');
    let pending = null;
    let confirmed = null;

    document.querySelectorAll('form[data-confirm-title]').forEach((form) => {
      form.addEventListener('submit', (event) => {
        if (form === confirmed) {
          confirmed = null;
          return;
        }
        event.preventDefault();
        pending = form;
        titleEl.textContent = form.dataset.confirmTitle;
        textEl.textContent = form.dataset.confirmText || '';
        okEl.textContent = form.dataset.confirmLabel || 'Eliminar';
        // Restoring a version deletes nothing, so it must not look like it does.
        okEl.className = form.dataset.confirmVariant === 'default' ? 'btn' : 'btn btn-destructive';
        confirmDialog.showModal();
      });
    });

    okEl.addEventListener('click', () => {
      confirmed = pending;
      confirmDialog.close();
      confirmed?.requestSubmit();
    });

    // Cancelling has to clear the pending form, or the next submit of that same
    // form would find it still armed and go through unconfirmed.
    confirmDialog.addEventListener('close', () => {
      pending = null;
    });
  }

  /* ---------- copy to clipboard ---------- */

  // Two callers: the invitation link, shown once and never again, which lives
  // in a field the button copies from; and a drop's address, which the button
  // carries itself in data-copy.
  document.querySelectorAll('[data-copy]').forEach((button) => {
    const source = document.querySelector('[data-copy-source]');
    button.addEventListener('click', async () => {
      const text = button.dataset.copy || source?.value;
      if (!text) return;
      // Selecting leaves Cmd-C as the way out if the copy itself fails.
      source?.select();
      if (await copyText(text)) markCopied(button);
    });
  });

  async function copyText(text) {
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch {
        // Denied or unavailable — fall through to the old way.
      }
    }
    // The clipboard API needs a secure context, which plain HTTP on anything
    // but localhost is not. This still works there.
    const scratch = document.createElement('textarea');
    scratch.value = text;
    scratch.setAttribute('readonly', '');
    scratch.style.position = 'fixed';
    scratch.style.opacity = '0';
    document.body.appendChild(scratch);
    scratch.select();
    let copied = false;
    try {
      copied = document.execCommand('copy');
    } catch {
      copied = false;
    }
    scratch.remove();
    return copied;
  }

  // An icon button says it worked by swapping the icon; a text one by swapping
  // its label. Writing over textContent would take the SVG with it.
  function markCopied(button) {
    const done = button.querySelector('[data-copy-done]');
    if (done) {
      const idle = button.querySelector('[data-copy-idle]');
      done.hidden = false;
      if (idle) idle.hidden = true;
      setTimeout(() => {
        done.hidden = true;
        if (idle) idle.hidden = false;
      }, 1500);
      return;
    }
    const original = button.textContent;
    button.textContent = 'Copiado';
    setTimeout(() => { button.textContent = original; }, 1500);
  }

  /* ---------- flash ---------- */

  const flash = document.querySelector('.flash');
  if (flash) {
    setTimeout(() => flash.remove(), 4000);
  }

  /* ---------- editor ---------- */

  // Insert a tab instead of leaving the field. Escape first restores tab's
  // normal behaviour, so the textarea is never a keyboard trap.
  const editor = document.querySelector('.editor textarea');
  if (editor) {
    let escaped = false;
    editor.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        escaped = true;
        return;
      }
      if (event.key !== 'Tab' || escaped) {
        escaped = false;
        return;
      }
      event.preventDefault();
      const { selectionStart: start, selectionEnd: end, value } = editor;
      editor.value = value.slice(0, start) + '\t' + value.slice(end);
      editor.selectionStart = editor.selectionEnd = start + 1;
    });
  }
})();
