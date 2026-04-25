// Private property transaction types and mock data.
// Real project-level data is seeded from data/private_transactions.csv (see seed script).
// Quarterly aggregate demand metrics come from data.gov.sg CKAN datasets (see seed script).

export interface PrivateTransaction {
  project: string;
  street: string;
  district: string;
  marketSegment: "CCR" | "RCR" | "OCR";
  propertyType: string;
  tenure: string;
  typeOfSale: string;
  price: number;
  sqm: number;
  pricePerSqm: number;
  floorRange: string;
  contractDate: string; // "YYYY-MM"
}
// Simplify tenure string
function parseTenure(raw: string): string {
  if (!raw) return "Unknown";
  if (raw.toLowerCase().includes("freehold")) return "Freehold";
  const match999 = raw.match(/999/);
  if (match999) return "999-year leasehold";
  const match = raw.match(/(\d+)\s*yrs.*commencing.*(\d{4})/i);
  if (match) return `${match[1]}-year leasehold (from ${match[2]})`;
  return raw.slice(0, 40);
}


// --- Mock data fallback ---
// Realistic Singapore private condo transactions spanning 2022–2024

const MOCK = ([
  // OCR projects
  { project: "Normanton Park",          street: "Normanton Park",         district: "05", marketSegment: "OCR", propertyType: "Condominium", tenure: "99-year leasehold (from 2019)", typeOfSale: "New Sale",  price: 1452000, sqm: 88,  pricePerSqm: 16500, floorRange: "06 to 10", contractDate: "2024-10" },
  { project: "Normanton Park",          street: "Normanton Park",         district: "05", marketSegment: "OCR", propertyType: "Condominium", tenure: "99-year leasehold (from 2019)", typeOfSale: "Resale",    price: 1620000, sqm: 101, pricePerSqm: 16040, floorRange: "11 to 15", contractDate: "2024-08" },
  { project: "Sky Eden@Bedok",          street: "Bedok Central",          district: "16", marketSegment: "OCR", propertyType: "Condominium", tenure: "99-year leasehold (from 2022)", typeOfSale: "New Sale",  price: 1238000, sqm: 75,  pricePerSqm: 16507, floorRange: "01 to 05", contractDate: "2024-11" },
  { project: "Sky Eden@Bedok",          street: "Bedok Central",          district: "16", marketSegment: "OCR", propertyType: "Condominium", tenure: "99-year leasehold (from 2022)", typeOfSale: "New Sale",  price: 1580000, sqm: 95,  pricePerSqm: 16632, floorRange: "11 to 15", contractDate: "2024-09" },
  { project: "Sceneca Residence",       street: "Tanah Merah Kechil Link",district: "18", marketSegment: "OCR", propertyType: "Condominium", tenure: "99-year leasehold (from 2022)", typeOfSale: "New Sale",  price: 1098000, sqm: 65,  pricePerSqm: 16892, floorRange: "01 to 05", contractDate: "2024-10" },
  { project: "Sceneca Residence",       street: "Tanah Merah Kechil Link",district: "18", marketSegment: "OCR", propertyType: "Condominium", tenure: "99-year leasehold (from 2022)", typeOfSale: "New Sale",  price: 1465000, sqm: 88,  pricePerSqm: 16648, floorRange: "06 to 10", contractDate: "2024-07" },
  { project: "The Botany at Dairy Farm",street: "Dairy Farm Walk",        district: "23", marketSegment: "OCR", propertyType: "Condominium", tenure: "99-year leasehold (from 2022)", typeOfSale: "New Sale",  price: 1318000, sqm: 81,  pricePerSqm: 16272, floorRange: "06 to 10", contractDate: "2024-11" },
  { project: "The Botany at Dairy Farm",street: "Dairy Farm Walk",        district: "23", marketSegment: "OCR", propertyType: "Condominium", tenure: "99-year leasehold (from 2022)", typeOfSale: "New Sale",  price: 1622000, sqm: 101, pricePerSqm: 16059, floorRange: "16 to 20", contractDate: "2024-06" },
  { project: "Lentor Mansion",          street: "Lentor Gardens",         district: "26", marketSegment: "OCR", propertyType: "Condominium", tenure: "99-year leasehold (from 2023)", typeOfSale: "New Sale",  price: 1388000, sqm: 84,  pricePerSqm: 16524, floorRange: "06 to 10", contractDate: "2024-09" },
  { project: "Lentor Mansion",          street: "Lentor Gardens",         district: "26", marketSegment: "OCR", propertyType: "Condominium", tenure: "99-year leasehold (from 2023)", typeOfSale: "New Sale",  price: 1720000, sqm: 105, pricePerSqm: 16381, floorRange: "16 to 20", contractDate: "2024-07" },
  { project: "Lentor Modern",           street: "Lentor Central",         district: "26", marketSegment: "OCR", propertyType: "Condominium", tenure: "99-year leasehold (from 2022)", typeOfSale: "New Sale",  price: 1258000, sqm: 77,  pricePerSqm: 16338, floorRange: "01 to 05", contractDate: "2023-11" },
  { project: "Lentor Modern",           street: "Lentor Central",         district: "26", marketSegment: "OCR", propertyType: "Condominium", tenure: "99-year leasehold (from 2022)", typeOfSale: "Resale",    price: 1390000, sqm: 83,  pricePerSqm: 16747, floorRange: "06 to 10", contractDate: "2023-08" },
  { project: "Treasure @ Tampines",     street: "Tampines St 86",         district: "18", marketSegment: "OCR", propertyType: "Condominium", tenure: "99-year leasehold (from 2019)", typeOfSale: "Resale",    price: 1150000, sqm: 75,  pricePerSqm: 15333, floorRange: "01 to 05", contractDate: "2023-06" },
  { project: "Treasure @ Tampines",     street: "Tampines St 86",         district: "18", marketSegment: "OCR", propertyType: "Condominium", tenure: "99-year leasehold (from 2019)", typeOfSale: "Resale",    price: 1380000, sqm: 93,  pricePerSqm: 14839, floorRange: "11 to 15", contractDate: "2022-12" },
  { project: "Parc Clematis",           street: "Jalan Lempeng",          district: "05", marketSegment: "OCR", propertyType: "Condominium", tenure: "99-year leasehold (from 2019)", typeOfSale: "Resale",    price: 1520000, sqm: 99,  pricePerSqm: 15354, floorRange: "06 to 10", contractDate: "2022-09" },
  { project: "Parc Clematis",           street: "Jalan Lempeng",          district: "05", marketSegment: "OCR", propertyType: "Condominium", tenure: "99-year leasehold (from 2019)", typeOfSale: "Resale",    price: 1890000, sqm: 124, pricePerSqm: 15242, floorRange: "16 to 20", contractDate: "2022-05" },

  // RCR projects
  { project: "Grand Dunman",            street: "Dunman Rd",              district: "15", marketSegment: "RCR", propertyType: "Condominium", tenure: "99-year leasehold (from 2022)", typeOfSale: "New Sale",  price: 2138000, sqm: 95,  pricePerSqm: 22505, floorRange: "11 to 15", contractDate: "2024-11" },
  { project: "Grand Dunman",            street: "Dunman Rd",              district: "15", marketSegment: "RCR", propertyType: "Condominium", tenure: "99-year leasehold (from 2022)", typeOfSale: "New Sale",  price: 2680000, sqm: 120, pricePerSqm: 22333, floorRange: "21 to 25", contractDate: "2024-09" },
  { project: "Tembusu Grand",           street: "Tanjong Katong Rd",      district: "15", marketSegment: "RCR", propertyType: "Condominium", tenure: "99-year leasehold (from 2022)", typeOfSale: "New Sale",  price: 1988000, sqm: 90,  pricePerSqm: 22089, floorRange: "06 to 10", contractDate: "2024-10" },
  { project: "Tembusu Grand",           street: "Tanjong Katong Rd",      district: "15", marketSegment: "RCR", propertyType: "Condominium", tenure: "99-year leasehold (from 2022)", typeOfSale: "New Sale",  price: 2450000, sqm: 110, pricePerSqm: 22273, floorRange: "16 to 20", contractDate: "2024-07" },
  { project: "Blossoms by the Park",    street: "Slim Barracks Rise",     district: "05", marketSegment: "RCR", propertyType: "Condominium", tenure: "99-year leasehold (from 2022)", typeOfSale: "New Sale",  price: 1748000, sqm: 79,  pricePerSqm: 22127, floorRange: "06 to 10", contractDate: "2024-08" },
  { project: "Blossoms by the Park",    street: "Slim Barracks Rise",     district: "05", marketSegment: "RCR", propertyType: "Condominium", tenure: "99-year leasehold (from 2022)", typeOfSale: "New Sale",  price: 2180000, sqm: 99,  pricePerSqm: 22020, floorRange: "11 to 15", contractDate: "2024-05" },
  { project: "Pinetree Hill",           street: "Pine Grove",             district: "21", marketSegment: "RCR", propertyType: "Condominium", tenure: "99-year leasehold (from 2022)", typeOfSale: "New Sale",  price: 2328000, sqm: 105, pricePerSqm: 22171, floorRange: "11 to 15", contractDate: "2024-11" },
  { project: "Pinetree Hill",           street: "Pine Grove",             district: "21", marketSegment: "RCR", propertyType: "Condominium", tenure: "99-year leasehold (from 2022)", typeOfSale: "New Sale",  price: 2860000, sqm: 130, pricePerSqm: 22000, floorRange: "21 to 25", contractDate: "2024-06" },
  { project: "Parc Esta",               street: "Sims Ave",               district: "14", marketSegment: "RCR", propertyType: "Condominium", tenure: "99-year leasehold (from 2018)", typeOfSale: "Resale",    price: 1680000, sqm: 75,  pricePerSqm: 22400, floorRange: "06 to 10", contractDate: "2023-10" },
  { project: "Parc Esta",               street: "Sims Ave",               district: "14", marketSegment: "RCR", propertyType: "Condominium", tenure: "99-year leasehold (from 2018)", typeOfSale: "Resale",    price: 2050000, sqm: 92,  pricePerSqm: 22283, floorRange: "16 to 20", contractDate: "2023-07" },
  { project: "Penrose",                 street: "Sims Dr",                district: "14", marketSegment: "RCR", propertyType: "Condominium", tenure: "99-year leasehold (from 2020)", typeOfSale: "Resale",    price: 1620000, sqm: 76,  pricePerSqm: 21316, floorRange: "06 to 10", contractDate: "2023-04" },
  { project: "Penrose",                 street: "Sims Dr",                district: "14", marketSegment: "RCR", propertyType: "Condominium", tenure: "99-year leasehold (from 2020)", typeOfSale: "Resale",    price: 1980000, sqm: 94,  pricePerSqm: 21064, floorRange: "11 to 15", contractDate: "2022-11" },
  { project: "Riverfront Residences",   street: "Hougang Ave 7",          district: "19", marketSegment: "RCR", propertyType: "Condominium", tenure: "99-year leasehold (from 2018)", typeOfSale: "Resale",    price: 1560000, sqm: 74,  pricePerSqm: 21081, floorRange: "01 to 05", contractDate: "2022-08" },
  { project: "Riverfront Residences",   street: "Hougang Ave 7",          district: "19", marketSegment: "RCR", propertyType: "Condominium", tenure: "99-year leasehold (from 2018)", typeOfSale: "Resale",    price: 1820000, sqm: 88,  pricePerSqm: 20682, floorRange: "06 to 10", contractDate: "2022-04" },

  // CCR projects
  { project: "One Pearl Bank",          street: "Pearl Bank",             district: "03", marketSegment: "CCR", propertyType: "Condominium", tenure: "99-year leasehold (from 2019)", typeOfSale: "New Sale",  price: 3280000, sqm: 107, pricePerSqm: 30654, floorRange: "31 to 35", contractDate: "2024-11" },
  { project: "One Pearl Bank",          street: "Pearl Bank",             district: "03", marketSegment: "CCR", propertyType: "Condominium", tenure: "99-year leasehold (from 2019)", typeOfSale: "Resale",    price: 2850000, sqm: 93,  pricePerSqm: 30645, floorRange: "21 to 25", contractDate: "2024-08" },
  { project: "Perfect Ten",             street: "Bukit Timah Rd",         district: "10", marketSegment: "CCR", propertyType: "Condominium", tenure: "Freehold",                       typeOfSale: "New Sale",  price: 4180000, sqm: 115, pricePerSqm: 36348, floorRange: "06 to 10", contractDate: "2024-10" },
  { project: "Perfect Ten",             street: "Bukit Timah Rd",         district: "10", marketSegment: "CCR", propertyType: "Condominium", tenure: "Freehold",                       typeOfSale: "New Sale",  price: 5600000, sqm: 153, pricePerSqm: 36601, floorRange: "16 to 20", contractDate: "2024-07" },
  { project: "Kopar at Newton",         street: "Kampong Java Rd",        district: "11", marketSegment: "CCR", propertyType: "Condominium", tenure: "99-year leasehold (from 2020)", typeOfSale: "New Sale",  price: 3050000, sqm: 97,  pricePerSqm: 31443, floorRange: "11 to 15", contractDate: "2024-09" },
  { project: "Kopar at Newton",         street: "Kampong Java Rd",        district: "11", marketSegment: "CCR", propertyType: "Condominium", tenure: "99-year leasehold (from 2020)", typeOfSale: "New Sale",  price: 3680000, sqm: 118, pricePerSqm: 31186, floorRange: "21 to 25", contractDate: "2024-06" },
  { project: "Canninghill Piers",       street: "Clarke Quay",            district: "06", marketSegment: "CCR", propertyType: "Condominium", tenure: "99-year leasehold (from 2021)", typeOfSale: "New Sale",  price: 2880000, sqm: 94,  pricePerSqm: 30638, floorRange: "11 to 15", contractDate: "2024-11" },
  { project: "Canninghill Piers",       street: "Clarke Quay",            district: "06", marketSegment: "CCR", propertyType: "Condominium", tenure: "99-year leasehold (from 2021)", typeOfSale: "New Sale",  price: 3650000, sqm: 117, pricePerSqm: 31197, floorRange: "26 to 30", contractDate: "2024-08" },
  { project: "The Atelier",             street: "Makeway Ave",            district: "09", marketSegment: "CCR", propertyType: "Condominium", tenure: "Freehold",                       typeOfSale: "New Sale",  price: 3420000, sqm: 110, pricePerSqm: 31091, floorRange: "11 to 15", contractDate: "2023-11" },
  { project: "The Atelier",             street: "Makeway Ave",            district: "09", marketSegment: "CCR", propertyType: "Condominium", tenure: "Freehold",                       typeOfSale: "New Sale",  price: 2980000, sqm: 95,  pricePerSqm: 31368, floorRange: "06 to 10", contractDate: "2023-08" },
  { project: "Klimt Cairnhill",         street: "Cairnhill Rise",         district: "09", marketSegment: "CCR", propertyType: "Condominium", tenure: "Freehold",                       typeOfSale: "New Sale",  price: 6800000, sqm: 196, pricePerSqm: 34694, floorRange: "21 to 25", contractDate: "2023-05" },
  { project: "Klimt Cairnhill",         street: "Cairnhill Rise",         district: "09", marketSegment: "CCR", propertyType: "Condominium", tenure: "Freehold",                       typeOfSale: "New Sale",  price: 4250000, sqm: 125, pricePerSqm: 34000, floorRange: "11 to 15", contractDate: "2022-10" },
  { project: "The Sail @ Marina Bay",   street: "Marina Blvd",            district: "01", marketSegment: "CCR", propertyType: "Condominium", tenure: "99-year leasehold (from 2004)", typeOfSale: "Resale",    price: 2200000, sqm: 78,  pricePerSqm: 28205, floorRange: "21 to 25", contractDate: "2022-07" },
  { project: "The Sail @ Marina Bay",   street: "Marina Blvd",            district: "01", marketSegment: "CCR", propertyType: "Condominium", tenure: "99-year leasehold (from 2004)", typeOfSale: "Resale",    price: 1980000, sqm: 72,  pricePerSqm: 27500, floorRange: "16 to 20", contractDate: "2022-03" },
] satisfies PrivateTransaction[]).sort((a, b) => b.contractDate.localeCompare(a.contractDate));

// Fix pricePerSqm — was set as psf-like numbers above; recalculate properly
const MOCK_CLEAN: PrivateTransaction[] = MOCK.map((t) => ({
  ...t,
  pricePerSqm: Math.round(t.price / t.sqm),
}));

export { MOCK_CLEAN as PRIVATE_MOCK_TRANSACTIONS };

// Returns mock data. Real project-level data comes from CSV import in the seed script.
export async function fetchPrivateTransactions(): Promise<PrivateTransaction[]> {
  return MOCK_CLEAN;
}
