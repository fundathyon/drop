import { describe, expect, test } from "bun:test";
import { computeTabKeyDown } from "../tab-behavior";

describe("computeTabKeyDown", () => {
  test("inserts a tab character at the cursor and moves it past the insert", () => {
    const result = computeTabKeyDown(
      { key: "Tab", value: "helloworld", selectionStart: 5, selectionEnd: 5 },
      false
    );
    expect(result.handled).toBe(true);
    expect(result.value).toBe("hello\tworld");
    expect(result.selectionStart).toBe(6);
    expect(result.selectionEnd).toBe(6);
    expect(result.escaped).toBe(false);
  });

  test("replaces a selection with a single tab", () => {
    const result = computeTabKeyDown(
      { key: "Tab", value: "hello world", selectionStart: 5, selectionEnd: 11 },
      false
    );
    expect(result.handled).toBe(true);
    expect(result.value).toBe("hello\t");
    expect(result.selectionStart).toBe(6);
    expect(result.selectionEnd).toBe(6);
  });

  test("arms the escape bypass without touching the value", () => {
    const result = computeTabKeyDown(
      { key: "Escape", value: "hello", selectionStart: 0, selectionEnd: 0 },
      false
    );
    expect(result.handled).toBe(false);
    expect(result.escaped).toBe(true);
    expect(result.value).toBeUndefined();
  });

  test("lets the very next Tab move focus normally after Escape", () => {
    const result = computeTabKeyDown(
      { key: "Tab", value: "hello", selectionStart: 2, selectionEnd: 2 },
      true
    );
    expect(result.handled).toBe(false);
    expect(result.escaped).toBe(false);
    expect(result.value).toBeUndefined();
  });

  test("re-arms the tab trap for the Tab after the bypassed one", () => {
    const afterEscape = computeTabKeyDown(
      { key: "Tab", value: "hello", selectionStart: 2, selectionEnd: 2 },
      true
    );
    const nextTab = computeTabKeyDown(
      { key: "Tab", value: "hello", selectionStart: 2, selectionEnd: 2 },
      afterEscape.escaped
    );
    expect(nextTab.handled).toBe(true);
  });

  test("leaves every other key untouched and clears any pending escape", () => {
    const result = computeTabKeyDown(
      { key: "a", value: "hello", selectionStart: 1, selectionEnd: 1 },
      true
    );
    expect(result.handled).toBe(false);
    expect(result.escaped).toBe(false);
  });
});
