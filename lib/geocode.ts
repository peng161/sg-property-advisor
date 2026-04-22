// Geocodes a Singapore postal code using the OneMap public API.
// Returns lat/lng, block, street, and the derived HDB town name.

export interface GeoResult {
  block: string;
  street: string;
  fullAddress: string;
  lat: number;
  lng: number;
  town: string; // matches data.gov.sg town names e.g. "Clementi"
}

export async function geocodePostal(postal: string): Promise<GeoResult | null> {
  if (!/^\d{6}$/.test(postal)) return null;
  try {
    const url = `https://www.onemap.gov.sg/api/common/elastic/search?searchVal=${postal}&returnGeom=Y&getAddrDetails=Y&pageNum=1`;
    const res = await fetch(url, { next: { revalidate: 86400 } }); // cache 24h
    if (!res.ok) return null;
    const json = await res.json();
    if (!Array.isArray(json.results) || json.results.length === 0) return null;

    const r = json.results[0];
    const lat = Number(r.LATITUDE);
    // OneMap has a historic typo "LONGTITUDE" in some responses
    const lng = Number(r.LONGITUDE ?? r.LONGTITUDE);
    if (!lat || !lng) return null;

    const street = (r.ROAD_NAME as string) ?? "";
    return {
      block: (r.BLK_NO as string) ?? "",
      street,
      fullAddress: (r.ADDRESS as string) ?? "",
      lat,
      lng,
      town: roadNameToTown(street.toUpperCase()),
    };
  } catch {
    return null;
  }
}

// Map Singapore road names → HDB town names (must match data.gov.sg "town" field)
function roadNameToTown(road: string): string {
  if (road.includes("ANG MO KIO"))                                              return "Ang Mo Kio";
  if (road.includes("BEDOK") || road.includes("NEW UPPER CHANGI") || road.includes("CHAI CHEE")) return "Bedok";
  if (road.includes("BISHAN") || road.includes("MARYMOUNT"))                    return "Bishan";
  if (road.includes("BUKIT BATOK"))                                             return "Bukit Batok";
  if (road.includes("BUKIT MERAH") || road.includes("QUEENSWAY") || road.includes("HENDERSON") || road.includes("REDHILL") || road.includes("DEPOT")) return "Bukit Merah";
  if (road.includes("BUKIT PANJANG") || road.includes("PETIR") || road.includes("SEGAR") || road.includes("BANGKIT") || road.includes("FAJAR"))       return "Bukit Panjang";
  if (road.includes("BUKIT TIMAH") || road.includes("TOH YI") || road.includes("CASHEW"))                                                             return "Bukit Timah";
  if (road.includes("CHOA CHU KANG") || road.includes("KEAT HONG") || road.includes("YEW TEE"))                                                       return "Choa Chu Kang";
  if (road.includes("CLEMENTI") || road.includes("WEST COAST") || road.includes("JALAN LEMPENG"))                                                     return "Clementi";
  if (road.includes("GEYLANG") || road.includes("ALJUNIED") || road.includes("EUNOS") || road.includes("SIMS") || road.includes("HAIG"))              return "Geylang";
  if (road.includes("HOUGANG"))                                                 return "Hougang";
  if (road.includes("JURONG EAST") || road.includes("BOON LAY AVE"))           return "Jurong East";
  if (road.includes("JURONG WEST") || road.includes("CORPORATION") || road.includes("TAMAN JURONG") || road.includes("BOON LAY WAY"))                 return "Jurong West";
  if (road.includes("KALLANG") || road.includes("WHAMPOA") || road.includes("BOON KENG") || road.includes("CRAWFORD"))                               return "Kallang/Whampoa";
  if (road.includes("MARINE PARADE") || road.includes("JOO CHIAT") || road.includes("SIGLAP"))                                                        return "Marine Parade";
  if (road.includes("PASIR RIS") || road.includes("ELIAS"))                    return "Pasir Ris";
  if (road.includes("PUNGGOL") || road.includes("SUMANG") || road.includes("EDGEDALE") || road.includes("NORTHSHORE"))                               return "Punggol";
  if (road.includes("MARGARET") || road.includes("STIRLING") || road.includes("COMMONWEALTH") || road.includes("DOVER"))                             return "Queenstown";
  if (road.includes("SEMBAWANG") || road.includes("CANBERRA"))                 return "Sembawang";
  if (road.includes("SENGKANG") || road.includes("COMPASSVALE") || road.includes("RIVERVALE") || road.includes("ANCHORVALE"))                        return "Sengkang";
  if (road.includes("SERANGOON") || road.includes("LORONG LEW LIAN") || road.includes("UPPER SERANGOON"))                                            return "Serangoon";
  if (road.includes("TAMPINES"))                                                return "Tampines";
  if (road.includes("TOA PAYOH") || road.includes("KIM KEAT") || road.includes("LORONG 1 TOA") || road.includes("LORONG 2 TOA"))                     return "Toa Payoh";
  if (road.includes("WOODLANDS") || road.includes("MARSILING") || road.includes("ADMIRALTY"))                                                        return "Woodlands";
  if (road.includes("YISHUN"))                                                  return "Yishun";
  if (road.includes("OUTRAM") || road.includes("CANTONMENT") || road.includes("TANJONG PAGAR") || road.includes("YORK HILL"))                        return "Central Area";
  return "";
}
