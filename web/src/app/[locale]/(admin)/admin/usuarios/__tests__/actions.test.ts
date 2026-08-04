import { beforeEach, describe, expect, mock, test } from "bun:test";

// Same mocking template as the explorer's actions.test.ts: stub every module
// a Server Action reaches into before importing the action file itself, so
// what's under test is only the action's own logic — input handling, the
// ApiError-to-{error} mapping, and the success path.
mock.module("server-only", () => ({}));
mock.module("next/cache", () => ({ revalidatePath: mock(() => {}) }));
mock.module("next/headers", () => ({
  headers: mock(async () => new Headers({ host: "app.test" })),
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

const setUserActive = mock(async (_id: number, active: boolean) => ({
  id: 1,
  email: "someone@drop.test",
  name: "Someone",
  role: "user" as const,
  active,
  created_at: "2024-01-01T00:00:00Z",
}));
const deleteUser = mock(async () => undefined);
const revokeInvitation = mock(async () => ({
  id: 1,
  email: "invitee@drop.test",
  role: "user" as const,
  status: "revoked" as const,
  expires_at: "2024-02-01T00:00:00Z",
  created_at: "2024-01-01T00:00:00Z",
}));
const createInvitation = mock(async (email: string, role: string) => ({
  invitation: {
    id: 42,
    email,
    role,
    status: "pending" as const,
    expires_at: "2024-02-01T00:00:00Z",
    created_at: "2024-01-01T00:00:00Z",
  },
  token: "raw-token",
  url: "http://localhost:8000/invitacion?token=raw-token",
}));

mock.module("@/lib/api", () => ({
  api: { setUserActive, deleteUser, revokeInvitation, createInvitation },
  ApiError: FakeApiError,
}));

mock.module("@/lib/session", () => ({
  requireAdmin: mock(async () => ({
    id: 1,
    email: "admin@drop.test",
    name: "Admin",
    role: "admin",
    active: true,
    created_at: "2024-01-01T00:00:00Z",
  })),
}));

const { setUserActiveAction, deleteUserAction, revokeInvitationAction, createInvitationAction } = await import(
  "../actions"
);

beforeEach(() => {
  setUserActive.mockClear();
  deleteUser.mockClear();
  revokeInvitation.mockClear();
  createInvitation.mockClear();
});

describe("setUserActiveAction", () => {
  test("activates/deactivates and reports no error", async () => {
    const result = await setUserActiveAction(7, false);
    expect(result?.error).toBeUndefined();
    expect(setUserActive).toHaveBeenCalledWith(7, false);
  });

  test("surfaces the API's error message on failure", async () => {
    setUserActive.mockImplementationOnce(async () => {
      throw new FakeApiError(400, "invalid_body", "you cannot disable your own account");
    });
    const result = await setUserActiveAction(1, false);
    expect(result?.error).toBe("you cannot disable your own account");
  });

  test("falls back to a generic error for a non-ApiError failure", async () => {
    setUserActive.mockImplementationOnce(async () => {
      throw new Error("network down");
    });
    const result = await setUserActiveAction(7, false);
    expect(result?.error).toBe("unexpected");
  });
});

describe("deleteUserAction", () => {
  test("deletes and reports no error", async () => {
    const result = await deleteUserAction(7);
    expect(result?.error).toBeUndefined();
    expect(deleteUser).toHaveBeenCalledWith(7);
  });

  test("surfaces the API's error message on failure", async () => {
    deleteUser.mockImplementationOnce(async () => {
      throw new FakeApiError(409, "last_admin", "this is the last active administrator");
    });
    const result = await deleteUserAction(1);
    expect(result?.error).toBe("this is the last active administrator");
  });
});

describe("revokeInvitationAction", () => {
  test("revokes and reports no error", async () => {
    const result = await revokeInvitationAction(9);
    expect(result?.error).toBeUndefined();
    expect(revokeInvitation).toHaveBeenCalledWith(9);
  });

  test("surfaces the API's error message on failure", async () => {
    revokeInvitation.mockImplementationOnce(async () => {
      throw new FakeApiError(410, "invalid_invitation", "it is already accepted");
    });
    const result = await revokeInvitationAction(9);
    expect(result?.error).toBe("it is already accepted");
  });
});

describe("createInvitationAction", () => {
  test("rejects a blank email without calling the API", async () => {
    const form = new FormData();
    form.set("email", "   ");
    form.set("role", "user");
    const result = await createInvitationAction(undefined, form);
    expect(result.error).toBe("invalidEmail");
    expect(createInvitation).not.toHaveBeenCalled();
  });

  test("defaults role to user when absent", async () => {
    const form = new FormData();
    form.set("email", "new@drop.test");
    await createInvitationAction(undefined, form);
    expect(createInvitation).toHaveBeenCalledWith("new@drop.test", "user");
  });

  test("passes the chosen role through", async () => {
    const form = new FormData();
    form.set("email", "new@drop.test");
    form.set("role", "admin");
    await createInvitationAction(undefined, form);
    expect(createInvitation).toHaveBeenCalledWith("new@drop.test", "admin");
  });

  test("rebuilds the link against this app's own origin, not the API's", async () => {
    // The Go API builds its `url` from its own request's Host header, which
    // knows nothing about a separate frontend now serving /invitacion — the
    // action must discard that host and keep only the token.
    createInvitation.mockImplementationOnce(async () => ({
      invitation: {
        id: 99,
        email: "picked@drop.test",
        role: "user" as const,
        status: "pending" as const,
        expires_at: "2024-02-01T00:00:00Z",
        created_at: "2024-01-01T00:00:00Z",
      },
      token: "raw-token",
      url: "http://localhost:8000/invitacion?token=one-time-marker",
    }));
    const form = new FormData();
    form.set("email", "picked@drop.test");
    form.set("role", "user");
    const result = await createInvitationAction(undefined, form);
    expect(result.error).toBeUndefined();
    expect(result.link).toBe("http://app.test/invitacion?token=one-time-marker");
    expect(result.email).toBe("picked@drop.test");
  });

  test("two successive successes are distinguishable objects", async () => {
    const form = new FormData();
    form.set("email", "again@drop.test");
    form.set("role", "user");
    const first = await createInvitationAction(undefined, form);
    const second = await createInvitationAction(first, form);
    expect(second).not.toBe(first);
  });

  test("maps an already-registered email to alreadyExists", async () => {
    createInvitation.mockImplementationOnce(async () => {
      throw new FakeApiError(409, "already_exists", "someone@drop.test already has an account");
    });
    const form = new FormData();
    form.set("email", "someone@drop.test");
    const result = await createInvitationAction(undefined, form);
    expect(result.error).toBe("alreadyExists");
  });

  test("maps an invalid body to invalidEmail", async () => {
    createInvitation.mockImplementationOnce(async () => {
      throw new FakeApiError(400, "invalid_body", "a valid email is required");
    });
    const form = new FormData();
    form.set("email", "not-an-email");
    const result = await createInvitationAction(undefined, form);
    expect(result.error).toBe("invalidEmail");
  });

  test("falls back to unexpected for anything else", async () => {
    createInvitation.mockImplementationOnce(async () => {
      throw new Error("network down");
    });
    const form = new FormData();
    form.set("email", "new@drop.test");
    const result = await createInvitationAction(undefined, form);
    expect(result.error).toBe("unexpected");
  });
});
