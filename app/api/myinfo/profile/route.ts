// GET  — return the current session financial profile (or null)
// POST — save a manually-entered financial profile to the session cookie
// DELETE is handled by the /logout route

import { NextRequest, NextResponse } from "next/server";
import { decryptProfile, encryptProfile, SESSION_COOKIE } from "@/lib/myinfo/session";
import type { FinancialProfile } from "@/lib/myinfo/types";

export async function GET(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return NextResponse.json(null);
  const profile = await decryptProfile(token);
  return NextResponse.json(profile);
}

export async function POST(req: NextRequest) {
  let body: Partial<FinancialProfile>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Only allow manual-source saves — never let a client claim Myinfo source
  const profile: FinancialProfile = {
    source:                 "manual",
    cpfOaBalance:           toNum(body.cpfOaBalance),
    cpfSaBalance:           toNum(body.cpfSaBalance),
    cpfMaBalance:           toNum(body.cpfMaBalance),
    cpfUsedForHousing:      toNum(body.cpfUsedForHousing),
    monthlyContribution:    toNum(body.monthlyContribution),
    outstandingLoanBalance: toNum(body.outstandingLoanBalance),
    monthlyLoanInstalment:  toNum(body.monthlyLoanInstalment),
    hdbFlat:                null,
  };

  const token = await encryptProfile(profile);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure:   process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge:   60 * 60,
    path:     "/",
  });
  return res;
}

function toNum(v: unknown): number | null {
  const n = Number(v);
  return v !== null && v !== undefined && v !== "" && isFinite(n) ? n : null;
}
