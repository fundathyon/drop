"use server";

import { revalidatePath } from "next/cache";
import { getLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { api, ApiError } from "@/lib/api";
import { requireUser } from "@/lib/session";
import { parentOf } from "@/lib/format";
import type { Visibility } from "@/lib/types";

// Toast-style actions (bound into a ConfirmAction or a plain button in a
// small client component): on failure they surface the API's own message
// directly, same as deleteNodeAction/setUserActiveAction next door in the
// explorer and users pages — there's no dialog around these, so there's
// nothing to translate a fixed error key against.
export interface ActionState {
  error?: string;
}

export async function deleteDropAction(
  path: string,
  owner: number | undefined
): Promise<ActionState | void> {
  await requireUser();
  try {
    await api.deleteNode(path, owner);
  } catch (err) {
    return { error: err instanceof ApiError ? err.message : "unexpected" };
  }
  // The page we're on no longer exists once this succeeds — redirect to the
  // parent folder instead of revalidating in place.
  return redirect({
    href: `/${parentOf(path)}${owner ? `?owner=${owner}` : ""}`,
    locale: await getLocale(),
  });
}

export async function deleteFileAction(
  fullPath: string,
  owner: number | undefined
): Promise<ActionState | void> {
  await requireUser();
  try {
    await api.deleteFile(fullPath, owner);
  } catch (err) {
    return { error: err instanceof ApiError ? err.message : "unexpected" };
  }
  revalidatePath("/", "layout");
}

export async function activateVersionAction(
  path: string,
  seq: number,
  owner: number | undefined
): Promise<ActionState | void> {
  await requireUser();
  try {
    await api.activateDropVersion(path, seq, owner);
  } catch (err) {
    return { error: err instanceof ApiError ? err.message : "unexpected" };
  }
  revalidatePath("/", "layout");
}

// useActionState-driven dialogs (edit-meta, upload): these return a
// fixed, small set of known error keys that the dialog translates itself
// (`t(\`namespace.error.${error}\`)`), the same convention createInvitationAction
// uses next door in admin/usuarios/actions.ts — never the raw API message,
// so the text always comes out in the current locale.

export interface PatchDropState {
  error?: "unexpected";
}

export async function patchDropAction(
  path: string,
  formData: FormData,
  owner: number | undefined
): Promise<PatchDropState> {
  await requireUser();
  const title = String(formData.get("title") ?? "").trim();
  const visibility = String(formData.get("visibility") ?? "") as Visibility;
  const entrypoint = String(formData.get("entrypoint") ?? "").trim();

  try {
    await api.patchDrop(path, { title, visibility, entrypoint }, owner);
  } catch {
    return { error: "unexpected" };
  }
  revalidatePath("/", "layout");
  return {};
}

export interface UploadFilesState {
  error?: "noFile" | "unexpected";
}

export async function uploadFilesAction(
  path: string,
  formData: FormData,
  owner: number | undefined
): Promise<UploadFilesState> {
  await requireUser();
  const files = formData.getAll("file").filter((entry): entry is File => entry instanceof File && entry.size > 0);
  if (files.length === 0) return { error: "noFile" };

  const upload = new FormData();
  for (const file of files) upload.append("file", file);

  try {
    await api.uploadFiles(path, upload, owner);
  } catch {
    return { error: "unexpected" };
  }
  revalidatePath("/", "layout");
  return {};
}
