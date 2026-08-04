"use server";

import { revalidatePath } from "next/cache";
import { api } from "@/lib/api";
import { requireUser } from "@/lib/session";
import { typeOf } from "@/lib/filetype";

export interface SaveFileState {
  error?: "unexpected";
}

export async function saveFileAction(
  path: string,
  name: string,
  formData: FormData,
  owner: number | undefined
): Promise<SaveFileState> {
  await requireUser();

  // A textarea always submits CRLF regardless of the platform it's typed on;
  // normalize back to LF before it ever reaches the API.
  const raw = String(formData.get("content") ?? "");
  const normalized = raw.replace(/\r\n/g, "\n");

  const type = typeOf(name);
  const upload = new FormData();
  upload.append("file", new File([normalized], name, { type: type.contentType }));

  try {
    await api.uploadFiles(path, upload, owner);
  } catch {
    return { error: "unexpected" };
  }
  revalidatePath("/", "layout");
  return {};
}
