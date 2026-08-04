import { describe, expect, test } from "bun:test";
import { decodePathSegments, formatDate, formatSize, joinPath, lastSegment, parentOf } from "@/lib/format";

describe("formatSize", () => {
  test("stays in bytes below 1024", () => {
    expect(formatSize(0)).toBe("0 B");
    expect(formatSize(1023)).toBe("1023 B");
  });

  test("switches to KB/MB/GB with one decimal", () => {
    expect(formatSize(1024)).toBe("1.0 KB");
    expect(formatSize(1536)).toBe("1.5 KB");
    expect(formatSize(1024 * 1024)).toBe("1.0 MB");
    expect(formatSize(1024 * 1024 * 1024 * 2)).toBe("2.0 GB");
  });
});

describe("formatDate", () => {
  test("renders local date/time to the minute", () => {
    expect(formatDate("2024-03-05T09:07:00Z")).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  });

  test("falls back to an em dash for nothing", () => {
    expect(formatDate(undefined)).toBe("—");
    expect(formatDate(null)).toBe("—");
  });
});

describe("path helpers", () => {
  test("joinPath", () => {
    expect(joinPath("", "proyectos")).toBe("proyectos");
    expect(joinPath("proyectos", "arquitectura")).toBe("proyectos/arquitectura");
  });

  test("parentOf", () => {
    expect(parentOf("proyectos/arquitectura")).toBe("proyectos");
    expect(parentOf("proyectos")).toBe("");
  });

  test("lastSegment", () => {
    expect(lastSegment("proyectos/arquitectura")).toBe("arquitectura");
    expect(lastSegment("proyectos")).toBe("proyectos");
  });

  describe("decodePathSegments", () => {
    test("decodes each percent-encoded segment before joining", () => {
      expect(decodePathSegments(["payments", "plans%20catalog"])).toBe("payments/plans catalog");
    });

    test("joins plain segments unchanged", () => {
      expect(decodePathSegments(["proyectos", "arquitectura"])).toBe("proyectos/arquitectura");
    });

    test("returns an empty string for no segments", () => {
      expect(decodePathSegments([])).toBe("");
    });

    test("falls back to the raw segment on malformed encoding instead of throwing", () => {
      expect(decodePathSegments(["100%off"])).toBe("100%off");
    });
  });
});
