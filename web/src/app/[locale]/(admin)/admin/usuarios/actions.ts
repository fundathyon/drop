"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { api, ApiError } from "@/lib/api";
import { requireAdmin } from "@/lib/session";
import type { Role } from "@/lib/types";

export interface ActionState {
  error?: string;
}

export async function setUserActiveAction(id: number, active: boolean): Promise<ActionState | void> {
  await requireAdmin();
  try {
    await api.setUserActive(id, active);
  } catch (err) {
    return { error: err instanceof ApiError ? err.message : "unexpected" };
  }
  revalidatePath("/", "layout");
}

export async function deleteUserAction(id: number): Promise<ActionState | void> {
  await requireAdmin();
  try {
    await api.deleteUser(id);
  } catch (err) {
    return { error: err instanceof ApiError ? err.message : "unexpected" };
  }
  revalidatePath("/", "layout");
}

export async function revokeInvitationAction(id: number): Promise<ActionState | void> {
  await requireAdmin();
  try {
    await api.revokeInvitation(id);
  } catch (err) {
    return { error: err instanceof ApiError ? err.message : "unexpected" };
  }
  revalidatePath("/", "layout");
}

export interface InvitationActionState {
  error?: "invalidEmail" | "alreadyExists" | "unexpected";
  link?: string;
  email?: string;
}

// The link (CreateInvitationResponse.url) only ever exists as this call's
// direct return value — the API stores nothing but the token's hash, so
// there is no later endpoint that could hand it back. It has to be returned
// to the dialog here and rendered immediately, once, or it's gone for good.
export async function createInvitationAction(
  _prev: InvitationActionState | undefined,
  formData: FormData
): Promise<InvitationActionState> {
  await requireAdmin();
  const email = String(formData.get("email") ?? "").trim();
  const role = (String(formData.get("role") ?? "user") || "user") as Role;
  if (!email) return { error: "invalidEmail" };

  try {
    const result = await api.createInvitation(email, role);
    // Revalidate now, before returning: closing the dialog later won't
    // trigger a fresh fetch on its own, so the pending invitation needs to
    // already be in the cached data by the time the user next looks.
    revalidatePath("/admin/usuarios");
    // result.url points at the Go API's own origin (it builds the link from
    // its own request's Host header, with no idea a separate frontend now
    // serves /invitacion) — rebuild it against wherever this app is actually
    // being accessed from, using the same token.
    const token = new URL(result.url).searchParams.get("token") ?? "";
    const h = await headers();
    const proto = h.get("x-forwarded-proto") ?? "http";
    const host = h.get("host");
    const link = host
      ? `${proto}://${host}/invitacion?token=${encodeURIComponent(token)}`
      : result.url;
    return { link, email: result.invitation.email };
  } catch (err) {
    if (err instanceof ApiError) {
      if (err.code === "already_exists") return { error: "alreadyExists" };
      if (err.code === "invalid_body") return { error: "invalidEmail" };
    }
    return { error: "unexpected" };
  }
}
