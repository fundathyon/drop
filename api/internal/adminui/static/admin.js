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
