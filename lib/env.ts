// ── Centralized Environment Variable Validation ──
// Enforces presence and structure of required environment variables without leaking secret values.

export interface ServerEnv {
  NODE_ENV: "development" | "production" | "test";
  DATABASE_URL: string;
  DIRECT_URL?: string;
  CLERK_SECRET_KEY: string;
  CLERK_WEBHOOK_SIGNING_SECRET?: string;
  // Cloudflare R2 Storage (Ticket 2 — Task Attachments)
  R2_ACCOUNT_ID?: string;
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
  R2_BUCKET_NAME?: string;
  R2_PUBLIC_BASE_URL?: string;
  // Legacy aliases for backward compatibility
  CLOUDFLARE_R2_ACCOUNT_ID?: string;
  CLOUDFLARE_R2_ACCESS_KEY_ID?: string;
  CLOUDFLARE_R2_SECRET_ACCESS_KEY?: string;
  CLOUDFLARE_R2_BUCKET_NAME?: string;
  CLOUDFLARE_R2_PUBLIC_URL?: string;
}

export interface ClientEnv {
  NEXT_PUBLIC_APP_URL?: string;
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: string;
  NEXT_PUBLIC_CLERK_SIGN_IN_URL?: string;
  NEXT_PUBLIC_CLERK_SIGN_UP_URL?: string;
}

function validatePostgresUrl(name: string, url: string | undefined, isRequired = true): string | undefined {
  if (!url) {
    if (isRequired) {
      throw new Error(`[Env Error] Missing required database environment variable: ${name}`);
    }
    return undefined;
  }
  if (!url.startsWith("postgres://") && !url.startsWith("postgresql://")) {
    throw new Error(
      `[Env Error] Invalid URL protocol for ${name}. Must begin with 'postgres://' or 'postgresql://'.`
    );
  }
  return url;
}

/**
 * Validates and returns server-side environment variables.
 * MUST only be invoked in server environments (Node.js runtime / Server Components / Actions).
 */
export function getServerEnv(): ServerEnv {
  if (typeof window !== "undefined") {
    throw new Error("[Env Error] getServerEnv() called in browser/client environment. Secrets must remain server-only.");
  }

  const missing: string[] = [];

  const nodeEnv = (process.env.NODE_ENV as ServerEnv["NODE_ENV"]) || "development";

  if (!process.env.DATABASE_URL) missing.push("DATABASE_URL");
  if (!process.env.CLERK_SECRET_KEY) missing.push("CLERK_SECRET_KEY");

  // In production, enforce webhook secret
  const webhookSecret = process.env.CLERK_WEBHOOK_SIGNING_SECRET || process.env.CLERK_WEBHOOK_SECRET;
  if (nodeEnv === "production" && !webhookSecret) {
    missing.push("CLERK_WEBHOOK_SIGNING_SECRET");
  }

  if (missing.length > 0) {
    throw new Error(
      `[Env Error] Missing required server environment variable(s): ${missing.join(", ")}. Please configure them in .env.local or your deployment environment.`
    );
  }

  validatePostgresUrl("DATABASE_URL", process.env.DATABASE_URL, true);
  if (process.env.DIRECT_URL) {
    validatePostgresUrl("DIRECT_URL", process.env.DIRECT_URL, false);
  }

  return {
    NODE_ENV: nodeEnv,
    DATABASE_URL: process.env.DATABASE_URL!,
    DIRECT_URL: process.env.DIRECT_URL,
    CLERK_SECRET_KEY: process.env.CLERK_SECRET_KEY!,
    CLERK_WEBHOOK_SIGNING_SECRET: webhookSecret,
    // Cloudflare R2 Storage (Ticket 2 — Task Attachments)
    R2_ACCOUNT_ID: process.env.R2_ACCOUNT_ID || process.env.CLOUDFLARE_R2_ACCOUNT_ID,
    R2_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID || process.env.CLOUDFLARE_R2_ACCESS_KEY_ID,
    R2_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY || process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY,
    R2_BUCKET_NAME: process.env.R2_BUCKET_NAME || process.env.CLOUDFLARE_R2_BUCKET_NAME,
    R2_PUBLIC_BASE_URL: process.env.R2_PUBLIC_BASE_URL || process.env.CLOUDFLARE_R2_PUBLIC_URL,
    // Legacy aliases
    CLOUDFLARE_R2_ACCOUNT_ID: process.env.R2_ACCOUNT_ID || process.env.CLOUDFLARE_R2_ACCOUNT_ID,
    CLOUDFLARE_R2_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID || process.env.CLOUDFLARE_R2_ACCESS_KEY_ID,
    CLOUDFLARE_R2_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY || process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY,
    CLOUDFLARE_R2_BUCKET_NAME: process.env.R2_BUCKET_NAME || process.env.CLOUDFLARE_R2_BUCKET_NAME,
    CLOUDFLARE_R2_PUBLIC_URL: process.env.R2_PUBLIC_BASE_URL || process.env.CLOUDFLARE_R2_PUBLIC_URL,
  };
}

/**
 * Validates and returns client-accessible environment variables.
 * Safe to invoke in both client and server contexts.
 */
export function getClientEnv(): ClientEnv {
  const publishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

  if (!publishableKey) {
    throw new Error(
      "[Env Error] Missing required public environment variable: NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY. Please configure it in .env.local or your deployment environment."
    );
  }

  return {
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: publishableKey,
    NEXT_PUBLIC_CLERK_SIGN_IN_URL: process.env.NEXT_PUBLIC_CLERK_SIGN_IN_URL || "/sign-in",
    NEXT_PUBLIC_CLERK_SIGN_UP_URL: process.env.NEXT_PUBLIC_CLERK_SIGN_UP_URL || "/sign-up",
  };
}

