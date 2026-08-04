// Mirrors the JSON shapes returned by the Go API (api/internal/httpapi/dto.go,
// api/internal/service/*.go, api/internal/auth/service.go). Field names and
// casing match the `json` struct tags exactly.

export type Kind = "folder" | "drop";
export type Visibility = "public" | "unlisted" | "private";
export type ShareAccess = "viewer" | "editor";
export type EffectiveAccess = "owner" | ShareAccess;
export type Role = "admin" | "user";
export type InvitationStatus = "pending" | "accepted" | "expired" | "revoked";

export interface Node {
  name: string;
  path: string;
  kind: Kind;
  owner: number;
}

export interface DropMeta {
  title: string;
  slug: string;
  entrypoint: string;
  visibility: Visibility;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface VersionInfo {
  seq: number;
  entrypoint: string;
  files: number;
  size: number;
  current: boolean;
  url: string;
  published_at: string;
}

export interface FileInfo {
  name: string;
  size: number;
  content_type: string;
  modified_at: string;
  generated: boolean;
}

export interface DropDetail extends Node {
  url: string;
  meta: DropMeta;
  files: FileInfo[];
  versions: VersionInfo[];
  entrypoint_missing: boolean;
  access: EffectiveAccess;
}

export interface UserInfo {
  id: number;
  email: string;
  name: string;
  role: Role;
  active: boolean;
  last_login_at?: string;
  created_at: string;
}

export interface InvitationInfo {
  id: number;
  email: string;
  role: Role;
  status: InvitationStatus;
  expires_at: string;
  accepted_at?: string;
  created_at: string;
}

export interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_at: string;
  refresh_token: string;
  refresh_expires_at: string;
  user: UserInfo;
}

export interface ListResponse {
  path: string;
  children: Node[];
}

export interface UploadResponse {
  files: FileInfo[];
}

export interface VersionsResponse {
  path: string;
  versions: VersionInfo[];
}

export interface UsersResponse {
  users: UserInfo[];
}

export interface InvitationsResponse {
  invitations: InvitationInfo[];
}

export interface CreateInvitationResponse {
  invitation: InvitationInfo;
  token: string;
  url: string;
}

export interface ShareInfo {
  id: number;
  user_id: number;
  name: string;
  email: string;
  access: ShareAccess;
  created_by_id: number;
  created_at: string;
}

export interface SharedNode extends Node {
  access: ShareAccess;
  owner_name: string;
  owner_email: string;
  shared_at: string;
}

export interface ShareListResponse {
  path: string;
  shares: ShareInfo[];
  candidates: UserInfo[];
}

export interface SharedResponse {
  nodes: SharedNode[];
}

export interface SetupStatusResponse {
  needs_setup: boolean;
}

export interface ErrorResponse {
  code: string;
  message: string;
}
