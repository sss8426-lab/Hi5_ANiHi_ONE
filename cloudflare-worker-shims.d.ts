interface D1Result<T = Record<string, unknown>> {
  results?: T[];
  success?: boolean;
  meta?: Record<string, unknown>;
}

interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(columnName?: string): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  run(): Promise<D1Result>;
  raw<T = unknown[]>(): Promise<T[]>;
}

interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch<T = Record<string, unknown>>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
  exec(query: string): Promise<D1Result>;
}

interface R2ObjectBody {
  size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
  httpMetadata?: R2PutOptions['httpMetadata'];
  body: ReadableStream;
  httpEtag: string;
  writeHttpMetadata(headers: Headers): void;
  json<T = unknown>(): Promise<T>;
}

interface R2PutOptions {
  httpMetadata?: {
    contentType?: string;
    contentDisposition?: string;
    contentEncoding?: string;
    contentLanguage?: string;
    cacheControl?: string;
    cacheExpiry?: Date;
  };
  customMetadata?: Record<string, string>;
}

interface R2Object {
  key: string;
  size: number;
  etag: string;
}

interface R2Objects {
  objects: R2Object[];
  truncated: boolean;
  cursor?: string;
}

interface R2UploadedPart {
  partNumber: number;
  etag: string;
}

interface R2MultipartUpload {
  key: string;
  uploadId: string;
  uploadPart(partNumber: number, value: unknown): Promise<R2UploadedPart>;
  complete(uploadedParts: R2UploadedPart[]): Promise<R2Object>;
  abort(): Promise<void>;
}

interface R2Bucket {
  head(key: string): Promise<R2Object | null>;
  put(key: string, value: unknown, options?: R2PutOptions): Promise<unknown>;
  get(key: string): Promise<R2ObjectBody | null>;
  list(options?: { cursor?: string }): Promise<R2Objects>;
  delete(keys: string | string[]): Promise<void>;
  createMultipartUpload(key: string, options?: R2PutOptions): Promise<R2MultipartUpload>;
  resumeMultipartUpload(key: string, uploadId: string): R2MultipartUpload;
}

interface Fetcher {
  fetch(input: Request | string | URL, init?: RequestInit): Promise<Response>;
}

declare module "cloudflare:workers" {
  export const env: {
    DB?: D1Database;
    FILES?: R2Bucket;
    [key: string]: unknown;
  };
}
