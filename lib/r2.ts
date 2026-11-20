// Enforce server-only execution boundary to guarantee R2 credentials and S3 operations remain server-side
if (typeof window !== "undefined") {
  throw new Error("Cannot import lib/r2 from a Client Component. R2 credentials must remain server-only.");
}

try {
  if (typeof process !== "undefined" && process.env.NODE_ENV !== "test") {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("server-only");
  }
} catch {
  // Ignore in standalone Node.js test runners where react-server condition is not set
}

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

function getR2Credentials() {
  const accountId = process.env.R2_ACCOUNT_ID || process.env.CLOUDFLARE_R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID || process.env.CLOUDFLARE_R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY || process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY;
  const bucketName = process.env.R2_BUCKET_NAME || process.env.CLOUDFLARE_R2_BUCKET_NAME;

  if (!accountId || !accessKeyId || !secretAccessKey || !bucketName) {
    throw new Error(
      "[R2 Configuration Error] Missing required Cloudflare R2 environment variables (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME)."
    );
  }

  return { accountId, accessKeyId, secretAccessKey, bucketName };
}

let s3ClientInstance: S3Client | null = null;

export function getR2Client(): S3Client {
  if (s3ClientInstance) return s3ClientInstance;

  const { accountId, accessKeyId, secretAccessKey } = getR2Credentials();

  s3ClientInstance = new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  });

  return s3ClientInstance;
}

export function getR2BucketName(): string {
  const { bucketName } = getR2Credentials();
  return bucketName;
}

/**
 * Generates a presigned PUT URL for browser-to-R2 direct upload.
 * Expiration: strictly 5 minutes (300 seconds).
 *
 * NOTE: ContentLength is intentionally omitted from PutObjectCommand here so that
 * `content-length` is not added to `X-Amz-SignedHeaders`. In browsers, Content-Length
 * is a forbidden header name that cannot be set manually via XHR/fetch; signing it
 * causes signature mismatches. Size enforcement is handled via client validation,
 * server action pre-checks, and authoritative R2 HeadObject verification upon confirmation.
 */
export async function getUploadUrl(
  key: string,
  contentType: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _contentLength?: number
): Promise<string> {
  const client = getR2Client();
  const bucket = getR2BucketName();

  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    ContentType: contentType,
  });

  return getSignedUrl(client, command, {
    expiresIn: 300,
    signableHeaders: new Set(["host", "content-type"]),
  });
}

/**
 * Generates a presigned GET URL for secure attachment download.
 * Expiration: strictly 5 minutes (300 seconds).
 * Forced Content-Disposition: attachment; filename*=UTF8''<encoded>
 * Guarantee: never opens inline in the browser, eliminating stored XSS risks.
 */
export async function getDownloadUrl(
  key: string,
  originalFileName: string
): Promise<string> {
  const client = getR2Client();
  const bucket = getR2BucketName();

  // Encode RFC 5987 filename safely
  const encodedFileName = encodeURIComponent(originalFileName);
  // Also provide an ASCII fallback for legacy clients
  const asciiFallback = originalFileName.replace(/[^a-zA-Z0-9._-]/g, "_") || "attachment";

  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: key,
    ResponseContentDisposition: `attachment; filename="${asciiFallback}"; filename*=UTF8''${encodedFileName}`,
  });

  return getSignedUrl(client, command, { expiresIn: 300 });
}

/**
 * Authoritatively retrieves metadata for an object in R2.
 * Used before writing database metadata to verify the file was actually uploaded
 * and read its true byte length.
 */
export async function headObject(
  key: string
): Promise<{ contentLength: number; contentType?: string }> {
  const client = getR2Client();
  const bucket = getR2BucketName();

  const command = new HeadObjectCommand({
    Bucket: bucket,
    Key: key,
  });

  const response = await client.send(command);

  return {
    contentLength: response.ContentLength ?? 0,
    contentType: response.ContentType,
  };
}

/**
 * Deletes a single object from Cloudflare R2.
 */
export async function deleteObject(key: string): Promise<void> {
  if (!key) return;
  const client = getR2Client();
  const bucket = getR2BucketName();

  const command = new DeleteObjectCommand({
    Bucket: bucket,
    Key: key,
  });

  await client.send(command);
}

/**
 * Batch deletes multiple objects from Cloudflare R2 (up to 1,000 per request).
 */
export async function deleteObjects(keys: string[]): Promise<void> {
  const validKeys = keys.filter(Boolean);
  if (validKeys.length === 0) return;

  const client = getR2Client();
  const bucket = getR2BucketName();

  // AWS S3 DeleteObjectsCommand max limit is 1,000 objects per call
  const chunkSize = 1000;
  for (let i = 0; i < validKeys.length; i += chunkSize) {
    const chunk = validKeys.slice(i, i + chunkSize);
    const command = new DeleteObjectsCommand({
      Bucket: bucket,
      Delete: {
        Objects: chunk.map((Key) => ({ Key })),
        Quiet: true,
      },
    });

    await client.send(command);
  }
}
