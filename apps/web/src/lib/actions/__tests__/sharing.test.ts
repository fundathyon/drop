import { beforeEach, describe, expect, mock, test } from "bun:test";

// Same mocking template as the other actions tests: stub every module a
// Server Action reaches into before importing the action file, so what's
// under test is only the action's own logic.
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

const shareNode = mock(async () => ({}));
const unshareNode = mock(async () => undefined);

mock.module("@/lib/api", () => ({
  api: { shareNode, unshareNode },
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

const { shareAction, unshareAction } = await import("../sharing");

beforeEach(() => {
  shareNode.mockClear();
  unshareNode.mockClear();
});

describe("shareAction", () => {
  test("rejects a missing user_id without calling the API", async () => {
    const form = new FormData();
    const result = await shareAction("proyectos/site", form, undefined);
    expect(result.error).toBe("userRequired");
    expect(shareNode).not.toHaveBeenCalled();
  });

  test("rejects a non-numeric user_id", async () => {
    const form = new FormData();
    form.set("user_id", "not-a-number");
    const result = await shareAction("proyectos/site", form, undefined);
    expect(result.error).toBe("userRequired");
    expect(shareNode).not.toHaveBeenCalled();
  });

  test("defaults access to viewer when absent", async () => {
    const form = new FormData();
    form.set("user_id", "3");
    const result = await shareAction("proyectos/site", form, undefined);
    expect(result.error).toBeUndefined();
    expect(shareNode).toHaveBeenCalledWith("proyectos/site", 3, "viewer", undefined);
  });

  test("passes the chosen access through", async () => {
    const form = new FormData();
    form.set("user_id", "3");
    form.set("access", "editor");
    await shareAction("proyectos/site", form, 7);
    expect(shareNode).toHaveBeenCalledWith("proyectos/site", 3, "editor", 7);
  });

  // A folder path is nothing special to the action — the grant reaching what
  // is inside it is the API's business, not the form's.
  test("shares a folder the same way it shares a drop", async () => {
    const form = new FormData();
    form.set("user_id", "3");
    form.set("access", "editor");
    await shareAction("equipo", form, undefined);
    expect(shareNode).toHaveBeenCalledWith("equipo", 3, "editor", undefined);
  });

  test("maps any API failure to a generic unexpected key", async () => {
    shareNode.mockImplementationOnce(async () => {
      throw new FakeApiError(409, "already_shared", "already shared with this user");
    });
    const form = new FormData();
    form.set("user_id", "3");
    const result = await shareAction("proyectos/site", form, undefined);
    expect(result.error).toBe("unexpected");
  });
});

describe("unshareAction", () => {
  test("unshares and reports no error", async () => {
    const result = await unshareAction("proyectos/site", 9, undefined);
    expect(result?.error).toBeUndefined();
    expect(unshareNode).toHaveBeenCalledWith("proyectos/site", 9, undefined);
  });

  test("surfaces the API's message on failure", async () => {
    unshareNode.mockImplementationOnce(async () => {
      throw new FakeApiError(404, "not_found", "share not found");
    });
    const result = await unshareAction("proyectos/site", 9, undefined);
    expect(result?.error).toBe("share not found");
  });
});
