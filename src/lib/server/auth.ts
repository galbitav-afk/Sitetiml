import "server-only";
import { createClient, type User } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/**
 * Every API route requires a signed-in Supabase user (the browser sends its
 * access token as a Bearer header). Optionally ALLOWED_EMAILS restricts who
 * may spend the site's AI credits, since anyone with the link can register.
 */
export async function requireUser(
  req: Request,
): Promise<{ user: User; error?: undefined } | { user?: undefined; error: NextResponse }> {
  if (!url || !anonKey) {
    return { error: jsonError("השרת לא מוגדר: חסרים NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY.", 500) };
  }
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return { error: jsonError("נדרשת התחברות", 401) };

  const supabase = createClient(url, anonKey, { auth: { persistSession: false } });
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) return { error: jsonError("ההתחברות פגה. התחבר מחדש.", 401) };

  const allowed = (process.env.ALLOWED_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  if (allowed.length && !allowed.includes((data.user.email ?? "").toLowerCase())) {
    return { error: jsonError("החשבון הזה לא מורשה להשתמש בעיבוד AI באתר. פנה למנהל האתר.", 403) };
  }
  return { user: data.user };
}

export function jsonError(message: string, status = 500) {
  return NextResponse.json({ error: message }, { status });
}
