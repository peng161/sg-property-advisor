// Sample median resale prices (S$) — based on approximate 2024 market data
export const HDB_RESALE_PRICES: Record<string, Record<string, number>> = {
  "Ang Mo Kio":       { "3-Room": 370000, "4-Room": 520000, "5-Room": 680000, "Executive": 780000 },
  "Bedok":            { "3-Room": 360000, "4-Room": 510000, "5-Room": 660000, "Executive": 760000 },
  "Bishan":           { "3-Room": 420000, "4-Room": 600000, "5-Room": 780000, "Executive": 880000 },
  "Bukit Batok":      { "3-Room": 340000, "4-Room": 480000, "5-Room": 620000, "Executive": 720000 },
  "Bukit Merah":      { "3-Room": 450000, "4-Room": 640000, "5-Room": 820000, "Executive": 920000 },
  "Bukit Panjang":    { "3-Room": 330000, "4-Room": 470000, "5-Room": 600000, "Executive": 700000 },
  "Bukit Timah":      { "3-Room": 500000, "4-Room": 700000, "5-Room": 900000, "Executive": 1000000 },
  "Central Area":     { "3-Room": 600000, "4-Room": 850000, "5-Room": 1100000, "Executive": 1300000 },
  "Choa Chu Kang":    { "3-Room": 310000, "4-Room": 450000, "5-Room": 580000, "Executive": 680000 },
  "Clementi":         { "3-Room": 430000, "4-Room": 610000, "5-Room": 790000, "Executive": 890000 },
  "Geylang":          { "3-Room": 390000, "4-Room": 540000, "5-Room": 700000, "Executive": 800000 },
  "Hougang":          { "3-Room": 340000, "4-Room": 480000, "5-Room": 620000, "Executive": 720000 },
  "Jurong East":      { "3-Room": 350000, "4-Room": 490000, "5-Room": 640000, "Executive": 740000 },
  "Jurong West":      { "3-Room": 320000, "4-Room": 460000, "5-Room": 590000, "Executive": 690000 },
  "Kallang/Whampoa":  { "3-Room": 460000, "4-Room": 650000, "5-Room": 840000, "Executive": 940000 },
  "Marine Parade":    { "3-Room": 480000, "4-Room": 680000, "5-Room": 870000, "Executive": 970000 },
  "Pasir Ris":        { "3-Room": 330000, "4-Room": 470000, "5-Room": 610000, "Executive": 710000 },
  "Punggol":          { "3-Room": 350000, "4-Room": 500000, "5-Room": 640000, "Executive": 740000 },
  "Queenstown":       { "3-Room": 500000, "4-Room": 710000, "5-Room": 920000, "Executive": 1020000 },
  "Sembawang":        { "3-Room": 300000, "4-Room": 430000, "5-Room": 560000, "Executive": 660000 },
  "Sengkang":         { "3-Room": 340000, "4-Room": 490000, "5-Room": 630000, "Executive": 730000 },
  "Serangoon":        { "3-Room": 400000, "4-Room": 560000, "5-Room": 730000, "Executive": 830000 },
  "Tampines":         { "3-Room": 350000, "4-Room": 500000, "5-Room": 650000, "Executive": 750000 },
  "Toa Payoh":        { "3-Room": 450000, "4-Room": 640000, "5-Room": 830000, "Executive": 930000 },
  "Woodlands":        { "3-Room": 300000, "4-Room": 430000, "5-Room": 560000, "Executive": 650000 },
  "Yishun":           { "3-Room": 310000, "4-Room": 440000, "5-Room": 570000, "Executive": 670000 },
};

// Sample EC developments (S$) — entry-level psf × typical size
export const EC_OPTIONS = [
  { name: "Lumina Grand (Bukit Batok)", price: 1280000, location: "West",       bedrooms: "3–4 bedroom" },
  { name: "Novo Place (Tengah)",         price: 1250000, location: "West",       bedrooms: "3–4 bedroom" },
  { name: "Parc Greenwich (Sengkang)",   price: 1200000, location: "North-East", bedrooms: "3–4 bedroom" },
  { name: "Tenet (Tampines)",            price: 1350000, location: "East",       bedrooms: "3–5 bedroom" },
];

// Sample private condo price ranges (S$) by region
export const PRIVATE_CONDO_OPTIONS = [
  { name: "OCR Condo (Outside Central Region)", minPrice: 1200000, maxPrice: 1800000, region: "Suburbs",     bedrooms: "2–4 bedroom" },
  { name: "RCR Condo (Rest of Central Region)", minPrice: 1800000, maxPrice: 2800000, region: "City Fringe", bedrooms: "1–3 bedroom" },
  { name: "CCR Condo (Core Central Region)",    minPrice: 2800000, maxPrice: 5000000, region: "Prime",       bedrooms: "1–3 bedroom" },
];
