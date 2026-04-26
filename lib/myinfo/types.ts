// Data types shared between Myinfo parsing and the financial profile abstraction

export interface FinancialProfile {
  source: "myinfo" | "manual";
  // CPF balances
  cpfOaBalance:       number | null;
  cpfSaBalance:       number | null;
  cpfMaBalance:       number | null;
  // CPF housing
  cpfUsedForHousing:  number | null;  // principal withdrawn for housing
  // Income proxy: average of last few months of CPF contribution history
  monthlyContribution: number | null;
  // HDB loan
  outstandingLoanBalance: number | null;
  monthlyLoanInstalment:  number | null;
  // Spouse CPF (manual entry only — Myinfo covers primary applicant)
  spouseCpfOaBalance:      number | null;
  spouseCpfUsedForHousing: number | null;
  // HDB flat info (non-sensitive metadata only)
  hdbFlat: {
    type:                  string;
    address:               string;
    purchasePrice:         number | null;
    loanGranted:           number | null;
    leaseCommencementYear: number | null;
  } | null;
}

// Raw shape of the Myinfo v4 Person API response (after JWE decrypt + JWS verify)
export interface MyinfoPersonData {
  cpfbalances?: {
    oa?: { value?: number };
    sa?: { value?: number };
    ma?: { value?: number };
  };
  cpfcontributions?: {
    history?: Array<{
      month?:    { value?: string };
      amount?:   { value?: number };
      employer?: { value?: string };
    }>;
  };
  cpfhousingwithdrawal?: {
    withdrawaldetails?: Array<{
      principalwithdrawalamt?: { value?: number };
      monthlyinstalmentamt?:   { value?: number };
      accruedinterestamt?:     { value?: number };
      totalcpfallowedforproperty?: { value?: number };
    }>;
  };
  hdbownership?: Array<{
    hdbtype?:              { code?: string; desc?: string };
    address?: {
      block?:   { value?: string };
      street?:  { value?: string };
      floor?:   { value?: string };
      unit?:    { value?: string };
      postal?:  { value?: string };
    };
    outstandingloanbalance?:  { value?: number };
    monthlyloaninstalment?:   { value?: number };
    loangranted?:             { value?: number };
    purchaseprice?:           { value?: number };
    leasecommencementdate?:   { value?: string };
  }>;
}
