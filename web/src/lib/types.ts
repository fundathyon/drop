/** Wire types mirroring the Go API's JSON payloads. */

export type Kind = 'folder' | 'drop';

export type Visibility = 'public' | 'unlisted' | 'private';

/** A folder or drop as seen from a directory listing. */
export interface Node {
  name: string;
  path: string;
  kind: Kind;
}

/** The contents of a drop's `.drop` YAML file. */
export interface DropMeta {
  title: string;
  slug: string;
  entrypoint: string;
  visibility: Visibility;
  created_at: string;
  updated_at: string;
}

/** A regular file stored inside a drop. */
export interface FileInfo {
  name: string;
  size: number;
  content_type: string;
  modified_at: string;
  /** True for the `.drop` descriptor: readable, but maintained by the API. */
  generated: boolean;
}

/** A drop's identity, metadata, and the files that compose it. */
export interface DropDetail extends Node {
  /** Where the drop can be opened; a private drop answers 404 there. */
  url: string;
  meta: DropMeta;
  files: FileInfo[];
}

export interface ListResponse {
  path: string;
  children: Node[];
}

export interface UploadResponse {
  files: FileInfo[];
}

export interface CreateDropInput {
  parent: string;
  name: string;
  title?: string;
  visibility?: Visibility;
  entrypoint?: string;
}

export interface DropMetaPatch {
  title?: string;
  visibility?: Visibility;
  entrypoint?: string;
}
