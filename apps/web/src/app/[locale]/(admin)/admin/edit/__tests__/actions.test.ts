import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));
mock.module("next/cache", () => ({ revalidatePath: mock(() => {}) }));

class FakeApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string
  ) {
    super(message);
  }
}

const uploadFiles = mock(async () => ({ files: [] }));

mock.module("@/lib/api", () => ({
  api: { uploadFiles },
  ApiError: FakeApiError,
}));

mock.module("@/lib/session", () => ({
  requireUser: mock(async () => ({
    id: 1,
    email: "admin@drop.test",
    name: "Admin",
    role: "admin",
    active: true,
    created_at: "2024-01-01T00:00:00Z",
  })),
}));

const { saveFileAction } = await import("../actions");

beforeEach(() => {
  uploadFiles.mockClear();
});

describe("saveFileAction", () => {
  test("normalizes CRLF to LF before uploading", async () => {
    const form = new FormData();
    form.set("content", "line one\r\nline two\r\n");
    const result = await saveFileAction("proyectos/site", "index.html", form, undefined);
    expect(result.error).toBeUndefined();
    expect(uploadFiles).toHaveBeenCalledTimes(1);

    const [calledPath, calledForm, calledOwner] = uploadFiles.mock.calls[0] as unknown as [string, FormData, number | undefined];
    expect(calledPath).toBe("proyectos/site");
    expect(calledOwner).toBeUndefined();

    const file = (calledForm as FormData).get("file") as File;
    expect(file.name).toBe("index.html");
    expect(file.type).toBe("text/html");
    expect(await file.text()).toBe("line one\nline two\n");
  });

  test("uses the file's own content type from typeOf", async () => {
    const form = new FormData();
    form.set("content", "body { color: red; }");
    await saveFileAction("proyectos/site", "style.css", form, 4);
    const [, calledForm, calledOwner] = uploadFiles.mock.calls[0] as unknown as [string, FormData, number | undefined];
    const file = (calledForm as FormData).get("file") as File;
    expect(file.type).toBe("text/css");
    expect(calledOwner).toBe(4);
  });

  test("treats a missing content field as an empty file", async () => {
    const form = new FormData();
    await saveFileAction("proyectos/site", "index.html", form, undefined);
    const [, calledForm] = uploadFiles.mock.calls[0] as unknown as [string, FormData, number | undefined];
    const file = (calledForm as FormData).get("file") as File;
    expect(await file.text()).toBe("");
  });

  test("maps any API failure to a generic unexpected key", async () => {
    uploadFiles.mockImplementationOnce(async () => {
      throw new FakeApiError(403, "forbidden", "not allowed");
    });
    const form = new FormData();
    form.set("content", "x");
    const result = await saveFileAction("proyectos/site", "index.html", form, undefined);
    expect(result.error).toBe("unexpected");
  });

  test("two successive successes are distinguishable objects", async () => {
    const form = new FormData();
    form.set("content", "x");
    const first = await saveFileAction("proyectos/site", "index.html", form, undefined);
    const second = await saveFileAction("proyectos/site", "index.html", form, undefined);
    expect(second).not.toBe(first);
  });
});
