/**
 * Shared classifier for OneMap building results.
 * Used by both the full seed (seed-condos.ts / seed-condos API route)
 * and the area discovery CLI (discover-condos.ts).
 */

// ── Hard-reject phrases ───────────────────────────────────────────────────────
// Matched against the combined "BUILDING_NAME ADDRESS" string (uppercase).

const REJECT_PHRASES = [
  // Nature / parks (non-residential structures inside parks)
  "GARDENS BY THE BAY",
  "NATURE RESERVE", "NATURE PARK",
  "NATIONAL PARKS", "NPARKS",
  "PARK CONNECTOR",
  "VISITOR CENTRE", "VISITORS CENTRE",
  "HERITAGE TRAIL",
  // Transport
  "MRT STATION", "MRT EXIT",
  "LRT STATION", "LRT EXIT",
  "STATION EXIT",
  "BUS STOP", "BUS INTERCHANGE", "BUS TERMINAL",
  "TAXI STAND",
  "AVENUE TOWARDS", "ROAD TOWARDS",
  "EXPRESSWAY", "FLYOVER", "UNDERPASS",
  // Government & civic
  "TOWN COUNCIL",
  "COMMUNITY CENTRE", "COMMUNITY CLUB",
  "RESIDENTS COMMITTEE", "RESIDENTS' COMMITTEE",
  "POLICE POST", "POLICE STATION",
  "FIRE STATION", "CIVIL DEFENCE",
  "POST OFFICE",
  "LIBRARY",
  "IMMIGRATION",
  // Healthcare
  "HOSPITAL", "POLYCLINIC", "CLINIC", "HEALTH CENTRE", "HOSPICE",
  "NURSING HOME", "CARE HOME", "REHABILITATION CENTRE", "DIALYSIS",
  // Education
  "SCHOOL", "INSTITUTE OF", "POLYTECHNIC", "UNIVERSITY",
  "PRESCHOOL", "CHILDCARE",
  // Recreation (public, non-residential)
  "SPORTS CENTRE", "SPORTS HALL", "SPORTS COMPLEX", "STADIUM",
  "SWIMMING COMPLEX", "SWIMMING POOL",
  "HAWKER CENTRE", "FOOD CENTRE", "FOOD COURT",
  "CANTEEN",
  // Parking / utilities
  "CAR PARK", "CARPARK",
  "PUMP STATION", "SUBSTATION", "ELECTRICITY",
  "WATER WORKS", "SEWAGE", "TREATMENT PLANT",
  "RUBBISH", "REFUSE",
  // Industrial / commercial (non-residential)
  "INDUSTRIAL", "WAREHOUSE", "FACTORY",
  "LOGISTICS", "DISTRIBUTION CENTRE",
  // Management / offices (named within residential estates but not dwellings)
  "MANAGEMENT OFFICE", "MANAGEMENT CORPORATION",
  "TOWN COUNCIL OFFICE", "PARK OFFICE",
  "STRATA TITLE PLAN",
  // Religious
  "CHURCH", "TEMPLE", "MOSQUE", "SYNAGOGUE", "CATHEDRAL",
  "MASJID", "MANDIR",
  // Petrol stations & fuel brands
  "ESSO", "CALTEX", "PETRON", "SHELL", "SINOPEC", "PETRONAS",
  "PETROL STATION", "SERVICE STATION", "FILLING STATION", "PETROLEUM",
  // Retail / F&B / commercial
  "SUPERMARKET", "HYPERMARKET", "FAIRPRICE", "COLD STORAGE", "SHENG SIONG",
  "MCDONALD", "KFC", "SUBWAY", "STARBUCKS", "KOPITIAM",
  "MINIMART", "CONVENIENCE STORE",
  // Hotels & serviced apartments (not private residential)
  "HOTEL", "SERVICED APARTMENT", "SERVICED RESIDENCE",
] as const;

// ── Positive signals ──────────────────────────────────────────────────────────

const HIGH_CONF_TERMS = [
  "EXECUTIVE CONDOMINIUM", "CONDOMINIUM", "CONDO",
  "APARTMENT", "RESIDENCES", "RESIDENCE", "SUITES",
] as const;

const BRANDING_WORDS = [
  "PARC", "PARK", "VIEW", "VEW",   // VEW is a common SG condo spelling variant of VIEW
  "HEIGHTS", "HILL", "CREST", "GREEN", "GARDENS",
  "VALLEY", "BAY", "SHORE", "TOWERS", "GROVE", "LOFT", "CASA", "COURT",
  "POINT", "PLACE", "MANSION", "TREES", "LAKE", "CANOPY", "BOTANNIA",
  "NORMANTON", "LAKEVILLE",
  // Additional SG condo branding words
  "WOODS", "HORIZON", "LODGE", "RIDGE", "COVE", "WATERFRONT",
  "EDEN", "BLOSSOMS", "GRAND", "STELLAR", "BIJOU", "MARBELLA",
  "TRILINQ", "TRIZON", "SERENADE", "INFINITI",
] as const;

const ROAD_SUFFIX_RE =
  /\b(AVENUE|ROAD|STREET|DRIVE|CRESCENT|WALK|WAY|LANE|CLOSE|LINK|FLYOVER|HIGHWAY|BOULEVARD|RING)\s*\d*$/;

// ── Types ─────────────────────────────────────────────────────────────────────

export type Bucket = "master" | "candidate" | "reject";

export interface Classified {
  bucket:       Bucket;
  score:        number;
  reason:       string;
  projectName:  string;
  propertyType: "Condo" | "EC";
}

// ── Classifier ────────────────────────────────────────────────────────────────

export function classify(
  building: string, searchval: string, address: string,
  postal: string, lat: number, lng: number,
): Classified {
  const rawBuilding = (building || searchval || "").trim();
  const b     = rawBuilding.toUpperCase();
  const a     = address.toUpperCase().trim();
  const combo = `${b} ${a}`;

  // ── Hard rejects: phrase list ──────────────────────────────────────────────

  for (const phrase of REJECT_PHRASES) {
    if (combo.includes(phrase)) {
      return { bucket: "reject", score: 0, reason: `reject phrase: "${phrase}"`, projectName: rawBuilding, propertyType: "Condo" };
    }
  }

  // ── Hard rejects: regex patterns ──────────────────────────────────────────

  // Standalone MRT / LRT (catches "CLEMENTI MRT" without "STATION")
  if (/\bMRT\b|\bLRT\b/.test(combo)) {
    return { bucket: "reject", score: 0, reason: "reject: MRT/LRT hub", projectName: rawBuilding, propertyType: "Condo" };
  }
  // Electronic road pricing
  if (/\bERP\b/.test(combo)) {
    return { bucket: "reject", score: 0, reason: "reject: ERP gantry", projectName: rawBuilding, propertyType: "Condo" };
  }
  // Anything whose BUILDING NAME ends with or is purely "OFFICE"
  if (/\bOFFICE\b/.test(b)) {
    return { bucket: "reject", score: 0, reason: "reject: office building", projectName: rawBuilding, propertyType: "Condo" };
  }
  // Management / strata bodies (often listed under the project name)
  if (/\bMANAGEMENT\b/.test(b)) {
    return { bucket: "reject", score: 0, reason: "reject: management body", projectName: rawBuilding, propertyType: "Condo" };
  }

  // ── Positive scoring ───────────────────────────────────────────────────────

  let score = 0;
  const reasons: string[] = [];
  let isEC = false;

  // +4 definitive residential identifier
  for (const term of HIGH_CONF_TERMS) {
    if (combo.includes(term)) {
      score += 4;
      reasons.push(`+4 "${term}"`);
      if (term === "EXECUTIVE CONDOMINIUM") isEC = true;
      break;
    }
  }

  // +2 looks like a named residential project
  const cleanPostal = postal.replace(/\D/g, "");
  if (rawBuilding.length > 0 && cleanPostal.length === 6 && lat && lng) {
    const wordCount       = b.split(/\s+/).filter(Boolean).length;
    const isBuildingBlock = /^(BLK|BLOCK)\s*\d/i.test(rawBuilding);
    const startsWithDigit = /^\d/.test(rawBuilding);
    const isRoadName      = ROAD_SUFFIX_RE.test(b);
    if (!isBuildingBlock && !startsWithDigit && !isRoadName && wordCount >= 2 && wordCount <= 6) {
      score += 2;
      reasons.push("+2 named project");
    }
  }

  // +1 residential branding word (whole-word match only)
  for (const word of BRANDING_WORDS) {
    if (new RegExp(`\\b${word}\\b`).test(b)) {
      score += 1;
      reasons.push(`+1 branding "${word}"`);
      break;
    }
  }

  // ── Bucket ─────────────────────────────────────────────────────────────────

  const projectName  = rawBuilding || address.split(" ").slice(0, 4).join(" ");
  const propertyType = (isEC ? "EC" : "Condo") as "Condo" | "EC";
  const reasonStr    = reasons.join(", ") || "no positive signals";

  if (score < 2)  return { bucket: "reject",    score, reason: `score ${score}: ${reasonStr}`, projectName, propertyType };
  if (score <= 3) return { bucket: "candidate", score, reason: reasonStr,                       projectName, propertyType };
  return               { bucket: "master",    score, reason: reasonStr,                       projectName, propertyType };
}
