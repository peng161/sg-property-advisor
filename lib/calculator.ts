import { HDB_RESALE_PRICES, EC_OPTIONS, PRIVATE_CONDO_OPTIONS } from "./mockData";

export function fmt(n: number): string {
  return n.toLocaleString("en-SG");
}

export interface AssessmentInput {
  flatType: string;
  town: string;
  estimatedValue: number;
  remainingLoan: number;
  myIncome: number;
  wifeIncome: number;
}

export interface UpgradeOption {
  type: "Stay" | "Bigger HDB" | "EC" | "Private Condo";
  label: string;
  affordable: boolean;
  priceRange: string;
  monthlyRepayment: string;
  notes: string;
}

export interface AssessmentResult {
  combinedIncome: number;
  cashProceeds: number;
  maxHdbLoan: number;
  maxBankLoan: number;
  hdbBudget: number;
  privateBudget: number;
  currentMarketValue: number;
  recommendation: "Stay" | "Bigger HDB" | "EC" | "Private Condo";
  options: UpgradeOption[];
}

// Loan amount you can borrow given a max monthly payment
// Uses annuity formula: P = pmt × [(1-(1+r)^-n) / r]
function maxLoanAmount(monthlyPayment: number, annualRate: number, years: number): number {
  const r = annualRate / 12;
  const n = years * 12;
  const factor = (1 - Math.pow(1 + r, -n)) / r;
  return Math.round(monthlyPayment * factor);
}

// Monthly repayment for a given loan
function monthlyRepayment(loanAmount: number, annualRate: number, years: number): number {
  const r = annualRate / 12;
  const n = years * 12;
  return Math.round((loanAmount * r) / (1 - Math.pow(1 + r, -n)));
}

export function assess(input: AssessmentInput): AssessmentResult {
  const combinedIncome = input.myIncome + input.wifeIncome;

  // Equity after selling current flat (simplified: no CPF accrued interest)
  const cashProceeds = Math.max(0, input.estimatedValue - input.remainingLoan);

  // HDB loan: 2.6% p.a., MSR cap = 30% of income, max 25 years, LTV 80%
  const maxMsrPayment = combinedIncome * 0.30;
  const maxHdbLoan = maxLoanAmount(maxMsrPayment, 0.026, 25);

  // Bank loan: 3.5% p.a. (stress-tested), TDSR cap = 55% of income, max 25 years, LTV 75%
  const maxTdsrPayment = combinedIncome * 0.55;
  const maxBankLoan = maxLoanAmount(maxTdsrPayment, 0.035, 25);

  // Total budget for each property type
  const hdbBudget = cashProceeds + maxHdbLoan;
  const privateBudget = cashProceeds + maxBankLoan;

  // Current flat market value for comparison
  const currentMarketValue = HDB_RESALE_PRICES[input.town]?.[input.flatType] ?? input.estimatedValue;

  // --- Build upgrade options ---
  const options: UpgradeOption[] = [];

  // 1. Stay
  options.push({
    type: "Stay",
    label: "Stay in Current Flat",
    affordable: true,
    priceRange: `Est. S$${currentMarketValue.toLocaleString("en-SG")}`,
    monthlyRepayment: `S$${monthlyRepayment(input.remainingLoan, 0.026, 20).toLocaleString("en-SG")}/mo (existing)`,
    notes: "No upgrade cost. Preserves cash and CPF. Good if market is uncertain.",
  });

  // 2. Bigger HDB (next flat type up in same town)
  const flatOrder = ["3-Room", "4-Room", "5-Room", "Executive"];
  const currentIndex = flatOrder.indexOf(input.flatType);
  const nextFlatType = flatOrder[currentIndex + 1];
  const biggerHdbPrice = nextFlatType
    ? (HDB_RESALE_PRICES[input.town]?.[nextFlatType] ?? null)
    : null;

  if (biggerHdbPrice) {
    const loanNeeded = Math.max(0, biggerHdbPrice - cashProceeds);
    const affordable = biggerHdbPrice <= hdbBudget;
    options.push({
      type: "Bigger HDB",
      label: `Upgrade to ${nextFlatType} HDB`,
      affordable,
      priceRange: `~S$${biggerHdbPrice.toLocaleString("en-SG")} (${input.town})`,
      monthlyRepayment: `S$${monthlyRepayment(loanNeeded, 0.026, 25).toLocaleString("en-SG")}/mo`,
      notes: affordable
        ? `Loan needed: S$${loanNeeded.toLocaleString("en-SG")}. Within HDB loan limits.`
        : `Requires S$${biggerHdbPrice.toLocaleString("en-SG")} — exceeds your HDB budget of S$${hdbBudget.toLocaleString("en-SG")}.`,
    });
  }

  // 3. EC (income ceiling S$16,000/month)
  const ecEligible = combinedIncome <= 16000;
  const affordableEc = EC_OPTIONS.find((ec) => ec.price <= privateBudget);
  options.push({
    type: "EC",
    label: "Executive Condominium (EC)",
    affordable: ecEligible && !!affordableEc,
    priceRange: `S$1.2M – S$1.4M (entry level)`,
    monthlyRepayment: affordableEc
      ? `S$${monthlyRepayment(Math.max(0, affordableEc.price - cashProceeds), 0.035, 25).toLocaleString("en-SG")}/mo`
      : "—",
    notes: !ecEligible
      ? `Not eligible — household income S$${combinedIncome.toLocaleString("en-SG")} exceeds S$16,000 ceiling.`
      : affordableEc
      ? `${affordableEc.name} at S$${affordableEc.price.toLocaleString("en-SG")} is within reach.`
      : `ECs start ~S$1.2M — your private budget is S$${privateBudget.toLocaleString("en-SG")}.`,
  });

  // 4. Private Condo
  const affordablePrivate = PRIVATE_CONDO_OPTIONS.find((p) => p.minPrice <= privateBudget);
  options.push({
    type: "Private Condo",
    label: "Private Condominium",
    affordable: !!affordablePrivate,
    priceRange: affordablePrivate
      ? `S$${affordablePrivate.minPrice.toLocaleString("en-SG")} – S$${affordablePrivate.maxPrice.toLocaleString("en-SG")} (${affordablePrivate.region})`
      : "S$1.2M+",
    monthlyRepayment: affordablePrivate
      ? `S$${monthlyRepayment(Math.max(0, affordablePrivate.minPrice - cashProceeds), 0.035, 25).toLocaleString("en-SG")}/mo`
      : "—",
    notes: affordablePrivate
      ? `${affordablePrivate.name} is achievable. Budget S$${privateBudget.toLocaleString("en-SG")}.`
      : `Private condos start ~S$1.2M — your bank loan budget is S$${privateBudget.toLocaleString("en-SG")}.`,
  });

  // --- Top recommendation ---
  let recommendation: AssessmentResult["recommendation"] = "Stay";
  if (options.find((o) => o.type === "Private Condo")?.affordable) {
    recommendation = "Private Condo";
  } else if (options.find((o) => o.type === "EC")?.affordable) {
    recommendation = "EC";
  } else if (options.find((o) => o.type === "Bigger HDB")?.affordable) {
    recommendation = "Bigger HDB";
  }

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
  };
}
