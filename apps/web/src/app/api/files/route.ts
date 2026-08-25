import { NextRequest } from "next/server";
import { getAccessToken } from "@/lib/session";

// A browser-facing GET (an <a href>/<img src>, not a fetch() call this app's
// own code controls) carries no Authorization header and no Go-origin
// cookie — the session lives on this server, not the API's. This route is
// the one place a raw file byte-stream crosses that boundary: it re-attaches
// the bearer token server-side and streams the Go API's response straight
// through, so every download link and image preview stays same-origin.
const API_URL = (process.env.DROP_API_URL ?? "http://localhost:8000").replace(/\/$/, "");

export async function GET(request: NextRequest) {
  const token = await getAccessToken();
  if (!token) {
    return Response.json({ code: "unauthorized", message: "authentication required" }, { status: 401 });
  }

  const path = request.nextUrl.searchParams.get("path") ?? "";
  const owner = request.nextUrl.searchParams.get("owner");
  const query = new URLSearchParams({ path });
  if (owner) query.set("owner", owner);

  const upstream = await fetch(`${API_URL}/v1/files?${query.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });

  const headers = new Headers();
  const contentType = upstream.headers.get("content-type");
  if (contentType) headers.set("Content-Type", contentType);
  const contentLength = upstream.headers.get("content-length");
  if (contentLength) headers.set("Content-Length", contentLength);

  return new Response(upstream.body, { status: upstream.status, headers });
}
