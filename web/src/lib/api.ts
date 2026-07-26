import type {
  CreateDropInput,
  DropDetail,
  DropMetaPatch,
  ListResponse,
  Node,
  UploadResponse,
} from './types';

/** Empty means same-origin: the dev server proxies /v1 to the Go API. */
const BASE = import.meta.env.PUBLIC_DROP_API_URL ?? '';

/** An error carrying the API's stable machine-readable `code`. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string | undefined;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

const JSON_HEADERS = { 'Content-Type': 'application/json' };

function url(path: string, params?: Record<string, string>): string {
  const qs = params ? `?${new URLSearchParams(params).toString()}` : '';
  return `${BASE}${path}${qs}`;
}

async function request<T>(target: string, init?: RequestInit): Promise<T> {
  const res = await fetch(target, init);
  if (res.status === 204) return undefined as T;

  const isJSON = (res.headers.get('content-type') ?? '').includes('application/json');
  const body = isJSON ? await res.json().catch(() => null) : null;

  if (!res.ok) {
    const err: { code?: string; message?: string } = body ?? {};
    throw new ApiError(err.message ?? res.statusText ?? 'request failed', res.status, err.code);
  }
  return body as T;
}

export const api = {
  /** List the folders and drops directly under `path` ("" is the root). */
  listNodes: (path: string) => request<ListResponse>(url('/v1/nodes', { path })),

  createFolder: (parent: string, name: string) =>
    request<Node>(url('/v1/nodes'), {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ parent, name }),
    }),

  /** Delete a folder or drop, recursively. */
  deleteNode: (path: string) => request<void>(url('/v1/nodes', { path }), { method: 'DELETE' }),

  getDrop: (path: string) => request<DropDetail>(url('/v1/drops', { path })),

  createDrop: (input: CreateDropInput) =>
    request<DropDetail>(url('/v1/drops'), {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify(input),
    }),

  patchDrop: (path: string, patch: DropMetaPatch) =>
    request<DropDetail>(url('/v1/drops', { path }), {
      method: 'PATCH',
      headers: JSON_HEADERS,
      body: JSON.stringify(patch),
    }),

  /** Point the drop's URL back at an earlier version. Nothing is deleted. */
  activateVersion: (path: string, seq: number) =>
    request<DropDetail>(url('/v1/drops/versions/activate', { path }), {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ seq }),
    }),

  uploadFiles: (dropPath: string, files: Iterable<File>) => {
    const form = new FormData();
    for (const file of files) form.append('file', file);
    return request<UploadResponse>(url('/v1/files', { path: dropPath }), {
      method: 'POST',
      body: form,
    });
  },

  deleteFile: (path: string) => request<void>(url('/v1/files', { path }), { method: 'DELETE' }),

  /** Read a file's bytes as text, for editing. */
  readFileText: async (path: string): Promise<string> => {
    const res = await fetch(url('/v1/files', { path }));
    if (!res.ok) {
      throw new ApiError(res.statusText || 'could not read the file', res.status);
    }
    return res.text();
  },

  /**
   * Write text back to a file. The API replaces a file of the same name, so an
   * edit is an upload of one file — there is no separate write endpoint.
   */
  writeFileText: (dropPath: string, name: string, content: string, contentType: string) =>
    api.uploadFiles(dropPath, [new File([content], name, { type: contentType })]),

  /** Direct link used to open a stored file in a new tab. */
  fileUrl: (path: string) => url('/v1/files', { path }),
};
