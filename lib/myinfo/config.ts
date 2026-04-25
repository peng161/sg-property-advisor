// Myinfo v4 API — environment URLs and scopes

const SANDBOX = {
  AUTHORISE_URL:    "https://test.authorise.singpass.gov.sg/auth",
  TOKEN_URL:        "https://test.api.myinfo.gov.sg/com/v4/token",
  PERSON_URL:       "https://test.api.myinfo.gov.sg/com/v4/person",
  AUTHORIZE_JWKS:   "https://test.authorise.singpass.gov.sg/.well-known/keys.json",
  MYINFO_JWKS:      "https://test.myinfo.singpass.gov.sg/.well-known/keys.json",
};

const PRODUCTION = {
  AUTHORISE_URL:    "https://authorise.singpass.gov.sg/auth",
  TOKEN_URL:        "https://api.myinfo.gov.sg/com/v4/token",
  PERSON_URL:       "https://api.myinfo.gov.sg/com/v4/person",
  AUTHORIZE_JWKS:   "https://authorise.singpass.gov.sg/.well-known/keys.json",
  MYINFO_JWKS:      "https://myinfo.singpass.gov.sg/.well-known/keys.json",
};

// Scopes that map to CPF and HDB data in the Myinfo data catalogue
export const MYINFO_SCOPES =
  "cpfbalances cpfcontributions cpfhousingwithdrawal hdbownership";

export function getUrls() {
  return process.env.MYINFO_ENV === "production" ? PRODUCTION : SANDBOX;
}

export function isMyinfoConfigured(): boolean {
  return !!(
    process.env.MYINFO_CLIENT_ID &&
    process.env.MYINFO_REDIRECT_URI &&
    process.env.MYINFO_CLIENT_SIGNING_KEY_PEM &&
    process.env.MYINFO_CLIENT_ENCRYPTION_KEY_PEM &&
    process.env.MYINFO_SESSION_SECRET
  );
}
