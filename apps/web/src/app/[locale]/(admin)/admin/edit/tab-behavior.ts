// Pure, framework-free reimplementation of the Tab-key handling from the old
// Go admin's static/admin.js (api/internal/adminui/static/admin.js, the
// "---------- editor ----------" section at the bottom): Tab inserts a
// literal tab character at the cursor instead of moving focus to the next
// element, UNLESS Escape was pressed immediately before — Escape arms a
// one-shot bypass so the very next Tab moves focus normally. That keeps the
// textarea from ever being a real keyboard trap.
//
// Kept as a plain function (no DOM, no React) so it can be unit tested
// directly instead of having to simulate real keyboard events through
// happy-dom.

export interface TabKeyDownInput {
  key: string;
  value: string;
  selectionStart: number;
  selectionEnd: number;
}

export interface TabKeyDownResult {
  // Next value of the one-shot "Escape was just pressed" flag.
  escaped: boolean;
  // Whether the caller should preventDefault() and apply value/selection.
  handled: boolean;
  value?: string;
  selectionStart?: number;
  selectionEnd?: number;
}

export function computeTabKeyDown(input: TabKeyDownInput, escaped: boolean): TabKeyDownResult {
  if (input.key === "Escape") {
    return { escaped: true, handled: false };
  }
  if (input.key !== "Tab" || escaped) {
    return { escaped: false, handled: false };
  }

  const { value, selectionStart: start, selectionEnd: end } = input;
  const nextValue = value.slice(0, start) + "\t" + value.slice(end);
  return {
    escaped: false,
    handled: true,
    value: nextValue,
    selectionStart: start + 1,
    selectionEnd: start + 1,
  };
}
