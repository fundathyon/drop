"use server";

import { revalidatePath } from "next/cache";
import { getLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { api, ApiError } from "@/lib/api";
import { requireUser } from "@/lib/session";
import type { Visibility } from "@/lib/types";

export interface ActionState {
  error?: string;
}

function ownerOf(formData: FormData): number | undefined {
  const raw = formData.get("owner");
  const owner = raw ? Number(raw) : 0;
  return owner || undefined;
}

export async function createFolderAction(
  _prev: ActionState | undefined,
  formData: FormData
): Promise<ActionState> {
  await requireUser();
  const parent = String(formData.get("parent") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const owner = ownerOf(formData);
  if (!name) return { error: "invalid_path" };

  try {
    await api.createFolder(parent, name, owner);
  } catch (err) {
    return { error: err instanceof ApiError ? err.code : "unexpected" };
  }
  revalidatePath("/", "layout");
  // A fresh object each call, distinct from the initial `undefined` state and
  // from any previous success — this is the signal the dialog's
  // useCloseOnSuccess reacts to (returning the same `undefined` a failed
  // validation would leave in place could never be told apart from "nothing
  // happened yet").
  return {};
}

export async function createDropAction(
  _prev: ActionState | undefined,
  formData: FormData
): Promise<ActionState | undefined> {
  await requireUser();
  const parent = String(formData.get("parent") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const owner = ownerOf(formData);
  if (!name) return { error: "invalid_path" };

  let path: string;
  try {
    const detail = await api.createDrop(
      {
        parent,
        name,
        title: String(formData.get("title") ?? ""),
        visibility: (String(formData.get("visibility") ?? "public") || "public") as Visibility,
        entrypoint: String(formData.get("entrypoint") ?? ""),
      },
      owner
    );
    path = detail.path;
  } catch (err) {
    return { error: err instanceof ApiError ? err.code : "unexpected" };
  }

  const files = formData.getAll("files").filter((entry): entry is File => entry instanceof File && entry.size > 0);
  if (files.length > 0) {
    const upload = new FormData();
    for (const file of files) upload.append("file", file);
    try {
      await api.uploadFiles(path, upload, owner);
    } catch {
      // The drop itself was already created successfully — an upload hiccup
      // here shouldn't strand the user on an error for a create that already
      // succeeded. They land on the drop page either way and can retry via
      // the Upload dialog there.
    }
  }

  return redirect({
    href: `/drop/${path}${owner ? `?owner=${owner}` : ""}`,
    locale: await getLocale(),
  });
}

export async function deleteNodeAction(
  path: string,
  owner: number | undefined
): Promise<ActionState | undefined> {
  await requireUser();
  try {
    await api.deleteNode(path, owner);
  } catch (err) {
    return { error: err instanceof ApiError ? err.message : "unexpected" };
  }
  revalidatePath("/", "layout");
}
