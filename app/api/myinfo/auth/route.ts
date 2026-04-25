// Initiates the Myinfo OAuth 2.0 + PKCE flow.
// Stores PKCE code_verifier, state, and DPoP ephemeral keys in a short-lived
// httpOnly pending cookie, then redirects to the Singpass authorise URL.

import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import {
  generateCodeVerifier,
  generateCodeChallenge,
  generateState,
  generateDpopKeyPair,
  exportDpopKeyPair,
} from "@/lib/myinfo/crypto";
import { getUrls, isMyinfoConfigured, MYINFO_SCOPES } from "@/lib/myinfo/config";
import { PENDING_COOKIE } from "@/lib/myinfo/session";

export async function GET(req: NextRequest) {
  if (!isMyinfoConfigured()) {
    return NextResponse.json({ error: "Myinfo not configured" }, { status: 503 });
  }

  const { AUTHORISE_URL } = getUrls();
  const clientId   = process.env.MYINFO_CLIENT_ID!;
  const redirectUri = process.env.MYINFO_REDIRECT_URI!;
  const purposeId  = process.env.MYINFO_PURPOSE_ID ?? "";

  // Return URL — where to land after successful auth
  const returnUrl = req.nextUrl.searchParams.get("returnUrl") ?? "/results";

  const codeVerifier    = generateCodeVerifier();
  const codeChallenge   = generateCodeChallenge(codeVerifier);
  const state           = generateState();
  const nonce           = randomBytes(16).toString("hex");

  // Ephemeral DPoP key pair — persisted through the redirect
  const dpopPair = await generateDpopKeyPair();
  const { privateJwk, publicJwk } = await exportDpopKeyPair(dpopPair);

  // Store PKCE + DPoP state in a short-lived httpOnly cookie
  const pending = JSON.stringify({ codeVerifier, state, nonce, privateJwk, publicJwk, returnUrl });

  const params = new URLSearchParams({
    response_type:          "code",
    client_id:              clientId,
    redirect_uri:           redirectUri,
    scope:                  MYINFO_SCOPES,
    code_challenge:         codeChallenge,
    code_challenge_method:  "S256",
    state,
    nonce,
    ...(purposeId ? { purpose_id: purposeId } : {}),
  });

  const authoriseUrl = `${AUTHORISE_URL}?${params.toString()}`;

  const res = NextResponse.redirect(authoriseUrl);
  res.cookies.set(PENDING_COOKIE, pending, {
    httpOnly: true,
    secure:   process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge:   10 * 60, // 10 minutes — enough time to complete Singpass login
    path:     "/",
  });
  return res;
}
