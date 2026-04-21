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

// Standard Singapore agent fees (CEA guidelines)
const SELLER_AGENT_RATE = 0.02;  // 2% of sale price
const BUYER_AGENT_RATE  = 0.01;  // 1% of purchase price
const LEGAL_FEE_SELLING = 2500;
const LEGAL_FEE_BUYING  = 3000;

export interface AssessmentInput {
  flatType:      string;
  town:          string;
  purchasePrice: number;              // what you originally paid
  purchaseYear:  number;              // year you bought it
  remainingLoan: number;
  myIncome:      number;
  wifeIncome:    number;
  citizenship:   "SC" | "PR" | "Foreigner";
  sellingFirst:  boolean;             // selling current HDB before buying new?
}

export interface LivePrices {
  hdb:     Record<string, number> | null;
  private: PrivatePrices | null;
}

export interface CostBreakdown {
  downPayment: number;
  bsd:         number;
  absd:        number;
  agentFee:    number;
  legalFee:    number;
  total:       number;
}

export interface UpgradeOption {
  type:             "Stay" | "Bigger HDB" | "EC" | "Private Condo";
  label:            string;
  affordable:       boolean;
  priceRange:       string;
  monthlyRepayment: string;
  notes:            string;
  costs:            CostBreakdown;
}

export interface SellingCosts {
  agentFee: number;
  legalFee: number;
  total:    number;
}

export interface AssessmentResult {
  combinedIncome:     number;
  currentMarketValue: number;
  capitalGain:        number;
  sellingCosts:       SellingCosts;
  netProceeds:        number;
  cashProceeds:       number;   // alias for netProceeds
  maxHdbLoan:         number;
  maxBankLoan:        number;
  hdbBudget:          number;
  privateBudget:      number;
  recommendation:     "Stay" | "Bigger HDB" | "EC" | "Private Condo";
  options:            UpgradeOption[];
  dataSource: {
    hdb:     "live" | "mock";
    private: "live" | "mock";
  };
}

// BSD (Buyer's Stamp Duty) — 2024 residential rates
function calcBSD(price: number): number {
  const slabs = [
    { limit: 180_000,   rate: 0.01 },
    { limit: 180_000,   rate: 0.02 },
    { limit: 640_000,   rate: 0.03 },
    { limit: 500_000,   rate: 0.04 },
    { limit: 1_500_000, rate: 0.05 },
  ];
  let bsd = 0;
  let remaining = price;
  for (const slab of slabs) {
    if (remaining <= 0) break;
    const taxable = Math.min(remaining, slab.limit);
    bsd += taxable * slab.rate;
    remaining -= taxable;
  }
  if (remaining > 0) bsd += remaining * 0.06;
  return Math.round(bsd);
}

// ABSD (Additional Buyer's Stamp Duty) — 2024 rates
function calcABSD(price: number, citizenship: string, isSecondProperty: boolean): number {
  if (citizenship === "SC" && !isSecondProperty) return 0;
  if (citizenship === "SC")                       return Math.round(price * 0.20);
  if (citizenship === "PR" && !isSecondProperty)  return Math.round(price * 0.05);
  if (citizenship === "PR")                       return Math.round(price * 0.30);
  return Math.round(price * 0.60); // Foreigner
}

// If live HDB price unavailable, estimate using avg 3.5% annual appreciation
function estimateCurrentValue(purchasePrice: number, purchaseYear: number): number {
  const years = Math.max(0, new Date().getFullYear() - purchaseYear);
  return Math.round(purchasePrice * Math.pow(1.035, years));
}

function maxLoanAmount(monthlyPayment: number, annualRate: number, years: number): number {
  const r = annualRate / 12;
  const n = years * 12;
  return Math.round(monthlyPayment * ((1 - Math.pow(1 + r, -n)) / r));
}

function calcMonthlyRepayment(loanAmount: number, annualRate: number, years: number): number {
  if (loanAmount <= 0) return 0;
  const r = annualRate / 12;
  const n = years * 12;
  return Math.round((loanAmount * r) / (1 - Math.pow(1 + r, -n)));
}

export function assess(input: AssessmentInput, live?: LivePrices): AssessmentResult {
  const combinedIncome = input.myIncome + input.wifeIncome;

  // Current market value: live HDB data > mock data > appreciation estimate
  const hdbPrices = live?.hdb ?? HDB_RESALE_PRICES[input.town] ?? {};
  const hdbSource = live?.hdb ? "live" : "mock";

  const currentMarketValue =
    hdbPrices[input.flatType] ??
    estimateCurrentValue(input.purchasePrice, input.purchaseYear);

  const capitalGain = currentMarketValue - input.purchasePrice;

  // Selling costs (paid when you sell your current flat)
  const sellingAgentFee = Math.round(currentMarketValue * SELLER_AGENT_RATE);
  const sellingCosts: SellingCosts = {
    agentFee: sellingAgentFee,
    legalFee: LEGAL_FEE_SELLING,
    total:    sellingAgentFee + LEGAL_FEE_SELLING,
  };

  // Net proceeds = sale price - outstanding loan - selling costs
  const netProceeds = Math.max(0, currentMarketValue - input.remainingLoan - sellingCosts.total);

  // Loan limits
  const maxHdbLoan   = maxLoanAmount(combinedIncome * 0.30, 0.026, 25);
  const maxBankLoan  = maxLoanAmount(combinedIncome * 0.55, 0.035, 25);
  const hdbBudget    = netProceeds + maxHdbLoan;
  const privateBudget = netProceeds + maxBankLoan;

  // ABSD: if selling current HDB first, treat new purchase as 1st property for SC/PR
  const isSecondProperty = !input.sellingFirst;

  const options: UpgradeOption[] = [];

  // 1. Stay
  options.push({
    type: "Stay",
    label: "Stay in Current Flat",
    affordable: true,
    priceRange: `Est. ${fmtPrice(currentMarketValue)} · ${FLAT_BEDROOMS[input.flatType] ?? ""}`,
    monthlyRepayment: input.remainingLoan > 0
      ? `S$${calcMonthlyRepayment(input.remainingLoan, 0.026, 20).toLocaleString("en-SG")}/mo`
      : "No outstanding loan",
    notes: "No upgrade cost. Capital gain: " + fmtPrice(capitalGain) + " since purchase.",
    costs: { downPayment: 0, bsd: 0, absd: 0, agentFee: 0, legalFee: 0, total: 0 },
  });

  // 2. Bigger HDB
  const flatOrder    = ["3-Room", "4-Room", "5-Room", "Executive"];
  const nextFlatType = flatOrder[flatOrder.indexOf(input.flatType) + 1];
  const biggerHdbPrice = nextFlatType ? (hdbPrices[nextFlatType] ?? null) : null;

  if (biggerHdbPrice) {
    const downPayment  = Math.round(biggerHdbPrice * 0.20);
    const bsd          = calcBSD(biggerHdbPrice);
    const absd         = 0; // HDB upgrader selling first: ABSD not applicable
    const agentFee     = Math.round(biggerHdbPrice * BUYER_AGENT_RATE);
    const legalFee     = LEGAL_FEE_BUYING;
    const upfrontTotal = downPayment + bsd + absd + agentFee + legalFee;
    const loanNeeded   = Math.max(0, biggerHdbPrice - downPayment);
    const affordable   = netProceeds >= upfrontTotal && biggerHdbPrice <= hdbBudget;

    options.push({
      type: "Bigger HDB",
      label: `Upgrade to ${nextFlatType} HDB`,
      affordable,
      priceRange: `~${fmtPrice(biggerHdbPrice)} · ${FLAT_BEDROOMS[nextFlatType] ?? ""} · ${input.town}`,
      monthlyRepayment: `S$${calcMonthlyRepayment(loanNeeded, 0.026, 25).toLocaleString("en-SG")}/mo`,
      notes: affordable
        ? `Upfront: ${fmtPrice(upfrontTotal)} (incl. BSD ${fmtPrice(bsd)}). Your net proceeds: ${fmtPrice(netProceeds)}.`
        : `Upfront needed: ${fmtPrice(upfrontTotal)} — net proceeds ${fmtPrice(netProceeds)} may fall short.`,
      costs: { downPayment, bsd, absd, agentFee, legalFee, total: upfrontTotal },
    });
  }

  // 3. EC (income ceiling S$16,000, SC/PR only)
  const ecEligible  = combinedIncome <= 16_000 && input.citizenship !== "Foreigner";
  const affordableEc = EC_OPTIONS.find((ec) => ec.price <= privateBudget);
  const ecPrice      = affordableEc?.price ?? 1_280_000;
  const ecDown       = Math.round(ecPrice * 0.25);
  const ecBsd        = calcBSD(ecPrice);
  // SC upgrader selling HDB first: ABSD remittable for new EC
  const ecAbsd       = ecEligible && input.sellingFirst ? 0 : calcABSD(ecPrice, input.citizenship, isSecondProperty);
  const ecAgent      = Math.round(ecPrice * BUYER_AGENT_RATE);
  const ecLegal      = LEGAL_FEE_BUYING;
  const ecUpfront    = ecDown + ecBsd + ecAbsd + ecAgent + ecLegal;

  options.push({
    type: "EC",
    label: "Executive Condominium (EC)",
    affordable: ecEligible && !!affordableEc && netProceeds >= ecUpfront,
    priceRange: affordableEc
      ? `${fmtPrice(affordableEc.price)} · ${affordableEc.bedrooms} · ${affordableEc.location}`
      : `${fmtPrice(1_200_000)} – ${fmtPrice(1_400_000)} · 3–4 bedroom`,
    monthlyRepayment: affordableEc
      ? `S$${calcMonthlyRepayment(Math.max(0, ecPrice - ecDown), 0.035, 25).toLocaleString("en-SG")}/mo`
      : "—",
    notes: !ecEligible
      ? `Not eligible — income S$${fmt(combinedIncome)} exceeds S$16,000 ceiling.`
      : affordableEc
      ? `Upfront: ${fmtPrice(ecUpfront)} (ABSD: ${fmtPrice(ecAbsd)}). Net proceeds: ${fmtPrice(netProceeds)}.`
      : `ECs start ~${fmtPrice(1_200_000)} — your budget is ${fmtPrice(privateBudget)}.`,
    costs: { downPayment: ecDown, bsd: ecBsd, absd: ecAbsd, agentFee: ecAgent, legalFee: ecLegal, total: ecUpfront },
  });

  // 4. Private Condo
  const privateSource    = live?.private ? "live" : "mock";
  const liveCondoOptions = live?.private
    ? [
        { name: "OCR Condo (Outside Central Region)", minPrice: live.private.ocr, maxPrice: Math.round(live.private.ocr * 1.5), region: "Suburbs",     bedrooms: "2–4 bedroom" },
        { name: "RCR Condo (Rest of Central Region)", minPrice: live.private.rcr, maxPrice: Math.round(live.private.rcr * 1.5), region: "City Fringe", bedrooms: "1–3 bedroom" },
        { name: "CCR Condo (Core Central Region)",    minPrice: live.private.ccr, maxPrice: Math.round(live.private.ccr * 1.5), region: "Prime",       bedrooms: "1–3 bedroom" },
      ]
    : PRIVATE_CONDO_OPTIONS;

  const affordablePrivate = liveCondoOptions.find((p) => p.minPrice <= privateBudget);
  const condoPrice   = affordablePrivate?.minPrice ?? 1_400_000;
  const condoDown    = Math.round(condoPrice * 0.25);
  const condoBsd     = calcBSD(condoPrice);
  const condoAbsd    = calcABSD(condoPrice, input.citizenship, isSecondProperty);
  const condoAgent   = Math.round(condoPrice * BUYER_AGENT_RATE);
  const condoLegal   = LEGAL_FEE_BUYING;
  const condoUpfront = condoDown + condoBsd + condoAbsd + condoAgent + condoLegal;

  options.push({
    type: "Private Condo",
    label: "Private Condominium",
    affordable: !!affordablePrivate && netProceeds >= condoUpfront,
    priceRange: affordablePrivate
      ? `${fmtPrice(affordablePrivate.minPrice)} – ${fmtPrice(affordablePrivate.maxPrice)} · ${affordablePrivate.bedrooms} · ${affordablePrivate.region}`
      : `${fmtPrice(1_200_000)}+`,
    monthlyRepayment: affordablePrivate
      ? `S$${calcMonthlyRepayment(Math.max(0, condoPrice - condoDown), 0.035, 25).toLocaleString("en-SG")}/mo`
      : "—",
    notes: affordablePrivate
      ? `Upfront: ${fmtPrice(condoUpfront)} (ABSD: ${fmtPrice(condoAbsd)}). Net proceeds: ${fmtPrice(netProceeds)}.`
      : `Private condos start ~${fmtPrice(1_200_000)} — budget: ${fmtPrice(privateBudget)}.`,
    costs: { downPayment: condoDown, bsd: condoBsd, absd: condoAbsd, agentFee: condoAgent, legalFee: condoLegal, total: condoUpfront },
  });

  let recommendation: AssessmentResult["recommendation"] = "Stay";
  if (options.find((o) => o.type === "Private Condo")?.affordable) recommendation = "Private Condo";
  else if (options.find((o) => o.type === "EC")?.affordable)        recommendation = "EC";
  else if (options.find((o) => o.type === "Bigger HDB")?.affordable) recommendation = "Bigger HDB";

  return {
    combinedIncome,
    currentMarketValue,
    capitalGain,
    sellingCosts,
    netProceeds,
    cashProceeds: netProceeds,
    maxHdbLoan,
    maxBankLoan,
    hdbBudget,
    privateBudget,
    recommendation,
    options,
    dataSource: { hdb: hdbSource, private: privateSource },
  };
}
