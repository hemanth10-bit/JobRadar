import { createClient } from "@supabase/supabase-js";
import { isSupabaseConfigured } from "./db.js";

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

let anonClientInstance: ReturnType<typeof createClient> | null = null;

function getAnonClient() {
  if (!anonClientInstance) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anonKey) {
      throw new Error("Supabase anon credentials missing");
    }
    anonClientInstance = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
  }
  return anonClientInstance;
}

/**
 * Resolves the authenticated caller's user id from the Authorization bearer token.
 * Returns null when Supabase isn't configured (demo mode has no real backend auth)
 * or when no token was presented.
 */
export async function getRequestUserId(req: { headers: Record<string, any> }): Promise<string | null> {
  if (!isSupabaseConfigured()) {
    return null;
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return null;
  }

  const token = authHeader.substring(7);
  try {
    const supabase = getAnonClient();
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data?.user) {
      return null;
    }
    return data.user.id;
  } catch (err) {
    console.warn("Failed to verify bearer token:", err);
    return null;
  }
}

/**
 * Resolves the effective userId for a request, enforcing identity when Supabase
 * is configured. In demo mode (no Supabase), falls back to trusting the
 * client-supplied userId since there's no real backend auth or real user data.
 */
export async function resolveUserId(
  req: { headers: Record<string, any> },
  claimedUserId: string | undefined | null
): Promise<string> {
  const verifiedUserId = await getRequestUserId(req);

  if (verifiedUserId) {
    if (claimedUserId && claimedUserId !== verifiedUserId) {
      throw new HttpError(403, "userId does not match authenticated user");
    }
    return verifiedUserId;
  }

  if (!isSupabaseConfigured()) {
    if (!claimedUserId) {
      throw new HttpError(400, "Missing userId");
    }
    return claimedUserId;
  }

  throw new HttpError(401, "Missing or invalid authorization token");
}

/**
 * Wraps an async Express route handler so thrown HttpErrors (and other errors)
 * are translated into the right response instead of crashing the process.
 */
export function asyncHandler(
  fn: (req: any, res: any) => Promise<any>
): (req: any, res: any) => Promise<void> {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (err: any) {
      if (err instanceof HttpError) {
        res.status(err.status).json({ error: err.message });
      } else {
        console.error("Unhandled route error:", err);
        res.status(500).json({ error: err.message || "Internal server error" });
      }
    }
  };
}
