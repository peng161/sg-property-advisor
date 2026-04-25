// Handles the Singpass OAuth callback.
// 1. Verifies CSRF state
// 2. Exchanges code for access token (with DPoP + client assertion)
// 3. Verifies access token JWS
// 4. Fetches encrypted person data, decrypts JWE, verifies inner JWS
// 5. Parses CPF/HDB attributes into FinancialProfile
// 6. Stores encrypted profile in session cookie
// 7. Redirects back to app

import { NextRequest, NextResponse } from "next/server";
import {
  importDpopPrivateKey,
  importDpopPublicKey,
  generateDpopProof,
  generateClientAssertion,
  verifyJwsAndGetPayload,
  decryptJwe,
} from "@/lib/myinfo/crypto";
import { getUrls } from "@/lib/myinfo/config";
import { encryptProfile, SESSION_COOKIE, PENDING_COOKIE } from "@/lib/myinfo/session";
import { parseMyinfoProfile } from "@/lib/myinfo/parse";
import type { MyinfoPersonData } from "@/lib/myinfo/types";
import type { JWK } from "jose";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const code      = searchParams.get("code");
  const state     = searchParams.get("state");
  const errorCode = searchParams.get("error");

  // User cancelled or Singpass returned an error
  if (errorCode) {
    const returnUrl = getPendingReturnUrl(req) ?? "/results";
    return redirectWithError(returnUrl, errorCode);
  }

  if (!code || !state) {
    return NextResponse.json({ error: "Missing code or state" }, { status: 400 });
  }

  // ── Validate CSRF state ────────────────────────────────────────────────────
  const pendingRaw = req.cookies.get(PENDING_COOKIE)?.value;
  if (!pendingRaw) {
    return NextResponse.json({ error: "Session expired — please try again" }, { status: 400 });
  }

  let pending: {
    codeVerifier: string;
    state:        string;
    nonce:        string;
    privateJwk:   JWK;
    publicJwk:    JWK;
    returnUrl:    string;
  };
  try {
    pending = JSON.parse(pendingRaw);
  } catch {
    return NextResponse.json({ error: "Invalid session data" }, { status: 400 });
  }

  if (state !== pending.state) {
    return NextResponse.json({ error: "State mismatch — possible CSRF" }, { status: 400 });
  }

  const { TOKEN_URL, PERSON_URL, AUTHORIZE_JWKS, MYINFO_JWKS } = getUrls();
  const clientId     = process.env.MYINFO_CLIENT_ID!;
  const redirectUri  = process.env.MYINFO_REDIRECT_URI!;
  const signingKeyPem   = process.env.MYINFO_CLIENT_SIGNING_KEY_PEM!;
  const encryptionKeyPem = process.env.MYINFO_CLIENT_ENCRYPTION_KEY_PEM!;
  const kid          = process.env.MYINFO_CLIENT_ASSERTION_KID ?? "myinfo-key";

  try {
    // ── Reconstruct DPoP key pair ────────────────────────────────────────────
    const dpopPrivateKey = await importDpopPrivateKey(pending.privateJwk);
    const dpopPublicKey  = await importDpopPublicKey(pending.publicJwk);
    const { publicJwk }  = pending;

    // ── Client assertion JWT (bound to DPoP public key) ───────────────────────
    const clientAssertion = await generateClientAssertion(
      clientId, TOKEN_URL, signingKeyPem, kid, publicJwk
    );

    // ── DPoP proof for token endpoint ────────────────────────────────────────
    const dpopForToken = await generateDpopProof(dpopPrivateKey, publicJwk, "POST", TOKEN_URL);

    // ── Exchange auth code for access token ───────────────────────────────────
    const tokenRes = await fetch(TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Cache-Control": "no-cache",
        "DPoP": dpopForToken,
      },
      body: new URLSearchParams({
        grant_type:              "authorization_code",
        code,
        redirect_uri:            redirectUri,
        client_id:               clientId,
        code_verifier:           pending.codeVerifier,
        client_assertion_type:   "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
        client_assertion:        clientAssertion,
      }),
    });

    if (!tokenRes.ok) {
      const body = await tokenRes.text();
      // Do NOT log — body may contain personal data hints
      return redirectWithError(pending.returnUrl, `token_error_${tokenRes.status}`);
    }

    const tokenJson = await tokenRes.json() as { access_token?: string };
    const accessToken = tokenJson.access_token;
    if (!accessToken) {
      return redirectWithError(pending.returnUrl, "no_access_token");
    }

    // ── Verify access token JWS (issued by authorise server) ─────────────────
    const tokenPayload = await verifyJwsAndGetPayload(accessToken, AUTHORIZE_JWKS);
    const sub = tokenPayload.sub as string;
    if (!sub) {
      return redirectWithError(pending.returnUrl, "no_sub_in_token");
    }

    // ── DPoP proof for Person API (includes ATH claim) ───────────────────────
    const personUrl  = `${PERSON_URL}/${sub}`;
    const dpopForPerson = await generateDpopProof(
      dpopPrivateKey, publicJwk, "GET", personUrl, accessToken
    );

    // ── Fetch encrypted person data ───────────────────────────────────────────
    const personRes = await fetch(
      `${personUrl}?scope=${encodeURIComponent(
        "cpfbalances cpfcontributions cpfhousingwithdrawal hdbownership"
      )}`,
      {
        headers: {
          "Authorization": `DPoP ${accessToken}`,
          "DPoP":          dpopForPerson,
          "Cache-Control": "no-cache",
        },
      }
    );

    if (!personRes.ok) {
      return redirectWithError(pending.returnUrl, `person_error_${personRes.status}`);
    }

    const encryptedBody = await personRes.text();

    // ── Decrypt JWE ───────────────────────────────────────────────────────────
    const decryptedJws = await decryptJwe(encryptedBody, encryptionKeyPem);

    // ── Verify inner JWS (signed by Myinfo) ───────────────────────────────────
    const personData = await verifyJwsAndGetPayload(decryptedJws, MYINFO_JWKS);

    // ── Parse into FinancialProfile (never log this object) ───────────────────
    const profile = parseMyinfoProfile(personData as unknown as MyinfoPersonData);
    const sessionToken = await encryptProfile(profile);

    // ── Clear pending cookie, set session cookie, redirect ────────────────────
    const res = NextResponse.redirect(new URL(pending.returnUrl, req.nextUrl.origin));
    res.cookies.delete(PENDING_COOKIE);
    res.cookies.set(SESSION_COOKIE, sessionToken, {
      httpOnly: true,
      secure:   process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge:   60 * 60, // 1 hour
      path:     "/",
    });
    return res;

  } catch (err) {
    // Log the type of error but never the error message (may contain personal data)
    console.error("[myinfo/callback] error type:", (err as Error)?.name ?? "unknown");
    return redirectWithError(pending.returnUrl, "internal_error");
  }
}

function getPendingReturnUrl(req: NextRequest): string | null {
  try {
    const raw = req.cookies.get(PENDING_COOKIE)?.value;
    if (!raw) return null;
    return JSON.parse(raw).returnUrl ?? null;
  } catch {
    return null;
  }
}

function redirectWithError(returnUrl: string, code: string): NextResponse {
  const url = new URL(returnUrl, "http://placeholder");
  url.searchParams.set("myinfo_error", code);
  // returnUrl already has a host-relative path; rebuild properly in the response
  const res = NextResponse.redirect(
    returnUrl.startsWith("http")
      ? `${returnUrl}?myinfo_error=${code}`
      : `${returnUrl}${returnUrl.includes("?") ? "&" : "?"}myinfo_error=${code}`
  );
  res.cookies.delete(PENDING_COOKIE);
  return res;
}
