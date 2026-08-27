import { beforeEach, describe, expect, mock, test } from "bun:test";

// Same mocking template as the explorer's and users' actions.test.ts: stub
// every module a Server Action reaches into before importing the action
// file, so what's under test is only the action's own logic.
mock.module("server-only", () => ({}));
mock.module("next/cache", () => ({ revalidatePath: mock(() => {}) }));
mock.module("next-intl/server", () => ({ getLocale: async () => "es" }));
mock.module("@/i18n/navigation", () => ({
  redirect: mock((args: unknown) => {
    throw new Error(`REDIRECT:${JSON.stringify(args)}`);
  }),
}));

class FakeApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string
  ) {
    super(message);
  }
}

const deleteNode = mock(async () => undefined);
const deleteFile = mock(async () => undefined);
const activateDropVersion = mock(async () => ({}));
const patchDrop = mock(async () => ({}));
const uploadFiles = mock(async () => ({ files: [] }));

mock.module("@/lib/api", () => ({
  api: { deleteNode, deleteFile, activateDropVersion, patchDrop, uploadFiles },
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

const {
  deleteDropAction,
  deleteFileAction,
  activateVersionAction,
  patchDropAction,
  uploadFilesAction,
} = await import("../actions");

beforeEach(() => {
  deleteNode.mockClear();
  deleteFile.mockClear();
  activateDropVersion.mockClear();
  patchDrop.mockClear();
  uploadFiles.mockClear();
});

describe("deleteDropAction", () => {
  test("deletes and redirects to the parent folder", async () => {
    await expect(deleteDropAction("proyectos/site", undefined)).rejects.toThrow(
      /REDIRECT:.*"href":"\/proyectos"/
    );
    expect(deleteNode).toHaveBeenCalledWith("proyectos/site", undefined);
  });

  test("redirects to the root when the drop is at the top level", async () => {
    await expect(deleteDropAction("site", undefined)).rejects.toThrow(/REDIRECT:.*"href":"\/"/);
  });

  test("carries the owner query through the redirect", async () => {
    await expect(deleteDropAction("proyectos/site", 7)).rejects.toThrow(
      /REDIRECT:.*"href":"\/proyectos\?owner=7"/
    );
  });

  test("surfaces the API's message on failure instead of redirecting", async () => {
    deleteNode.mockImplementationOnce(async () => {
      throw new FakeApiError(403, "forbidden", "not allowed on this resource");
    });
    const result = await deleteDropAction("proyectos/site", undefined);
    expect(result?.error).toBe("not allowed on this resource");
  });

  test("falls back to a generic error for a non-ApiError failure", async () => {
    deleteNode.mockImplementationOnce(async () => {
      throw new Error("network down");
    });
    const result = await deleteDropAction("proyectos/site", undefined);
    expect(result?.error).toBe("unexpected");
  });
});

describe("deleteFileAction", () => {
  test("deletes and reports no error", async () => {
    const result = await deleteFileAction("proyectos/site/old.html", undefined);
    expect(result?.error).toBeUndefined();
    expect(deleteFile).toHaveBeenCalledWith("proyectos/site/old.html", undefined);
  });

  test("surfaces the API's message on failure", async () => {
    deleteFile.mockImplementationOnce(async () => {
      throw new FakeApiError(404, "not_found", "no such file");
    });
    const result = await deleteFileAction("proyectos/site/old.html", undefined);
    expect(result?.error).toBe("no such file");
  });
});

describe("activateVersionAction", () => {
  test("activates and reports no error", async () => {
    const result = await activateVersionAction("proyectos/site", 3, undefined);
    expect(result?.error).toBeUndefined();
    expect(activateDropVersion).toHaveBeenCalledWith("proyectos/site", 3, undefined);
  });

  test("surfaces the API's message on failure", async () => {
    activateDropVersion.mockImplementationOnce(async () => {
      throw new FakeApiError(409, "conflict", "version no longer exists");
    });
    const result = await activateVersionAction("proyectos/site", 3, undefined);
    expect(result?.error).toBe("version no longer exists");
  });
});

describe("patchDropAction", () => {
  test("patches with the trimmed form fields and returns a fresh success marker", async () => {
    const form = new FormData();
    form.set("title", "  Nuevo título  ");
    form.set("visibility", "unlisted");
    form.set("entrypoint", "index.html");
    const first = await patchDropAction("proyectos/site", form, undefined);
    expect(first.error).toBeUndefined();
    expect(patchDrop).toHaveBeenCalledWith(
      "proyectos/site",
      { title: "Nuevo título", visibility: "unlisted", entrypoint: "index.html" },
      undefined
    );

    const second = await patchDropAction("proyectos/site", form, 7);
    expect(second).not.toBe(first);
    expect(patchDrop).toHaveBeenLastCalledWith(
      "proyectos/site",
      { title: "Nuevo título", visibility: "unlisted", entrypoint: "index.html" },
      7
    );
  });

  test("maps any failure to a generic unexpected key", async () => {
    patchDrop.mockImplementationOnce(async () => {
      throw new FakeApiError(403, "forbidden", "not allowed");
    });
    const form = new FormData();
    form.set("title", "x");
    form.set("visibility", "public");
    form.set("entrypoint", "index.html");
    const result = await patchDropAction("proyectos/site", form, undefined);
    expect(result.error).toBe("unexpected");
  });
});

describe("uploadFilesAction", () => {
  test("rejects an empty file list without calling the API", async () => {
    const form = new FormData();
    const result = await uploadFilesAction("proyectos/site", form, undefined);
    expect(result.error).toBe("noFile");
    expect(uploadFiles).not.toHaveBeenCalled();
  });

  test("rejects a file list containing only zero-byte entries", async () => {
    const form = new FormData();
    form.set("file", new File([], "empty.txt"));
    const result = await uploadFilesAction("proyectos/site", form, undefined);
    expect(result.error).toBe("noFile");
    expect(uploadFiles).not.toHaveBeenCalled();
  });

  test("forwards every file entry and reports no error", async () => {
    const form = new FormData();
    form.append("file", new File(["a"], "a.txt"));
    form.append("file", new File(["b"], "b.txt"));
    const result = await uploadFilesAction("proyectos/site", form, 5);
    expect(result.error).toBeUndefined();
    expect(uploadFiles).toHaveBeenCalledTimes(1);
    const [calledPath, calledForm, calledOwner] = uploadFiles.mock.calls[0] as unknown as [string, FormData, number | undefined];
    expect(calledPath).toBe("proyectos/site");
    expect(calledOwner).toBe(5);
    expect((calledForm as FormData).getAll("file")).toHaveLength(2);
  });

  test("maps any API failure to a generic unexpected key", async () => {
    uploadFiles.mockImplementationOnce(async () => {
      throw new FakeApiError(500, "internal", "boom");
    });
    const form = new FormData();
    form.set("file", new File(["a"], "a.txt"));
    const result = await uploadFilesAction("proyectos/site", form, undefined);
    expect(result.error).toBe("unexpected");
  });
});
