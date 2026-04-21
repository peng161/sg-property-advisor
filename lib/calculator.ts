import { HDB_RESALE_PRICES, EC_OPTIONS, PRIVATE_CONDO_OPTIONS } from "./mockData";
import type { PrivatePrices } from "./fetchPrivate";

export function fmt(n: number): string {
  return n.toLocaleString("en-SG");
}

export function fmtPrice(n: number): string {
  if (n >= 1_000_000) return `S$${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1_000) return `S$${(n / 1_000).toFixed(0)}K`;
  return `S$${n}`;
}

const FLAT_BEDROOMS: Record<string, string> = {
  "3-Room":    "2-bedroom",
  "4-Room":    "3-bedroom",
  "5-Room":    "3-bedroom (larger)",
  "Executive": "3-bedroom + study",
};

export interface AssessmentInput {
  flatType:       string;
  town:           string;
  estimatedValue: number;
  remainingLoan:  number;
  myIncome:       number;
  wifeIncome:     number;
}

export interface LivePrices {
  hdb:     Record<string, number> | null; // flatType → median price for user's town
  private: PrivatePrices | null;          // median price by OCR / RCR / CCR
}

export interface UpgradeOption {
  type:             "Stay" | "Bigger HDB" | "EC" | "Private Condo";
  label:            string;
  affordable:       boolean;
  priceRange:       string;
  monthlyRepayment: string;
  notes:            string;
}

export interface AssessmentResult {
  combinedIncome:    number;
  cashProceeds:      number;
  maxHdbLoan:        number;
  maxBankLoan:       number;
  hdbBudget:         number;
  privateBudget:     number;
  currentMarketValue: number;
  recommendation:    "Stay" | "Bigger HDB" | "EC" | "Private Condo";
  options:           UpgradeOption[];
  dataSource: {
    hdb:     "live" | "mock";
    private: "live" | "mock";
  };
}

function maxLoanAmount(monthlyPayment: number, annualRate: number, years: number): number {
  const r = annualRate / 12;
  const n = years * 12;
  return Math.round(monthlyPayment * ((1 - Math.pow(1 + r, -n)) / r));
}

function monthlyRepayment(loanAmount: number, annualRate: number, years: number): number {
  const r = annualRate / 12;
  const n = years * 12;
  return Math.round((loanAmount * r) / (1 - Math.pow(1 + r, -n)));
}

export function assess(input: AssessmentInput, live?: LivePrices): AssessmentResult {
  const combinedIncome = input.myIncome + input.wifeIncome;
  const cashProceeds   = Math.max(0, input.estimatedValue - input.remainingLoan);

  const maxHdbLoan   = maxLoanAmount(combinedIncome * 0.30, 0.026, 25);
  const maxBankLoan  = maxLoanAmount(combinedIncome * 0.55, 0.035, 25);
  const hdbBudget    = cashProceeds + maxHdbLoan;
  const privateBudget = cashProceeds + maxBankLoan;

  // HDB prices: prefer live data, fall back to mock
  const hdbPrices    = live?.hdb ?? HDB_RESALE_PRICES[input.town] ?? {};
  const hdbSource    = live?.hdb ? "live" : "mock";

  const currentMarketValue =
    hdbPrices[input.flatType] ?? input.estimatedValue;

  const options: UpgradeOption[] = [];

  // 1. Stay
  options.push({
    type: "Stay",
    label: "Stay in Current Flat",
    affordable: true,
    priceRange: `Est. ${fmtPrice(currentMarketValue)} · ${FLAT_BEDROOMS[input.flatType] ?? ""}`,
    monthlyRepayment: input.remainingLoan > 0
      ? `S$${monthlyRepayment(input.remainingLoan, 0.026, 20).toLocaleString("en-SG")}/mo (existing loan)`
      : "No outstanding loan",
    notes: "No upgrade cost. Preserves cash and CPF. Good if market is uncertain.",
  });

  // 2. Bigger HDB
  const flatOrder    = ["3-Room", "4-Room", "5-Room", "Executive"];
  const nextFlatType = flatOrder[flatOrder.indexOf(input.flatType) + 1];
  const biggerHdbPrice = nextFlatType ? (hdbPrices[nextFlatType] ?? null) : null;

  if (biggerHdbPrice) {
    const loanNeeded = Math.max(0, biggerHdbPrice - cashProceeds);
    const affordable = biggerHdbPrice <= hdbBudget;
    options.push({
      type: "Bigger HDB",
      label: `Upgrade to ${nextFlatType} HDB`,
      affordable,
      priceRange: `~${fmtPrice(biggerHdbPrice)} · ${FLAT_BEDROOMS[nextFlatType] ?? ""} · ${input.town}`,
      monthlyRepayment: `S$${monthlyRepayment(loanNeeded, 0.026, 25).toLocaleString("en-SG")}/mo`,
      notes: affordable
        ? `Loan needed: ${fmtPrice(loanNeeded)}. Within HDB loan limits.`
        : `Requires ${fmtPrice(biggerHdbPrice)} — exceeds your HDB budget of ${fmtPrice(hdbBudget)}.`,
    });
  }

  // 3. EC
  const ecEligible  = combinedIncome <= 16000;
  const affordableEc = EC_OPTIONS.find((ec) => ec.price <= privateBudget);
  options.push({
    type: "EC",
    label: "Executive Condominium (EC)",
    affordable: ecEligible && !!affordableEc,
    priceRange: affordableEc
      ? `${fmtPrice(affordableEc.price)} · ${affordableEc.bedrooms} · ${affordableEc.location}`
      : `${fmtPrice(1_200_000)} – ${fmtPrice(1_400_000)} · 3–4 bedroom`,
    monthlyRepayment: affordableEc
      ? `S$${monthlyRepayment(Math.max(0, affordableEc.price - cashProceeds), 0.035, 25).toLocaleString("en-SG")}/mo`
      : "—",
    notes: !ecEligible
      ? `Not eligible — combined income S$${fmt(combinedIncome)} exceeds S$16,000 ceiling.`
      : affordableEc
      ? `${affordableEc.name} is within reach.`
      : `ECs start ~${fmtPrice(1_200_000)} — your private budget is ${fmtPrice(privateBudget)}.`,
  });

  // 4. Private Condo — use live prices if available
  const privatePrices = live?.private;
  const privateSource = live?.private ? "live" : "mock";

  const liveCondoOptions = privatePrices
    ? [
        { name: "OCR Condo (Outside Central Region)", minPrice: privatePrices.ocr,  maxPrice: Math.round(privatePrices.ocr  * 1.5), region: "Suburbs",     bedrooms: "2–4 bedroom" },
        { name: "RCR Condo (Rest of Central Region)", minPrice: privatePrices.rcr,  maxPrice: Math.round(privatePrices.rcr  * 1.5), region: "City Fringe", bedrooms: "1–3 bedroom" },
        { name: "CCR Condo (Core Central Region)",    minPrice: privatePrices.ccr,  maxPrice: Math.round(privatePrices.ccr  * 1.5), region: "Prime",       bedrooms: "1–3 bedroom" },
      ]
    : PRIVATE_CONDO_OPTIONS;

  const affordablePrivate = liveCondoOptions.find((p) => p.minPrice <= privateBudget);
  options.push({
    type: "Private Condo",
    label: "Private Condominium",
    affordable: !!affordablePrivate,
    priceRange: affordablePrivate
      ? `${fmtPrice(affordablePrivate.minPrice)} – ${fmtPrice(affordablePrivate.maxPrice)} · ${affordablePrivate.bedrooms} · ${affordablePrivate.region}`
      : `${fmtPrice(1_200_000)}+`,
    monthlyRepayment: affordablePrivate
      ? `S$${monthlyRepayment(Math.max(0, affordablePrivate.minPrice - cashProceeds), 0.035, 25).toLocaleString("en-SG")}/mo`
      : "—",
    notes: affordablePrivate
      ? `${affordablePrivate.name} is achievable. Your budget: ${fmtPrice(privateBudget)}.`
      : `Private condos start ~${fmtPrice(1_200_000)} — your bank loan budget is ${fmtPrice(privateBudget)}.`,
  });

  let recommendation: AssessmentResult["recommendation"] = "Stay";
  if (options.find((o) => o.type === "Private Condo")?.affordable) recommendation = "Private Condo";
  else if (options.find((o) => o.type === "EC")?.affordable)        recommendation = "EC";
  else if (options.find((o) => o.type === "Bigger HDB")?.affordable) recommendation = "Bigger HDB";

  return {
    combinedIncome,
    cashProceeds,
    maxHdbLoan,
    maxBankLoan,
    hdbBudget,
    privateBudget,
    currentMarketValue,
    recommendation,
    options,
    dataSource: { hdb: hdbSource, private: privateSource },
  };
}
