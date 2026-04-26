// Upgrade Suitability Scoring Engine
// Deterministic rule-based scoring — Claude is used ONLY for plain-English explanation.
// Score breakdown is fully transparent; every sub-score has a labelled explanation.

export interface UpgradeScoreInput {
  // ── Current property ──────────────────────────────────────────────────────
  currentMarketValue:     number;
  outstandingLoan:        number;
  cpfUsedForHousing:      number;   // returned to CPF OA on sale
  cpfOaBalance:           number;   // current OA balance
  cashSavings:            number;
  currentFlatType:        string;   // "3-Room" | "4-Room" | "5-Room" | "Executive"
  currentRemainingLease:  number;   // years

  // ── Income & obligations ──────────────────────────────────────────────────
  monthlyGrossIncome:     number;   // combined household
  monthlyCarLoan:         number;
  otherMonthlyDebt:       number;

  // ── Target property ───────────────────────────────────────────────────────
  targetPropertyPrice:    number;
  propertyType:           "HDB" | "EC" | "Condo";
  targetBedrooms:         number;
  targetRemainingLease:   number;   // years (999 or 9999 = freehold)
  targetPropertyAge:      number;   // years since TOP (0 = new launch)

  // ── Costs ─────────────────────────────────────────────────────────────────
  buyerStampDuty:         number;
  legalAndAgentFees:      number;
  renovationBudget:       number;

  // ── Mortgage ──────────────────────────────────────────────────────────────
  expectedMonthlyMortgage: number;
  interestRate:            number;
  loanTenureYears:         number;

  // ── Family ────────────────────────────────────────────────────────────────
  familySize:             number;
  numChildren:            number;
  hasSchoolAgeChildren:   boolean;
  distanceToParentsKm:    number | null;
  distanceToSchoolKm:     number | null;

  // ── Market signals ────────────────────────────────────────────────────────
  transactionDemand:      "High" | "Medium" | "Low";   // for current home
  liquidity:              "High" | "Medium" | "Low";   // for target market
  priceTrend:             "Rising" | "Stable" | "Falling";

  // ── Mode ──────────────────────────────────────────────────────────────────
  conservativeMode:       boolean;

  // ── Optional PSF market check ──────────────────────────────────────────
  marketPsfEstimate?: {
    estimated_psf_low:  number;
    estimated_psf_mid:  number;
    estimated_psf_high: number;
    confidence:         "High" | "Medium" | "Low";
  };
}

export interface ScoreItem {
  label:       string;
  score:       number;
  maxScore:    number;
  explanation: string;
}

export interface CategoryScore {
  name:       string;
  score:      number;
  maxScore:   number;
  weight:     string;  // e.g. "35%"
  items:      ScoreItem[];
  color:      string;  // tailwind colour name
}

export interface KeyMetrics {
  sellingCosts:            number;
  netCashProceeds:         number;   // cash in hand after selling current home
  cpfOaAfterRefund:        number;   // CPF OA balance after CPF refund on sale
  totalLiquidBeforePurchase: number;
  downPayment:             number;
  totalUpfrontRequired:    number;
  cpfForPurchase:          number;   // CPF OA used for purchase costs
  cashForPurchase:         number;   // cash used for purchase
  cashAfterPurchase:       number;   // emergency reserve
  surplus:                 number;
  surplusRatio:            number;   // surplus / totalUpfrontRequired
  TDSR:                    number;   // (mortgage + car + other) / income
  MSR:                     number;   // mortgage / income
  totalMonthlyObligations: number;
  estimatedLivingExpenses: number;
  bufferMonths:            number;   // months of cash reserve
}

export interface UpgradeScoreResult {
  totalScore:           number;
  decisionLabel:        string;
  decisionColor:        string;       // tailwind colour
  categoryScores:       CategoryScore[];
  keyMetrics:           KeyMetrics;
  topReasonsToUpgrade:  string[];
  topRisks:             string[];
  suggestedNextStep:    string;
  conservativeMode:     boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function clamp(n: number, min: number, max: number) { return Math.min(Math.max(n, min), max); }

const FLAT_CAPACITY: Record<string, number> = {
  "3-Room":    3,
  "4-Room":    4,
  "5-Room":    5,
  "Executive": 5,
};

// ── Main scoring function ─────────────────────────────────────────────────────

export function computeUpgradeScore(inp: UpgradeScoreInput): UpgradeScoreResult {
  const con = inp.conservativeMode;

  // ── Pre-compute key metrics ──────────────────────────────────────────────

  const sellingCosts = Math.round(inp.currentMarketValue * 0.02 + 2_500); // 2% agent + legal
  const netCashProceeds = Math.max(0, inp.currentMarketValue - inp.outstandingLoan - sellingCosts);

  // CPF refunded to OA when you sell = cpfUsedForHousing (principal only, simplified)
  const cpfOaAfterRefund = inp.cpfOaBalance + inp.cpfUsedForHousing;

  const totalLiquidBeforePurchase = netCashProceeds + cpfOaAfterRefund + inp.cashSavings;

  // LTV: HDB loan 80%, bank loan 75%
  const ltv = inp.propertyType === "HDB" ? 0.80 : 0.75;
  const downPayment = Math.round(inp.targetPropertyPrice * (1 - ltv));
  const totalUpfrontRequired = downPayment + inp.buyerStampDuty + inp.legalAndAgentFees + inp.renovationBudget;

  // CPF OA can cover down payment + BSD + legal (not renovation)
  const cpfEligibleCost = downPayment + inp.buyerStampDuty + inp.legalAndAgentFees;
  const cpfForPurchase = Math.min(cpfOaAfterRefund, cpfEligibleCost);
  const cashForPurchase = Math.max(0, totalUpfrontRequired - cpfForPurchase);
  const cashAfterPurchase = Math.max(0, netCashProceeds + inp.cashSavings - cashForPurchase);

  const surplus = totalLiquidBeforePurchase - totalUpfrontRequired;
  const surplusRatio = totalUpfrontRequired > 0 ? surplus / totalUpfrontRequired : 0;

  const TDSR = inp.monthlyGrossIncome > 0
    ? (inp.expectedMonthlyMortgage + inp.monthlyCarLoan + inp.otherMonthlyDebt) / inp.monthlyGrossIncome
    : 1;
  const MSR = inp.monthlyGrossIncome > 0
    ? inp.expectedMonthlyMortgage / inp.monthlyGrossIncome
    : 1;

  const estimatedLivingExpenses = 1_800 + Math.max(0, inp.familySize - 1) * 500;
  const totalMonthlyObligations = inp.expectedMonthlyMortgage + inp.monthlyCarLoan + inp.otherMonthlyDebt + estimatedLivingExpenses;
  const bufferMonths = totalMonthlyObligations > 0 ? cashAfterPurchase / totalMonthlyObligations : 0;

  const km: KeyMetrics = {
    sellingCosts, netCashProceeds, cpfOaAfterRefund,
    totalLiquidBeforePurchase, downPayment, totalUpfrontRequired,
    cpfForPurchase, cashForPurchase, cashAfterPurchase,
    surplus, surplusRatio, TDSR, MSR,
    totalMonthlyObligations, estimatedLivingExpenses, bufferMonths,
  };

  // ── Category 1: Affordability (35 pts) ───────────────────────────────────

  // 1a. Upfront funding adequacy (12 pts)
  let s1a = 0;
  let e1a = "";
  const sr = surplusRatio;
  if      (sr >= 0.50) { s1a = 12; e1a = "Excellent buffer — 50%+ surplus after all upfront costs"; }
  else if (sr >= 0.25) { s1a = 10; e1a = "Healthy buffer — 25–50% surplus over upfront costs"; }
  else if (sr >= 0.10) { s1a =  7; e1a = "Adequate — 10–25% surplus, some cushion"; }
  else if (sr >= 0.00) { s1a =  4; e1a = "Tight — funds just barely cover upfront costs"; }
  else if (sr >= -0.10) { s1a = 2; e1a = "Shortfall under 10% — small gap to bridge"; }
  else                 { s1a =  0; e1a = "Significant shortfall — insufficient funds for purchase"; }

  // 1b. Monthly repayment affordability (13 pts)
  // Use MSR for HDB (30% cap), TDSR for others (55% cap)
  let s1b = 0;
  let e1b = "";
  const tdsrPct = Math.round(TDSR * 100);
  const msrPct  = Math.round(MSR  * 100);
  if (inp.propertyType === "HDB") {
    const cap = con ? 0.25 : 0.30;
    if      (MSR <= cap * 0.83) { s1b = 13; e1b = `MSR ${msrPct}% — well within the 30% HDB loan limit`; }
    else if (MSR <= cap)        { s1b = 10; e1b = `MSR ${msrPct}% — within the 30% limit`; }
    else if (MSR <= 0.35)       { s1b =  6; e1b = `MSR ${msrPct}% — exceeds 30% HDB cap; bank loan only`; }
    else                        { s1b =  2; e1b = `MSR ${msrPct}% — high repayment burden; affordability risk`; }
  } else {
    const comfortCap = con ? 0.35 : 0.40;
    if      (TDSR <= comfortCap)  { s1b = 13; e1b = `TDSR ${tdsrPct}% — comfortable repayment burden`; }
    else if (TDSR <= 0.45)        { s1b = 10; e1b = `TDSR ${tdsrPct}% — manageable but leaves little slack`; }
    else if (TDSR <= 0.55)        { s1b =  6; e1b = `TDSR ${tdsrPct}% — near the 55% regulatory limit`; }
    else                          { s1b =  2; e1b = `TDSR ${tdsrPct}% — exceeds the 55% MAS limit`; }
  }

  // 1c. Emergency buffer post-purchase (10 pts)
  const bufTarget = con ? 9 : 6;
  let s1c = 0;
  let e1c = "";
  const bm = bufferMonths;
  if      (bm >= bufTarget * 2)  { s1c = 10; e1c = `${bm.toFixed(1)} months cash buffer — very strong safety net`; }
  else if (bm >= bufTarget)      { s1c =  8; e1c = `${bm.toFixed(1)} months buffer — meets the ${bufTarget}-month target`; }
  else if (bm >= bufTarget * 0.5){ s1c =  4; e1c = `${bm.toFixed(1)} months buffer — below target; leaves you exposed`; }
  else if (bm >= 1)              { s1c =  1; e1c = `${bm.toFixed(1)} months buffer — dangerously thin`; }
  else                           { s1c =  0; e1c = "Essentially no cash buffer after purchase"; }

  const cat1Score = s1a + s1b + s1c;
  const cat1: CategoryScore = {
    name: "Affordability", score: cat1Score, maxScore: 35, weight: "35%", color: "emerald",
    items: [
      { label: "Upfront Funding",         score: s1a, maxScore: 12, explanation: e1a },
      { label: "Monthly Repayment",       score: s1b, maxScore: 13, explanation: e1b },
      { label: "Emergency Buffer",        score: s1c, maxScore: 10, explanation: e1c },
    ],
  };

  // ── Category 2: Family Fit (20 pts) ──────────────────────────────────────

  // 2a. Space adequacy (8 pts)
  const capacity = inp.targetBedrooms + 1;
  const spaceRatio = inp.familySize > 0 ? capacity / inp.familySize : 2;
  let s2a = 0; let e2a = "";
  if      (spaceRatio >= 1.5) { s2a = 8; e2a = `${inp.targetBedrooms} bedrooms for ${inp.familySize} — very spacious`; }
  else if (spaceRatio >= 1.2) { s2a = 6; e2a = `${inp.targetBedrooms} bedrooms for ${inp.familySize} — comfortable`; }
  else if (spaceRatio >= 1.0) { s2a = 4; e2a = `${inp.targetBedrooms} bedrooms for ${inp.familySize} — adequate`; }
  else if (spaceRatio >= 0.8) { s2a = 2; e2a = `${inp.targetBedrooms} bedrooms for ${inp.familySize} — a bit cramped`; }
  else                        { s2a = 0; e2a = `${inp.targetBedrooms} bedrooms for ${inp.familySize} — too small`; }

  // 2b. Proximity to parents (6 pts)
  let s2b = 4; let e2b = "Location relative to parents not specified";
  if (inp.distanceToParentsKm !== null) {
    const d = inp.distanceToParentsKm;
    if      (d < 2)  { s2b = 6; e2b = `${d} km to parents — same neighbourhood`; }
    else if (d < 5)  { s2b = 4; e2b = `${d} km to parents — nearby town`; }
    else if (d < 10) { s2b = 2; e2b = `${d} km to parents — manageable distance`; }
    else             { s2b = 0; e2b = `${d} km to parents — far from family support`; }
  }

  // 2c. Proximity to school (6 pts)
  let s2c = 5; let e2c = "No school-age children — not a constraint";
  if (inp.hasSchoolAgeChildren) {
    if (inp.distanceToSchoolKm !== null) {
      const d = inp.distanceToSchoolKm;
      if      (d < 1)  { s2c = 6; e2c = `${d} km to school — within 1 km priority zone`; }
      else if (d < 2)  { s2c = 4; e2c = `${d} km to school — within Phase 2 priority`; }
      else if (d < 5)  { s2c = 2; e2c = `${d} km to school — Phase 3 balloting`; }
      else             { s2c = 0; e2c = `${d} km to school — outside priority phases`; }
    } else {
      s2c = 3; e2c = "School distance not specified; check primary school proximity";
    }
  }

  const cat2Score = s2a + s2b + s2c;
  const cat2: CategoryScore = {
    name: "Family Fit", score: cat2Score, maxScore: 20, weight: "20%", color: "blue",
    items: [
      { label: "Space for Family",        score: s2a, maxScore: 8, explanation: e2a },
      { label: "Near Parents",            score: s2b, maxScore: 6, explanation: e2b },
      { label: "Near School",             score: s2c, maxScore: 6, explanation: e2c },
    ],
  };

  // ── Category 3: Market Timing (20 pts) ───────────────────────────────────

  // 3a. Current home salability (7 pts)
  const demandMap = { High: 7, Medium: 4, Low: con ? 0 : 1 };
  const s3a = demandMap[inp.transactionDemand];
  const e3a = {
    High: "High demand in your area — your current home should sell quickly",
    Medium: "Moderate demand — expect a few months to sell your current home",
    Low: "Low demand — selling your current home may take longer and at lower price",
  }[inp.transactionDemand];

  // 3b. Target market liquidity (7 pts)
  const liqMap = { High: 7, Medium: con ? 3 : 4, Low: con ? 0 : 1 };
  const s3b = liqMap[inp.liquidity];
  const e3b = {
    High:   "Target market is liquid — easy to exit if needed",
    Medium: "Moderate liquidity — exit within reasonable timeframe",
    Low:    "Low liquidity in target market — harder to resell later",
  }[inp.liquidity];

  // 3c. Price trend (6 pts)
  // Rising: good long-term but entry cost is high; Stable: ideal; Falling: risk of further drop
  const trendScores = { Rising: 5, Stable: 6, Falling: 3 };
  const s3c = trendScores[inp.priceTrend];
  const e3c = {
    Rising:  "Prices rising — acting now captures appreciation, though entry cost is high",
    Stable:  "Stable market — predictable pricing, ideal window for a considered purchase",
    Falling: "Prices falling — cheap entry possible, but further declines are a risk",
  }[inp.priceTrend];

  const cat3Score = s3a + s3b + s3c;
  const cat3: CategoryScore = {
    name: "Market Timing", score: cat3Score, maxScore: 20, weight: "20%", color: "amber",
    items: [
      { label: "Current Home Salability", score: s3a, maxScore: 7, explanation: e3a },
      { label: "Target Market Liquidity", score: s3b, maxScore: 7, explanation: e3b },
      { label: "Price Trend",             score: s3c, maxScore: 6, explanation: e3c },
    ],
  };

  // ── Category 4: Property Quality (15 pts) ────────────────────────────────

  // 4a. Remaining lease / tenure (8 pts)
  let s4a = 0; let e4a = "";
  const rl = inp.targetRemainingLease;
  if      (rl >= 999) { s4a = 8; e4a = "Freehold / 999-year — maximum ownership security"; }
  else if (rl >= 90)  { s4a = 7; e4a = `${rl} years remaining — strong leasehold position`; }
  else if (rl >= 70)  { s4a = 5; e4a = `${rl} years remaining — adequate for a 30-year horizon`; }
  else if (rl >= 50)  { s4a = 3; e4a = `${rl} years remaining — CPF and loan restrictions may apply`; }
  else if (rl >= 30)  { s4a = 1; e4a = `${rl} years remaining — significant resale limitations`; }
  else                { s4a = 0; e4a = `${rl} years remaining — very short lease, hard to finance`; }

  // 4b. Property age / maintenance risk (4 pts)
  let s4b = 0; let e4b = "";
  const age = inp.targetPropertyAge;
  if      (age <  5)  { s4b = 4; e4b = "New or near-new — minimal maintenance risk"; }
  else if (age < 15)  { s4b = 3; e4b = `${age} years old — relatively modern`; }
  else if (age < 25)  { s4b = 2; e4b = `${age} years old — some age-related wear expected`; }
  else if (age < 35)  { s4b = 1; e4b = `${age} years old — higher maintenance costs likely`; }
  else                { s4b = 0; e4b = `${age} years old — aging infrastructure; plan for major works`; }

  // 4c. Value efficiency (3 pts) — proxy by type + age
  let s4c = 0; let e4c = "";
  if (inp.propertyType === "EC") {
    s4c = 3; e4c = "EC — subsidised pricing offers strong value";
  } else if (age < 5) {
    s4c = 3; e4c = "New launch — modern layout and energy efficiency";
  } else if (age < 15) {
    s4c = 2; e4c = "Relatively modern resale — good layout and condition";
  } else {
    s4c = 1; e4c = "Older property — may need factoring in renovation or layout trade-offs";
  }

  const cat4Score = s4a + s4b + s4c;
  const cat4: CategoryScore = {
    name: "Property Quality", score: cat4Score, maxScore: 15, weight: "15%", color: "purple",
    items: [
      { label: "Remaining Lease",         score: s4a, maxScore: 8, explanation: e4a },
      { label: "Property Age",            score: s4b, maxScore: 4, explanation: e4b },
      { label: "Value Efficiency",        score: s4c, maxScore: 3, explanation: e4c },
    ],
  };

  // ── Category 5: Strategic Fit (10 pts) ───────────────────────────────────

  // 5a. Does upgrade solve a real problem? (4 pts)
  const currentCap = FLAT_CAPACITY[inp.currentFlatType] ?? 4;
  let s5a = 0; let e5a = "";
  if (inp.familySize > currentCap + 1) {
    s5a = 4; e5a = "Genuinely overcrowded — upgrade is a functional necessity";
  } else if (inp.familySize > currentCap || inp.numChildren >= 3) {
    s5a = 3; e5a = "At or over capacity — upgrade materially improves family living";
  } else if (inp.familySize >= currentCap) {
    s5a = 2; e5a = "At rated capacity — upgrade provides meaningful room to grow";
  } else {
    s5a = 1; e5a = "Current home can still serve your family — upgrade is lifestyle-driven";
  }

  // 5b. Urgency from current home lease (3 pts)
  let s5b = 0; let e5b = "";
  const cl = inp.currentRemainingLease;
  if      (cl < 30) { s5b = 3; e5b = `Only ${cl} yrs remaining — sell now to maximise resale value`; }
  else if (cl < 50) { s5b = 2; e5b = `${cl} yrs left — resale value and CPF eligibility narrowing`; }
  else if (cl < 60) { s5b = 1; e5b = `${cl} yrs remaining — some time pressure on children's loan eligibility`; }
  else              { s5b = 0; e5b = `${cl} yrs remaining — no lease urgency; you have time`; }

  // 5c. Strategic readiness (3 pts)
  let s5c = 0; let e5c = "";
  if (surplusRatio >= 0.20 && TDSR <= 0.45 && inp.priceTrend !== "Falling") {
    s5c = 3; e5c = "Financially ready and market conditions support moving now";
  } else if (surplusRatio >= 0.00 && TDSR <= 0.55) {
    s5c = 2; e5c = "Borderline ready — conditions workable but close to the edge";
  } else if (surplusRatio >= -0.05) {
    s5c = 1; e5c = "Mostly ready but a small gap remains; may need bridging";
  } else {
    s5c = 0; e5c = "Not yet ready — improve savings or reduce debt before committing";
  }

  const cat5Score = s5a + s5b + s5c;
  const cat5: CategoryScore = {
    name: "Strategic Fit", score: cat5Score, maxScore: 10, weight: "10%", color: "indigo",
    items: [
      { label: "Upgrade Solves a Problem", score: s5a, maxScore: 4, explanation: e5a },
      { label: "Current Home Urgency",     score: s5b, maxScore: 3, explanation: e5b },
      { label: "Strategic Readiness",      score: s5c, maxScore: 3, explanation: e5c },
    ],
  };

  // ── Total score ───────────────────────────────────────────────────────────

  let totalScore = cat1Score + cat2Score + cat3Score + cat4Score + cat5Score;

  // Conservative mode: penalise borderline scores (60–70 range)
  if (con && totalScore >= 58 && totalScore <= 72) {
    totalScore = Math.max(totalScore - 5, 55);
  }

  totalScore = clamp(Math.round(totalScore), 0, 100);

  let decisionLabel: string;
  let decisionColor: string;
  if      (totalScore >= 80) { decisionLabel = "Strong Upgrade Candidate"; decisionColor = "emerald"; }
  else if (totalScore >= 65) { decisionLabel = "Can Upgrade, But Check Risks"; decisionColor = "amber"; }
  else if (totalScore >= 50) { decisionLabel = "Wait / Improve Position First"; decisionColor = "orange"; }
  else                       { decisionLabel = "Not Recommended Now"; decisionColor = "red"; }

  // ── Generate reasons and risks ────────────────────────────────────────────

  const reasons: { text: string; score: number }[] = [];
  const risks:   { text: string; score: number }[] = [];

  // Positive signals → reasons to upgrade
  if (surplusRatio >= 0.25)
    reasons.push({ text: "Strong financial buffer — surplus after all upfront costs", score: surplusRatio });
  if (MSR <= 0.25 || (inp.propertyType !== "HDB" && TDSR <= 0.35))
    reasons.push({ text: "Comfortable monthly repayment — well within affordability limits", score: 0.25 - MSR });
  if (bufferMonths >= 6)
    reasons.push({ text: `${bufferMonths.toFixed(1)}-month emergency cash reserve after purchase`, score: bufferMonths });
  if (inp.familySize > currentCap)
    reasons.push({ text: "Current home is genuinely undersized for your family", score: inp.familySize - currentCap });
  if (inp.transactionDemand === "High")
    reasons.push({ text: "Your current home area has high transaction demand — fast exit likely", score: 1 });
  if (inp.priceTrend === "Rising")
    reasons.push({ text: "Market is rising — acting now captures appreciation upside", score: 1 });
  if (inp.targetRemainingLease >= 90)
    reasons.push({ text: `Target property has ${inp.targetRemainingLease}+ years remaining — strong long-term hold`, score: inp.targetRemainingLease });
  if (inp.currentRemainingLease < 50)
    reasons.push({ text: `Current home has only ${inp.currentRemainingLease} years left — better to sell now`, score: 99 - inp.currentRemainingLease });
  if (inp.liquidity === "High")
    reasons.push({ text: "High liquidity in target market — easy exit path if needed", score: 1 });
  if (inp.propertyType === "EC" && inp.monthlyGrossIncome <= 16_000)
    reasons.push({ text: "EC eligibility — subsidised pricing with private-property benefits", score: 1 });

  // Negative signals → risks
  if (surplusRatio < 0)
    risks.push({ text: `Funding shortfall of $${Math.abs(Math.round(km.surplus)).toLocaleString("en-SG")} — insufficient upfront funds`, score: -surplusRatio });
  if (TDSR > 0.55)
    risks.push({ text: `TDSR ${Math.round(TDSR * 100)}% — exceeds MAS 55% limit; loan may not be approved`, score: TDSR });
  else if (TDSR > 0.45)
    risks.push({ text: `TDSR ${Math.round(TDSR * 100)}% — near the limit; leaves little monthly slack`, score: TDSR });
  if (bufferMonths < 3)
    risks.push({ text: `Only ${bufferMonths.toFixed(1)} months cash reserve after purchase — very thin`, score: 3 - bufferMonths });
  if (inp.liquidity === "Low")
    risks.push({ text: "Low liquidity in target market — difficult to exit if you need to sell", score: 1 });
  if (inp.priceTrend === "Falling")
    risks.push({ text: "Falling prices — near-term capital loss risk on new purchase", score: 1 });
  if (inp.targetRemainingLease < 60 && inp.targetRemainingLease < 999)
    risks.push({ text: `Target has only ${inp.targetRemainingLease} years left — CPF and bank loan restrictions apply`, score: 99 - inp.targetRemainingLease });
  if (inp.targetPropertyAge > 30)
    risks.push({ text: `${inp.targetPropertyAge}-year old property — higher maintenance and renovation exposure`, score: inp.targetPropertyAge });
  if (inp.monthlyCarLoan > 0 && TDSR > 0.40)
    risks.push({ text: `Car loan of $${inp.monthlyCarLoan.toLocaleString("en-SG")}/mo reduces mortgage capacity`, score: inp.monthlyCarLoan / 1000 });
  if (inp.hasSchoolAgeChildren && inp.distanceToSchoolKm !== null && inp.distanceToSchoolKm > 3)
    risks.push({ text: `School is ${inp.distanceToSchoolKm} km away — outside primary school priority zones`, score: inp.distanceToSchoolKm });
  if (con && totalScore >= 60 && totalScore <= 70)
    risks.push({ text: "Borderline score in conservative mode — small adverse change could tip affordability", score: 1 });

  // PSF market check signals
  const psf = inp.marketPsfEstimate;
  if (psf && psf.estimated_psf_mid > 0 && inp.targetPropertyPrice > 0) {
    const estSqm = 100; // rough assumption for PSF → price comparison
    const impliedPsf = Math.round(inp.targetPropertyPrice / estSqm / 10.7639);
    if (psf.confidence !== "Low") {
      if (impliedPsf > psf.estimated_psf_high) {
        risks.push({
          text: `Your target price implies ~S$${impliedPsf.toLocaleString("en-SG")} psf — above estimated market high of S$${psf.estimated_psf_high.toLocaleString("en-SG")} psf (potentially overpriced)`,
          score: 2,
        });
      } else if (impliedPsf >= psf.estimated_psf_low) {
        reasons.push({
          text: `Target price implies ~S$${impliedPsf.toLocaleString("en-SG")} psf — within estimated market range (S$${psf.estimated_psf_low.toLocaleString("en-SG")}–S$${psf.estimated_psf_high.toLocaleString("en-SG")} psf)`,
          score: 0.5,
        });
      }
    } else {
      risks.push({
        text: "PSF estimate confidence is Low — verify current market price with an agent before committing",
        score: 0.5,
      });
    }
  }

  reasons.sort((a, b) => b.score - a.score);
  risks.sort((a, b) => b.score - a.score);

  const topReasonsToUpgrade = reasons.slice(0, 3).map((r) => r.text);
  const topRisks            = risks  .slice(0, 3).map((r) => r.text);

  // ── Suggested next step ───────────────────────────────────────────────────
  let suggestedNextStep = "";
  if (totalScore >= 80) {
    suggestedNextStep = "Proceed with property search. Get an In-Principle Approval (IPA) from your bank and register your HDB intent to sell.";
  } else if (totalScore >= 65) {
    suggestedNextStep = "Get an IPA to confirm your loan eligibility. Address the top risk items before committing to an OTP.";
  } else if (totalScore >= 50) {
    const gap = Math.abs(Math.min(0, km.surplus));
    suggestedNextStep = gap > 0
      ? `Build savings by S$${Math.round(gap).toLocaleString("en-SG")} more. Consider reducing existing debts to improve your TDSR. Revisit in 6–12 months.`
      : "Strengthen your position — reduce debts or target a lower price bracket. Revisit in 6–12 months.";
  } else {
    suggestedNextStep = "Focus on debt reduction and building a 6-month emergency fund first. Revisit affordability in 12–18 months.";
  }

  return {
    totalScore,
    decisionLabel,
    decisionColor,
    categoryScores: [cat1, cat2, cat3, cat4, cat5],
    keyMetrics: km,
    topReasonsToUpgrade,
    topRisks,
    suggestedNextStep,
    conservativeMode: con,
  };
}

// ── BSD helper (mirrors calculator.ts, kept local to avoid circular import) ──

export function calcBSD(price: number): number {
  const slabs = [
    { limit: 180_000, rate: 0.01 }, { limit: 180_000, rate: 0.02 },
    { limit: 640_000, rate: 0.03 }, { limit: 500_000, rate: 0.04 },
    { limit: 1_500_000, rate: 0.05 },
  ];
  let bsd = 0; let remaining = price;
  for (const s of slabs) {
    if (remaining <= 0) break;
    const t = Math.min(remaining, s.limit);
    bsd += t * s.rate;
    remaining -= t;
  }
  if (remaining > 0) bsd += remaining * 0.06;
  return Math.round(bsd);
}

export function calcMonthlyMortgage(principal: number, annualRate: number, years: number): number {
  if (principal <= 0) return 0;
  const r = annualRate / 12;
  const n = years * 12;
  return Math.round((principal * r) / (1 - Math.pow(1 + r, -n)));
}
