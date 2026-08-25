import { describe, expect, test } from "bun:test";
import { sharedNodeHref } from "../link-target";

describe("sharedNodeHref", () => {
  test("links a drop to the drop viewer with the owner query", () => {
    expect(sharedNodeHref("drop", "proyectos/arquitectura", 7)).toBe(
      "/drop/proyectos/arquitectura?owner=7"
    );
  });

  test("links a folder to the explorer with the owner query", () => {
    expect(sharedNodeHref("folder", "proyectos", 7)).toBe("/proyectos?owner=7");
  });

  test("still qualifies a root-level path with the owner", () => {
    expect(sharedNodeHref("drop", "readme", 1)).toBe("/drop/readme?owner=1");
  });
});
