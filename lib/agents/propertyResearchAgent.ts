// Research agent: finds current PSF estimates for a Singapore condo.
// Fast path: query our seeded private_project table (URA data, High confidence).
// Slow path: Claude Opus 4.7 with tool_use to fetch public portal pages.

import Anthropic from "@anthropic-ai/sdk";
import { getDb } from "@/lib/sqlite";

const PSF_PER_PSM = 10.7639; // 1 sqm = 10.7639 sqft

export interface ResearchResult {
  project_name:       string;
  estimated_psf_low:  number;
  estimated_psf_mid:  number;
  estimated_psf_high: number;
  confidence:         "High" | "Medium" | "Low";
  price_basis:        string;
  sources:            string[];
  notes:              string[];
  checked_at:         string;
}

// ── Fast path: DB lookup from seeded private_project table ────────────────────

async function lookupFromDb(projectName: string): Promise<ResearchResult | null> {
  const db = getDb();
  if (!db) return null;
  try {
    let res = await db.execute({
      sql: "SELECT * FROM private_project WHERE UPPER(project) = UPPER(?) LIMIT 1",
      args: [projectName],
    });
    if (!res.rows.length) {
      res = await db.execute({
        sql: "SELECT * FROM private_project WHERE UPPER(project) LIKE UPPER(?) ORDER BY tx_count DESC LIMIT 1",
        args: [`%${projectName}%`],
      });
    }
    if (!res.rows.length) return null;

    const row = res.rows[0];
    const medPsm = Number(row.median_psm);
    if (!medPsm) return null;

    const medPsf  = Math.round(medPsm / PSF_PER_PSM);
    const trend3y = Number(row.trend_3y) || 0;
    const spread  = trend3y > 15 ? 0.10 : 0.07;

    return {
      project_name:       String(row.project),
      estimated_psf_low:  Math.round(medPsf * (1 - spread)),
      estimated_psf_mid:  medPsf,
      estimated_psf_high: Math.round(medPsf * (1 + spread)),
      confidence:  "High",
      price_basis: `URA transaction records (${Number(row.tx_count)} transactions, latest: ${String(row.latest_date)})`,
      sources:     ["sg-property DB (URA data via data.gov.sg)"],
      notes: [
        `${Number(row.tx_count)} transactions in database.`,
        `3-year price trend: ${trend3y > 0 ? "+" : ""}${trend3y.toFixed(1)}%.`,
        `Segment: ${String(row.market_segment)}. Tenure: ${String(row.tenure)}.`,
      ],
      checked_at: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

// ── Fetch helper for agent tools ──────────────────────────────────────────────

async function fetchPageContent(url: string): Promise<string> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,*/*;q=0.8",
        "Accept-Language": "en-SG,en;q=0.9",
      },
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return `HTTP ${res.status} for ${url}`;
    const html = await res.text();
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return text.slice(0, 2500) || "(empty page — likely JavaScript-rendered)";
  } catch (e) {
    return `Fetch error: ${e instanceof Error ? e.message : String(e)}`;
  }
}

// ── Slow path: Claude agent with tool_use ─────────────────────────────────────

async function runClaudeAgent(
  projectName: string,
  unitType:    string,
  targetPsf:   number,
): Promise<ResearchResult> {
  const client = new Anthropic();

  const tools: Anthropic.Tool[] = [
    {
      name: "fetch_page",
      description: "Fetch a public web page to extract property price data. Returns extracted text (max 2500 chars). Use for public property portals only. Do not use more than 3 times.",
      input_schema: {
        type: "object" as const,
        properties: {
          url:    { type: "string", description: "Full URL to fetch" },
          reason: { type: "string", description: "What you expect to find" },
        },
        required: ["url", "reason"],
      },
    },
  ];

  const slug = projectName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

  const systemPrompt = `You are a Singapore property market research assistant. Your job is to find reliable PSF (price per square foot, SGD) estimates for a specific Singapore private residential development by fetching public property portal pages.

Rules:
- Fetch AT MOST 3 URLs total
- Never fabricate or invent PSF numbers — only report what you actually see in fetched pages
- Clearly distinguish asking prices (listings) from actual transaction prices
- If a fetched page is empty or JavaScript-rendered (shows little text), note it and try the next
- After all research, return ONLY a JSON object — no text before or after the JSON`;

  const userMsg = `Research the current market PSF range for this Singapore condo:
Project: "${projectName}"
Unit type of interest: ${unitType}
User's target PSF: ${targetPsf} SGD/sqft

Suggested URLs to try (use exactly, slug derived from project name):
1. https://www.edgeprop.sg/condo/${slug}
2. https://www.99.co/singapore/condos-apartments/${slug}
3. https://www.propertyguru.com.sg/property-for-sale?search=true&listing_type=sale&query_type=project&query=${encodeURIComponent(projectName)}

After fetching up to 3 pages, return EXACTLY this JSON (no other text):
{
  "project_name": "${projectName}",
  "estimated_psf_low": <integer, 0 if unknown>,
  "estimated_psf_mid": <integer, 0 if unknown>,
  "estimated_psf_high": <integer, 0 if unknown>,
  "confidence": "High" | "Medium" | "Low",
  "price_basis": "<one sentence: what data this is based on>",
  "sources": ["<actual URLs that contained useful data>"],
  "notes": ["<note about data quality or caveats>"]
}`;

  const messages: Anthropic.MessageParam[] = [{ role: "user", content: userMsg }];

  for (let round = 0; round < 6; round++) {
    const resp = await client.messages.create({
      model:     "claude-opus-4-7",
      max_tokens: 1024,
      thinking:  { type: "adaptive" },
      system:    systemPrompt,
      tools,
      messages,
    });

    messages.push({ role: "assistant", content: resp.content });

    if (resp.stop_reason === "end_turn") {
      const text = resp.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("");
      const m = text.match(/\{[\s\S]*\}/);
      if (m) {
        try {
          const parsed = JSON.parse(m[0]) as Partial<ResearchResult>;
          return {
            project_name:       parsed.project_name       ?? projectName,
            estimated_psf_low:  parsed.estimated_psf_low  ?? 0,
            estimated_psf_mid:  parsed.estimated_psf_mid  ?? 0,
            estimated_psf_high: parsed.estimated_psf_high ?? 0,
            confidence:         (parsed.confidence as "High" | "Medium" | "Low") ?? "Low",
            price_basis:        parsed.price_basis         ?? "Web research",
            sources:            Array.isArray(parsed.sources) ? parsed.sources : [],
            notes:              Array.isArray(parsed.notes)   ? parsed.notes   : [],
            checked_at:         new Date().toISOString(),
          };
        } catch { /* fall through */ }
      }
      break;
    }

    if (resp.stop_reason === "tool_use") {
      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const block of resp.content) {
        if (block.type !== "tool_use") continue;
        let content = "";
        if (block.name === "fetch_page") {
          const inp = block.input as { url: string; reason: string };
          content = await fetchPageContent(inp.url);
        }
        toolResults.push({ type: "tool_result", tool_use_id: block.id, content });
      }
      messages.push({ role: "user", content: toolResults });
    }
  }

  return {
    project_name:       projectName,
    estimated_psf_low:  0,
    estimated_psf_mid:  0,
    estimated_psf_high: 0,
    confidence:         "Low",
    price_basis:        "No reliable data found in public sources",
    sources:            [],
    notes:              [`Could not retrieve price data for "${projectName}" from public portals. Portals may use JavaScript rendering. Try EdgeProp or PropertyGuru directly.`],
    checked_at:         new Date().toISOString(),
  };
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function runPropertyResearchAgent(
  projectName: string,
  unitType:    string,
  targetPsf:   number,
): Promise<ResearchResult> {
  const dbResult = await lookupFromDb(projectName);
  if (dbResult) return dbResult;
  return runClaudeAgent(projectName, unitType, targetPsf);
}
