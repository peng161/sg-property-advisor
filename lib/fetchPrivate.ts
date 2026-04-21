// Districts by region (URA classification)
const CCR = new Set(["1", "2", "3", "4", "9", "10", "11"]);
const RCR = new Set(["5", "7", "8", "12", "13", "14", "15", "19", "20", "21"]);
// OCR = districts 16–18, 22–28

export interface PrivatePrices {
  ocr: number;
  rcr: number;
  ccr: number;
}

interface UraTransaction {
  district:     string;
  price:        string;
  propertyType: string;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

async function getToken(accessKey: string): Promise<string> {
  const res = await fetch(
    "https://eservice.ura.gov.sg/uraDataService/insertNewToken.action?service=PMI_Resi_Transaction",
    { headers: { AccessKey: accessKey }, cache: "no-store" }
  );
  const json = await res.json();
  if (json.Status !== "Success") throw new Error(`URA token error: ${json.Status}`);
  return json.Result as string;
}

// Fetches latest quarter of private condo transactions from URA.
// Returns null if URA_ACCESS_KEY is not set or the API fails.
export async function fetchPrivatePrices(): Promise<PrivatePrices | null> {
  const accessKey = process.env.URA_ACCESS_KEY;
  if (!accessKey) return null;

  try {
    const token = await getToken(accessKey);

    const res = await fetch(
      "https://eservice.ura.gov.sg/uraDataService/invokeUraDS/v1?service=PMI_Resi_Transaction&batch=1",
      {
        headers: { AccessKey: accessKey, Token: token },
        next: { revalidate: 3600 },
      }
    );
    const json = await res.json();
    if (json.Status !== "Success" || !Array.isArray(json.Result)) return null;

    const condoTypes = new Set(["Condominium", "Apartment"]);
    const ocr: number[] = [];
    const rcr: number[] = [];
    const ccr: number[] = [];

    for (const t of json.Result as UraTransaction[]) {
      if (!condoTypes.has(t.propertyType)) continue;
      const price = Number(t.price);
      if (!price) continue;
      if (CCR.has(t.district)) ccr.push(price);
      else if (RCR.has(t.district)) rcr.push(price);
      else ocr.push(price);
    }

    if (!ocr.length && !rcr.length && !ccr.length) return null;

    return {
      ocr: median(ocr) || 1400000,
      rcr: median(rcr) || 2200000,
      ccr: median(ccr) || 3500000,
    };
  } catch {
    return null;
  }
}
