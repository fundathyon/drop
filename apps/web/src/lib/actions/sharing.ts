"use server";

import { revalidatePath } from "next/cache";
import { api, ApiError } from "@/lib/api";
import { requireUser } from "@/lib/session";
import type { ShareAccess } from "@/lib/types";

// Sharing is not a property of a drop: the API grants access to a *node*, and
// a grant on a folder reaches everything under it — including whatever is
// added later. These actions live here rather than in a route's own actions
// module because both the explorer (folders) and the drop page call them with
// nothing but a path.

export interface UnshareState {
  error?: string;
}

// Surfaces the API's own message: there is no dialog around the remove button
// to translate a fixed error key against, same as deleteNodeAction.
export async function unshareAction(
  path: string,
  userId: number,
  owner: number | undefined
): Promise<UnshareState | void> {
  await requireUser();
  try {
    await api.unshareNode(path, userId, owner);
  } catch (err) {
    return { error: err instanceof ApiError ? err.message : "unexpected" };
  }
  revalidatePath("/", "layout");
}

// useActionState-driven: returns a small set of known keys the dialog
// translates itself, never the raw API message, so the text always comes out
// in the current locale.
export interface ShareState {
  error?: "userRequired" | "unexpected";
}

export async function shareAction(
  path: string,
  formData: FormData,
  owner: number | undefined
): Promise<ShareState> {
  await requireUser();
  const userId = Number(formData.get("user_id"));
  if (!userId || !Number.isFinite(userId) || userId <= 0) {
    return { error: "userRequired" };
  }
  const access = (String(formData.get("access") ?? "viewer") || "viewer") as ShareAccess;

  try {
    await api.shareNode(path, userId, access, owner);
  } catch {
    return { error: "unexpected" };
  }
  revalidatePath("/", "layout");
  return {};
}
