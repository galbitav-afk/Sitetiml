import "server-only";
import { NextResponse } from "next/server";

/**
 * Optional shared password. When APP_PASSWORD is set, every API call must send
 * it in the x-app-password header — this stops strangers who find the URL from
 * spending your API credits.
 */
export function checkAuth(req: Request): NextResponse | null {
  const expected = process.env.APP_PASSWORD;
  if (!expected) return null;
  if (req.headers.get("x-app-password") === expected) return null;
  return NextResponse.json({ error: "סיסמה שגויה" }, { status: 401 });
}

export function errorResponse(message: string, status = 500) {
  return NextResponse.json({ error: message }, { status });
}
