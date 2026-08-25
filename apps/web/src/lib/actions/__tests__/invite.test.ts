import { beforeEach, describe, expect, mock, test } from "bun:test";

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

const fakeUser = {
  id: 2,
  email: "invitee@drop.test",
  name: "Invitee",
  role: "user" as const,
  active: true,
  created_at: "2024-01-01T00:00:00Z",
};

const acceptInvitation = mock(async () => fakeUser);

mock.module("@/lib/api", () => ({
  api: { acceptInvitation },
  ApiError: FakeApiError,
}));

const { acceptInvitationAction } = await import("../invite");

function form(fields: Record<string, string>) {
  const f = new FormData();
  for (const [key, value] of Object.entries(fields)) f.set(key, value);
  return f;
}

const validFields = {
  token: "tok-123",
  password: "longenough1",
  password_confirm: "longenough1",
};

beforeEach(() => {
  acceptInvitation.mockClear();
});

describe("acceptInvitationAction", () => {
  test("rejects mismatched passwords without calling the API", async () => {
    const result = await acceptInvitationAction(undefined, form({ ...validFields, password_confirm: "different1" }));
    expect(result.error).toBe("passwordMismatch");
    expect(acceptInvitation).not.toHaveBeenCalled();
  });

  test("surfaces the API's invalid_body message verbatim", async () => {
    acceptInvitation.mockImplementationOnce(async () => {
      throw new FakeApiError(422, "invalid_body", "the password must be at least 8 characters");
    });
    const result = await acceptInvitationAction(undefined, form(validFields));
    expect(result.error).toBe("the password must be at least 8 characters");
  });

  test("falls back to the generic invalidInvitation state for any other API failure", async () => {
    acceptInvitation.mockImplementationOnce(async () => {
      throw new FakeApiError(410, "invitation_expired", "this invitation has expired");
    });
    const result = await acceptInvitationAction(undefined, form(validFields));
    expect(result.error).toBe("invalidInvitation");
  });

  test("falls back to invalidInvitation for a non-ApiError failure too", async () => {
    acceptInvitation.mockImplementationOnce(async () => {
      throw new Error("network is down");
    });
    const result = await acceptInvitationAction(undefined, form(validFields));
    expect(result.error).toBe("invalidInvitation");
  });

  test("does not sign the user in, and redirects to /login with the new email on success", async () => {
    let thrown: unknown;
    try {
      await acceptInvitationAction(undefined, form({ ...validFields, name: "Invitee" }));
    } catch (err) {
      thrown = err;
    }
    expect((thrown as Error).message).toContain("/login?email=invitee%40drop.test&message=accountCreated");
    expect(acceptInvitation).toHaveBeenCalledWith({
      token: "tok-123",
      name: "Invitee",
      password: "longenough1",
      password_confirm: "longenough1",
    });
  });

  test("omits an empty name from the request instead of sending a blank string", async () => {
    await expect(acceptInvitationAction(undefined, form(validFields))).rejects.toBeInstanceOf(Error);
    expect(acceptInvitation).toHaveBeenCalledWith(
      expect.objectContaining({
        name: undefined,
      })
    );
  });
});
