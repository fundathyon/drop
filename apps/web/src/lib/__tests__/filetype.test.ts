import { describe, expect, test } from "bun:test";
import { typeOf } from "@/lib/filetype";

describe("typeOf", () => {
  test("recognizes known extensions", () => {
    expect(typeOf("index.html")).toMatchObject({ label: "HTML", editable: true, image: false });
    expect(typeOf("logo.svg")).toMatchObject({ label: "SVG", editable: true, image: true });
    expect(typeOf("photo.png")).toMatchObject({ label: "PNG", editable: false, image: true });
  });

  test("resolves aliases to their canonical row", () => {
    expect(typeOf("index.htm").label).toBe("HTML");
    expect(typeOf("script.mjs").label).toBe("JS");
    expect(typeOf("README.markdown").label).toBe("MD");
    expect(typeOf("font.ttf").label).toBe("FONT");
  });

  test("treats .drop as generated metadata, not a yaml file", () => {
    const type = typeOf(".drop");
    expect(type.label).toBe("DROP");
    expect(type.accent).toBe("accent");
  });

  test("falls back to the uppercased extension for unknown types", () => {
    expect(typeOf("archive.foo").label).toBe("FOO");
    expect(typeOf("noext").label).toBe("FILE");
  });
});
