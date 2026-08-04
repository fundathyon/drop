import { beforeEach, describe, expect, mock, test } from "bun:test";

// Every module a Server Action reaches into gets stubbed before the action
// itself is imported, so the test exercises the action's own logic (input
// validation, error-code mapping) without a real Next.js request context or a
// running Go API. This is the pattern every other page's action tests should
// follow: mock next/headers, next/cache, next-intl/server, @/i18n/navigation,
// @/lib/api and @/lib/session, then dynamically import the action file.
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

const createFolder = mock(async (_parent: string, name: string) => ({
  name,
  path: `proyectos/${name}`,
  kind: "folder" as const,
  owner: 0,
}));
const createDrop = mock(async () => ({ path: "proyectos/arquitectura" }));
const deleteNode = mock(async () => undefined);
const uploadFiles = mock(async () => ({ files: [] }));

mock.module("@/lib/api", () => ({
  api: { createFolder, createDrop, deleteNode, uploadFiles },
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

const { createFolderAction, createDropAction, deleteNodeAction } = await import("../actions");

beforeEach(() => {
  createFolder.mockClear();
  createDrop.mockClear();
  deleteNode.mockClear();
  uploadFiles.mockClear();
});

describe("createFolderAction", () => {
  test("rejects a blank name without calling the API", async () => {
    const form = new FormData();
    form.set("parent", "proyectos");
    form.set("name", "   ");
    const result = await createFolderAction(undefined, form);
    expect(result.error).toBe("invalid_path");
    expect(createFolder).not.toHaveBeenCalled();
  });

  test("creates the folder and returns a fresh success marker", async () => {
    const form = new FormData();
    form.set("parent", "proyectos");
    form.set("name", "clientes");
    const first = await createFolderAction(undefined, form);
    expect(first.error).toBeUndefined();
    expect(createFolder).toHaveBeenCalledWith("proyectos", "clientes", undefined);

    // Two successes in a row must be distinguishable objects, not the same
    // reference — the dialog's close-on-success check relies on that.
    const second = await createFolderAction(first, form);
    expect(second).not.toBe(first);
  });

  test("passes the owner through for a shared drive", async () => {
    const form = new FormData();
    form.set("parent", "proyectos");
    form.set("name", "clientes");
    form.set("owner", "7");
    await createFolderAction(undefined, form);
    expect(createFolder).toHaveBeenCalledWith("proyectos", "clientes", 7);
  });

  test("surfaces the API's error code on failure", async () => {
    createFolder.mockImplementationOnce(async () => {
      throw new FakeApiError(409, "already_exists", "a node with that name already exists");
    });
    const form = new FormData();
    form.set("parent", "proyectos");
    form.set("name", "clientes");
    const result = await createFolderAction(undefined, form);
    expect(result.error).toBe("already_exists");
  });
});

describe("createDropAction", () => {
  test("rejects a blank name without calling the API", async () => {
    const form = new FormData();
    form.set("parent", "proyectos");
    form.set("name", "");
    const result = await createDropAction(undefined, form);
    expect(result?.error).toBe("invalid_path");
    expect(createDrop).not.toHaveBeenCalled();
  });

  test("redirects to the new drop on success", async () => {
    const form = new FormData();
    form.set("parent", "proyectos");
    form.set("name", "arquitectura");
    form.set("title", "Arquitectura");
    await expect(createDropAction(undefined, form)).rejects.toThrow(/REDIRECT:.*drop\/proyectos\/arquitectura/);
    expect(uploadFiles).not.toHaveBeenCalled();
  });

  test("uploads attached files to the new drop before redirecting", async () => {
    const form = new FormData();
    form.set("parent", "proyectos");
    form.set("name", "arquitectura");
    form.append("files", new File(["a"], "a.html"));
    form.append("files", new File(["b"], "b.css"));
    await expect(createDropAction(undefined, form)).rejects.toThrow(/REDIRECT:.*drop\/proyectos\/arquitectura/);

    expect(uploadFiles).toHaveBeenCalledTimes(1);
    const [calledPath, calledForm, calledOwner] = uploadFiles.mock.calls[0] as unknown as [
      string,
      FormData,
      number | undefined,
    ];
    expect(calledPath).toBe("proyectos/arquitectura");
    expect(calledOwner).toBeUndefined();
    expect((calledForm as FormData).getAll("file")).toHaveLength(2);
  });

  test("ignores zero-byte file entries", async () => {
    const form = new FormData();
    form.set("parent", "proyectos");
    form.set("name", "arquitectura");
    form.append("files", new File([], "empty.html"));
    await expect(createDropAction(undefined, form)).rejects.toThrow(/REDIRECT:/);
    expect(uploadFiles).not.toHaveBeenCalled();
  });

  test("still redirects when the file upload fails", async () => {
    uploadFiles.mockImplementationOnce(async () => {
      throw new FakeApiError(500, "internal", "boom");
    });
    const form = new FormData();
    form.set("parent", "proyectos");
    form.set("name", "arquitectura");
    form.append("files", new File(["a"], "a.html"));
    await expect(createDropAction(undefined, form)).rejects.toThrow(/REDIRECT:.*drop\/proyectos\/arquitectura/);
    expect(uploadFiles).toHaveBeenCalledTimes(1);
  });
});

describe("deleteNodeAction", () => {
  test("deletes and reports no error", async () => {
    const result = await deleteNodeAction("proyectos/viejo", undefined);
    expect(result?.error).toBeUndefined();
    expect(deleteNode).toHaveBeenCalledWith("proyectos/viejo", undefined);
  });

  test("surfaces a failure's message", async () => {
    deleteNode.mockImplementationOnce(async () => {
      throw new FakeApiError(403, "forbidden", "not allowed on this resource");
    });
    const result = await deleteNodeAction("proyectos/viejo", undefined);
    expect(result?.error).toBe("not allowed on this resource");
  });
});
