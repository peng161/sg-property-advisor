import { HDB_RESALE_PRICES } from "./mockData";

export type FlatType = "3-Room" | "4-Room" | "5-Room" | "Executive";
export type DistanceTier = "< 200m" | "200–500m" | "500m–1km" | "> 1km";

export interface HdbTransaction {
  id: string;
  street: string;
  block: string;
  flatType: FlatType;
  floor: number;
  sqm: number;
  resalePrice: number;
  month: string;
  leaseCommenceYear: number;
  remainingLease: number;
  distanceTier: DistanceTier;
  pricePerSqm: number;
}

// Typical floor area (sqm) variants per flat type — [small, typical, large]
const SQM_VARIANTS: Record<FlatType, number[]> = {
  "3-Room":    [63, 67, 72],
  "4-Room":    [88, 95, 105],
  "5-Room":    [110, 118, 128],
  "Executive": [138, 145, 155],
};

// Price multiplier based on floor level
function floorFactor(floor: number): number {
  if (floor <= 5)  return 0.93;
  if (floor <= 10) return 0.98;
  if (floor <= 15) return 1.00;
  if (floor <= 20) return 1.04;
  if (floor <= 25) return 1.08;
  return 1.13;
}

// Price multiplier based on remaining lease (older = cheaper)
function leaseFactor(leaseCommenceYear: number): number {
  const remaining = Math.max(0, 99 - (2025 - leaseCommenceYear));
  if (remaining < 65)  return 0.87;
  if (remaining < 72)  return 0.94;
  if (remaining < 80)  return 1.00;
  if (remaining < 88)  return 1.06;
  return 1.12;
}

// Known streets per HDB town
const TOWN_STREETS: Record<string, string[]> = {
  "Ang Mo Kio":      ["Ang Mo Kio Ave 3",        "Ang Mo Kio Ave 6",       "Ang Mo Kio St 11"],
  "Bedok":           ["Bedok North Ave 1",         "Bedok Reservoir Rd",     "New Upper Changi Rd"],
  "Bishan":          ["Bishan St 11",              "Bishan St 22",           "Marymount Rd"],
  "Bukit Batok":     ["Bukit Batok West Ave 6",    "Bukit Batok East Ave 4", "Bukit Batok St 31"],
  "Bukit Merah":     ["Queensway",                 "Depot Rd",               "Henderson Rd"],
  "Bukit Panjang":   ["Bukit Panjang Ring Rd",     "Petir Rd",               "Segar Rd"],
  "Bukit Timah":     ["Toh Yi Dr",                 "Cashew Rd",              "Bukit Timah Rd"],
  "Central Area":    ["Outram Rd",                 "Upper Cross St",         "Cantonment Rd"],
  "Choa Chu Kang":   ["Choa Chu Kang Ave 2",       "Choa Chu Kang St 52",    "Keat Hong Cl"],
  "Clementi":        ["Clementi Ave 2",             "Clementi Ave 4",         "West Coast Rd"],
  "Geylang":         ["Aljunied Rd",               "Eunos Cres",             "Lorong 1 Geylang"],
  "Hougang":         ["Hougang Ave 8",              "Hougang St 91",          "Upper Serangoon Rd"],
  "Jurong East":     ["Jurong East St 13",          "Jurong East St 31",      "Boon Lay Ave"],
  "Jurong West":     ["Jurong West St 41",          "Jurong West Ave 1",      "Corporation Dr"],
  "Kallang/Whampoa": ["Kallang Bahru",              "Whampoa Dr",             "Boon Keng Rd"],
  "Marine Parade":   ["Marine Parade Central",      "Joo Chiat Rd",           "Bedok South Ave 1"],
  "Pasir Ris":       ["Pasir Ris St 11",            "Pasir Ris Dr 4",         "Elias Rd"],
  "Punggol":         ["Punggol Central",            "Sumang Walk",            "Edgedale Plains"],
  "Queenstown":      ["Margaret Dr",               "Stirling Rd",            "Commonwealth Dr"],
  "Sembawang":       ["Sembawang Cres",             "Sembawang Dr",           "Canberra Link"],
  "Sengkang":        ["Compassvale Rd",             "Rivervale Cres",         "Sengkang East Way"],
  "Serangoon":       ["Serangoon Ave 2",            "Serangoon North Ave 4",  "Lorong Lew Lian"],
  "Tampines":        ["Tampines St 41",             "Tampines St 61",         "Tampines Ave 4"],
  "Toa Payoh":       ["Toa Payoh Lor 1",            "Toa Payoh Lor 7",        "Toa Payoh Central"],
  "Woodlands":       ["Woodlands Ave 1",            "Woodlands Dr 50",        "Marsiling Rd"],
  "Yishun":          ["Yishun Ave 4",               "Yishun St 22",           "Yishun Ring Rd"],
};

// 4 transaction profiles: [leaseYear, floor, sqmIndex, distanceTier]
// Each flat type gets all 4, giving 16 transactions per town
const PROFILES: Array<{
  leaseYear: number;
  floor: number;
  sqmIdx: number;
  dist: DistanceTier;
  blockSeed: number;
  monthOffset: number;
}> = [
  { leaseYear: 1985, floor: 4,  sqmIdx: 0, dist: "< 200m",    blockSeed: 101, monthOffset: 0 },
  { leaseYear: 1998, floor: 10, sqmIdx: 1, dist: "200–500m",   blockSeed: 214, monthOffset: 1 },
  { leaseYear: 2010, floor: 18, sqmIdx: 2, dist: "500m–1km",   blockSeed: 327, monthOffset: 2 },
  { leaseYear: 2018, floor: 28, sqmIdx: 1, dist: "> 1km",      blockSeed: 480, monthOffset: 3 },
];

const MONTHS = ["2024-11", "2024-10", "2024-09", "2024-08", "2024-07", "2024-06"];

// Generate 16 realistic nearby HDB resale transactions for a given town
export function getTransactions(town: string): HdbTransaction[] {
  const medians = HDB_RESALE_PRICES[town] ?? HDB_RESALE_PRICES["Tampines"];
  const streets = TOWN_STREETS[town] ?? ["Main St", "Central Ave", "Park Rd"];

  const transactions: HdbTransaction[] = [];
  const flatTypes: FlatType[] = ["3-Room", "4-Room", "5-Room", "Executive"];

  flatTypes.forEach((flatType) => {
    const basePrice = medians[flatType] ?? 500_000;
    const sqmVariants = SQM_VARIANTS[flatType];

    PROFILES.forEach((p, i) => {
      const sqm = sqmVariants[p.sqmIdx % sqmVariants.length];
      const remaining = Math.max(0, 99 - (2025 - p.leaseYear));
      const price = Math.round(basePrice * floorFactor(p.floor) * leaseFactor(p.leaseYear));
      const street = streets[i % streets.length];
      const block = String(p.blockSeed + flatTypes.indexOf(flatType) * 13);
      const month = MONTHS[(i + p.monthOffset) % MONTHS.length];
      const id = `${town}-${flatType}-${i}`;

      transactions.push({
        id,
        street,
        block,
        flatType,
        floor: p.floor,
        sqm,
        resalePrice: price,
        month,
        leaseCommenceYear: p.leaseYear,
        remainingLease: remaining,
        distanceTier: p.dist,
        pricePerSqm: Math.round(price / sqm),
      });
    });
  });

  return transactions;
}
