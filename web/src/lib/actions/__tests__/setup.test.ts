import { beforeEach, describe, expect, mock, test } from "bun:test";

// Same pattern as the explorer's actions.test.ts: stub every module the
// action file reaches into before dynamically importing it.
mock.module("server-only", () => ({}));
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

const fakeTokens = {
  access_token: "at",
  token_type: "bearer",
  expires_at: "2024-01-01T00:00:00Z",
  refresh_token: "rt",
  refresh_expires_at: "2024-01-08T00:00:00Z",
  user: {
    id: 1,
    email: "admin@drop.test",
    name: "Admin",
    role: "admin" as const,
    active: true,
    created_at: "2024-01-01T00:00:00Z",
  },
};

const setup = mock(async () => fakeTokens);

mock.module("@/lib/api", () => ({
  api: { setup },
  ApiError: FakeApiError,
}));

const setSession = mock(async () => {});
mock.module("@/lib/session", () => ({ setSession }));

const { setupAction } = await import("../setup");

function form(fields: Record<string, string>) {
  const f = new FormData();
  for (const [key, value] of Object.entries(fields)) f.set(key, value);
  return f;
}

const validFields = {
  org_name: "Acme",
  email: "admin@acme.test",
  password: "longenough1",
  password_confirm: "longenough1",
};

beforeEach(() => {
  setup.mockClear();
  setSession.mockClear();
});

describe("setupAction", () => {
  test("rejects mismatched passwords without calling the API", async () => {
    const result = await setupAction(undefined, form({ ...validFields, password_confirm: "different1" }));
    expect(result.error).toBe("passwordMismatch");
    expect(setup).not.toHaveBeenCalled();
  });

  test("surfaces the API's invalid_body message verbatim", async () => {
    setup.mockImplementationOnce(async () => {
      throw new FakeApiError(422, "invalid_body", "the password must be at least 8 characters");
    });
    const result = await setupAction(undefined, form(validFields));
    expect(result.error).toBe("the password must be at least 8 characters");
  });

  test("redirects to /login when setup was already completed by someone else", async () => {
    setup.mockImplementationOnce(async () => {
      throw new FakeApiError(409, "already_set_up", "setup already completed");
    });
    let thrown: unknown;
    try {
      await setupAction(undefined, form(validFields));
    } catch (err) {
      thrown = err;
    }
    expect((thrown as Error).message).toContain('"href":"/login"');
    expect(setSession).not.toHaveBeenCalled();
  });

  test("maps any other failure to a generic, unexpected error", async () => {
    setup.mockImplementationOnce(async () => {
      throw new Error("network is down");
    });
    const result = await setupAction(undefined, form(validFields));
    expect(result.error).toBe("unexpected");
  });

  test("creates the session and redirects home on success", async () => {
    let thrown: unknown;
    try {
      await setupAction(undefined, form({ ...validFields, name: "Rafa" }));
    } catch (err) {
      thrown = err;
    }
    expect((thrown as Error).message).toContain('"href":"/"');
    expect(setSession).toHaveBeenCalledTimes(1);
    expect(setSession).toHaveBeenCalledWith(fakeTokens);
    expect(setup).toHaveBeenCalledWith({
      org_name: "Acme",
      name: "Rafa",
      email: "admin@acme.test",
      password: "longenough1",
      password_confirm: "longenough1",
    });
  });

  test("omits an empty name from the request instead of sending a blank string", async () => {
    let thrown: unknown;
    try {
      await setupAction(undefined, form(validFields));
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect(setup).toHaveBeenCalledWith(
      expect.objectContaining({
        name: undefined,
      })
    );
  });

  // Two successive successes must produce distinguishable state objects — not
  // load-bearing here since success always redirects, but the error path must
  // still hand back a fresh object each time so a consuming dialog could tell
  // "just failed" apart from "nothing has happened yet".
  test("returns a fresh object on repeated failures", async () => {
    const first = await setupAction(undefined, form({ ...validFields, password_confirm: "different1" }));
    const second = await setupAction(first, form({ ...validFields, password_confirm: "different2" }));
    expect(first).not.toBe(second);
  });
});
