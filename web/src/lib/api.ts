import "server-only";
import { getAccessToken } from "./session";
import type {
  CreateInvitationResponse,
  DropDetail,
  InvitationInfo,
  InvitationsResponse,
  ListResponse,
  Node as DriveNode,
  Role,
  SetupStatusResponse,
  ShareAccess,
  ShareInfo,
  ShareListResponse,
  SharedResponse,
  TokenResponse,
  UploadResponse,
  UserInfo,
  UsersResponse,
  Visibility,
  VersionsResponse,
} from "./types";

const API_URL = (process.env.DROP_API_URL ?? "http://localhost:8000").replace(/\/$/, "");

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

// query builds a query string, dropping owner=0: the Go API treats an absent
// "owner" the same as 0 (the caller's own drive), and every URL in the admin
// stays shorter for it.
function query(params: Record<string, string | number | undefined>): string {
  const q = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === "" || (key === "owner" && value === 0)) continue;
    q.set(key, String(value));
  }
  const s = q.toString();
  return s ? `?${s}` : "";
}

async function request<T>(path: string, init?: RequestInit, auth = true): Promise<T> {
  const headers = new Headers(init?.headers);
  if (auth) {
    const token = await getAccessToken();
    if (token) headers.set("Authorization", `Bearer ${token}`);
  }
  if (init?.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const res = await fetch(`${API_URL}${path}`, { ...init, headers, cache: "no-store" });

  if (res.status === 204) return undefined as T;

  const contentType = res.headers.get("content-type") ?? "";
  const isJSON = contentType.includes("application/json");
  const body = isJSON ? await res.json() : await res.text();

  if (!res.ok) {
    if (isJSON && body && typeof body === "object") {
      throw new ApiError(res.status, body.code ?? "unknown", body.message ?? "request failed");
    }
    throw new ApiError(res.status, "unknown", typeof body === "string" ? body : "request failed");
  }
  return body as T;
}

function json(body: unknown): RequestInit {
  return { body: JSON.stringify(body) };
}

export const api = {
  // ---------- auth ----------
  login: (email: string, password: string) =>
    request<TokenResponse>("/v1/auth/login", { method: "POST", ...json({ email, password }) }, false),
  refresh: (refreshToken: string) =>
    request<TokenResponse>(
      "/v1/auth/refresh",
      { method: "POST", ...json({ refresh_token: refreshToken }) },
      false
    ),
  logout: (refreshToken: string) =>
    request<void>("/v1/auth/logout", { method: "POST", ...json({ refresh_token: refreshToken }) }, false),
  me: () => request<UserInfo>("/v1/auth/me", { method: "GET" }),

  // ---------- setup ----------
  setupStatus: () => request<SetupStatusResponse>("/v1/setup/status", { method: "GET" }, false),
  setup: (input: {
    org_name: string;
    name?: string;
    email: string;
    password: string;
    password_confirm: string;
  }) => request<TokenResponse>("/v1/setup", { method: "POST", ...json(input) }, false),

  // ---------- invitations (accepting) ----------
  invitationByToken: (token: string) =>
    request<InvitationInfo>(`/v1/invitations/by-token${query({ token })}`, { method: "GET" }, false),
  acceptInvitation: (input: {
    token: string;
    name?: string;
    password: string;
    password_confirm: string;
  }) => request<UserInfo>("/v1/invitations/accept", { method: "POST", ...json(input) }, false),

  // ---------- invitations (managing, admin only) ----------
  listInvitations: () => request<InvitationsResponse>("/v1/invitations", { method: "GET" }),
  createInvitation: (email: string, role: Role) =>
    request<CreateInvitationResponse>("/v1/invitations", { method: "POST", ...json({ email, role }) }),
  revokeInvitation: (id: number) => request<InvitationInfo>(`/v1/invitations/${id}`, { method: "DELETE" }),

  // ---------- users (admin only) ----------
  listUsers: () => request<UsersResponse>("/v1/users", { method: "GET" }),
  setUserActive: (id: number, active: boolean) =>
    request<UserInfo>(`/v1/users/${id}/active`, { method: "PATCH", ...json({ active }) }),
  deleteUser: (id: number) => request<void>(`/v1/users/${id}`, { method: "DELETE" }),

  // ---------- nodes ----------
  listNodes: (path: string, owner?: number) =>
    request<ListResponse>(`/v1/nodes${query({ path, owner })}`, { method: "GET" }),
  createFolder: (parent: string, name: string, owner?: number) =>
    request<DriveNode>(`/v1/nodes${query({ owner })}`, {
      method: "POST",
      ...json({ parent, name }),
    }),
  deleteNode: (path: string, owner?: number) =>
    request<void>(`/v1/nodes${query({ path, owner })}`, { method: "DELETE" }),

  // ---------- drops ----------
  getDrop: (path: string, owner?: number) =>
    request<DropDetail>(`/v1/drops${query({ path, owner })}`, { method: "GET" }),
  createDrop: (
    input: { parent: string; name: string; title?: string; visibility?: Visibility; entrypoint?: string },
    owner?: number
  ) => request<DropDetail>(`/v1/drops${query({ owner })}`, { method: "POST", ...json(input) }),
  patchDrop: (
    path: string,
    patch: { title?: string; visibility?: Visibility; entrypoint?: string },
    owner?: number
  ) => request<DropDetail>(`/v1/drops${query({ path, owner })}`, { method: "PATCH", ...json(patch) }),
  listDropVersions: (path: string, owner?: number) =>
    request<VersionsResponse>(`/v1/drops/versions${query({ path, owner })}`, { method: "GET" }),
  activateDropVersion: (path: string, seq: number, owner?: number) =>
    request<DropDetail>(`/v1/drops/versions/activate${query({ path, owner })}`, {
      method: "POST",
      ...json({ seq }),
    }),

  // ---------- files ----------
  // A same-origin path (proxied by app/api/files/route.ts), not a direct link
  // to the Go API: a browser navigating an <a href> or loading an <img src>
  // sends no Authorization header and no Go-origin cookie, so a direct link
  // would 401. The proxy re-attaches the bearer token server-side.
  fileRawPath: (path: string, owner?: number) => `/api/files${query({ path, owner })}`,
  uploadFiles: (path: string, files: FormData, owner?: number) =>
    request<UploadResponse>(`/v1/files${query({ path, owner })}`, { method: "POST", body: files }),
  deleteFile: (path: string, owner?: number) =>
    request<void>(`/v1/files${query({ path, owner })}`, { method: "DELETE" }),
  downloadFileText: async (path: string, owner?: number): Promise<string> => {
    const token = await getAccessToken();
    const headers = new Headers();
    if (token) headers.set("Authorization", `Bearer ${token}`);
    const res = await fetch(`${API_URL}/v1/files${query({ path, owner })}`, {
      headers,
      cache: "no-store",
    });
    if (!res.ok) throw new ApiError(res.status, "unknown", "could not read file");
    return res.text();
  },

  // ---------- sharing ----------
  listShares: (path: string, owner?: number) =>
    request<ShareListResponse>(`/v1/shares${query({ path, owner })}`, { method: "GET" }),
  shareNode: (path: string, userId: number, access: ShareAccess, owner?: number) =>
    request<ShareInfo>(`/v1/shares${query({ path, owner })}`, {
      method: "POST",
      ...json({ user_id: userId, access }),
    }),
  unshareNode: (path: string, userId: number, owner?: number) =>
    request<void>(`/v1/shares${query({ path, owner, user_id: userId })}`, { method: "DELETE" }),
  listSharedWithMe: () => request<SharedResponse>("/v1/shared", { method: "GET" }),
};
