import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, DeleteObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { AssetError } from "./image";

export type AssetStorage = {
  put(key: string, bytes: Buffer): Promise<void>;
  get(key: string): Promise<Buffer | null>;
  head(key: string): Promise<boolean>;
  delete(key: string): Promise<void>;
  list(cursor?: string): Promise<{ objects: Array<{ key: string; modifiedAt: Date }>; cursor?: string }>;
};
function isMissing(error: unknown) {
  return typeof error === "object" && error !== null && "name" in error && ["NoSuchKey", "NotFound"].includes(String(error.name));
}
export function assetStorage(): AssetStorage {
  const bucket = process.env.ASSET_STORAGE_BUCKET;
  const endpoint = process.env.ASSET_STORAGE_ENDPOINT;
  const accessKeyId = process.env.ASSET_STORAGE_ACCESS_KEY;
  const secretAccessKey = process.env.ASSET_STORAGE_SECRET_KEY;
  if (!bucket || !accessKeyId || !secretAccessKey) throw new AssetError(503, "Image storage is not configured");
  if (endpoint && !/^https?:\/\//.test(endpoint)) throw new AssetError(503, "Image storage is not configured");
  const client = new S3Client({ region: process.env.ASSET_STORAGE_REGION || "us-east-1", endpoint,
    forcePathStyle: process.env.ASSET_STORAGE_PATH_STYLE === "true", credentials: { accessKeyId, secretAccessKey }, maxAttempts: 2 });
  const invoke = <T>(operation: () => Promise<T>) => operation().catch(() => { throw new AssetError(503, "Image storage is temporarily unavailable"); });
  return {
    put: (Key, Body) => invoke(async () => { await client.send(new PutObjectCommand({ Bucket: bucket, Key, Body, ContentType: "image/webp" }), { abortSignal: AbortSignal.timeout(10000) }); }),
    get: Key => invoke(async () => {
      try {
        const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key }), { abortSignal: AbortSignal.timeout(10000) });
        if (!result.Body) return null;
        if ((result.ContentLength ?? 0) > 5 * 1024 * 1024) throw new Error("Object exceeds image limit");
        const chunks: Uint8Array[] = [];
        let size = 0;
        for await (const chunk of result.Body as AsyncIterable<Uint8Array>) {
          size += chunk.length;
          if (size > 5 * 1024 * 1024) { if ('destroy' in result.Body && typeof result.Body.destroy === "function") result.Body.destroy(); throw new Error("Object exceeds image limit"); }
          chunks.push(chunk);
        }
        return Buffer.concat(chunks);
      } catch (error) { if (isMissing(error)) return null; throw error; }
    }),
    head: Key => invoke(async () => { try { await client.send(new HeadObjectCommand({ Bucket: bucket, Key }), { abortSignal: AbortSignal.timeout(10000) }); return true; } catch (error) { if (isMissing(error)) return false; throw error; } }),
    delete: Key => invoke(async () => { await client.send(new DeleteObjectCommand({ Bucket: bucket, Key }), { abortSignal: AbortSignal.timeout(10000) }); }),
    list: cursor => invoke(async () => {
      const result = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: "assets/", MaxKeys: 100, ContinuationToken: cursor }), { abortSignal: AbortSignal.timeout(10000) });
      return { objects: (result.Contents ?? []).filter(item => item.Key && item.LastModified).map(item => ({ key: item.Key!, modifiedAt: item.LastModified! })), cursor: result.NextContinuationToken };
    })
  };
}
