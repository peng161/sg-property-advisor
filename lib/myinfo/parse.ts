// Parse raw Myinfo person data into our FinancialProfile shape.
// Defensive: every field is optional — Myinfo may not return all attributes
// for every user (e.g. no HDB flat, no CPF housing withdrawal).

import type { MyinfoPersonData, FinancialProfile } from "./types";

function num(v: number | undefined): number | null {
  return typeof v === "number" && isFinite(v) ? v : null;
}

export function parseMyinfoProfile(person: MyinfoPersonData): FinancialProfile {
  // ── CPF balances ───────────────────────────────────────────────────────────
  const cpfOaBalance = num(person.cpfbalances?.oa?.value);
  const cpfSaBalance = num(person.cpfbalances?.sa?.value);
  const cpfMaBalance = num(person.cpfbalances?.ma?.value);

  // ── CPF contributions: average of last 3 months as monthly contribution ────
  const history = person.cpfcontributions?.history ?? [];
  const recentAmounts = history
    .slice(0, 3)
    .map((h) => h.amount?.value)
    .filter((v): v is number => typeof v === "number" && v > 0);
  const monthlyContribution =
    recentAmounts.length > 0
      ? Math.round(recentAmounts.reduce((a, b) => a + b, 0) / recentAmounts.length)
      : null;

  // ── CPF housing withdrawal: sum of all principal withdrawals ───────────────
  const details = person.cpfhousingwithdrawal?.withdrawaldetails ?? [];
  const cpfUsedForHousing =
    details.length > 0
      ? details.reduce((sum, d) => sum + (d.principalwithdrawalamt?.value ?? 0), 0) || null
      : null;

  // ── HDB ownership: take first flat (primary residence) ────────────────────
  const flat = person.hdbownership?.[0];
  let hdbFlat: FinancialProfile["hdbFlat"] = null;

  if (flat) {
    const addr = flat.address;
    const block  = addr?.block?.value  ?? "";
    const floor  = addr?.floor?.value  ?? "";
    const unit   = addr?.unit?.value   ?? "";
    const street = addr?.street?.value ?? "";
    const postal = addr?.postal?.value ?? "";
    const addressStr = [
      block && `Blk ${block}`,
      floor && unit ? `#${floor}-${unit}` : "",
      street,
      postal && `S(${postal})`,
    ]
      .filter(Boolean)
      .join(" ");

    const leaseStr = flat.leasecommencementdate?.value;
    const leaseYear = leaseStr ? Number(leaseStr.slice(0, 4)) : null;

    hdbFlat = {
      type:                  flat.hdbtype?.desc ?? flat.hdbtype?.code ?? "HDB Flat",
      address:               addressStr,
      purchasePrice:         num(flat.purchaseprice?.value),
      loanGranted:           num(flat.loangranted?.value),
      leaseCommencementYear: leaseYear && !isNaN(leaseYear) ? leaseYear : null,
    };
  }

  return {
    source: "myinfo",
    cpfOaBalance,
    cpfSaBalance,
    cpfMaBalance,
    cpfUsedForHousing,
    monthlyContribution,
    outstandingLoanBalance: num(flat?.outstandingloanbalance?.value),
    monthlyLoanInstalment:  num(flat?.monthlyloaninstalment?.value),
    hdbFlat,
  };
}
