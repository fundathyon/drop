import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { NextRequest } from "next/server";

mock.module("server-only", () => ({}));

const getAccessToken = mock(async (): Promise<string | null> => "a-real-token");
mock.module("@/lib/session", () => ({ getAccessToken }));

const { GET } = await import("../route");

const originalFetch = global.fetch;

describe("GET /api/files", () => {
  beforeEach(() => {
    getAccessToken.mockClear();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  test("answers 401 without forwarding to the API when there is no session", async () => {
    getAccessToken.mockImplementationOnce(async () => null);
    const fetchSpy = mock(async () => new Response("should not be called"));
    global.fetch = fetchSpy as unknown as typeof fetch;

    const res = await GET(new NextRequest("http://localhost:3000/api/files?path=drop/index.html"));

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ code: "unauthorized", message: "authentication required" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("attaches the bearer token and streams the upstream body/headers through", async () => {
    const fetchSpy = mock(async (url: string, init?: RequestInit) => {
      expect(url).toBe("http://localhost:8000/v1/files?path=drop%2Findex.html");
      expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer a-real-token");
      return new Response("<h1>hola</h1>", {
        status: 200,
        headers: { "content-type": "text/html", "content-length": "13" },
      });
    });
    global.fetch = fetchSpy as unknown as typeof fetch;

    const res = await GET(new NextRequest("http://localhost:3000/api/files?path=drop/index.html"));

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/html");
    expect(res.headers.get("content-length")).toBe("13");
    expect(await res.text()).toBe("<h1>hola</h1>");
  });

  test("passes the owner query param through when present", async () => {
    const fetchSpy = mock(async (url: string) => {
      expect(url).toBe("http://localhost:8000/v1/files?path=drop%2Findex.html&owner=7");
      return new Response("ok", { status: 200 });
    });
    global.fetch = fetchSpy as unknown as typeof fetch;

    await GET(new NextRequest("http://localhost:3000/api/files?path=drop/index.html&owner=7"));
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  test("passes through a non-2xx upstream status", async () => {
    const fetchSpy = mock(
      async () => new Response(JSON.stringify({ code: "not_found", message: "resource not found" }), { status: 404 })
    );
    global.fetch = fetchSpy as unknown as typeof fetch;

    const res = await GET(new NextRequest("http://localhost:3000/api/files?path=missing.html"));
    expect(res.status).toBe(404);
  });
});
