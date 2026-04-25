// Streams a plain-English explanation of an UpgradeScoreResult using Claude.
// Claude is ONLY used for narrative — all numbers come from the deterministic engine.

import { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import type { UpgradeScoreResult } from "@/lib/upgradeScore";

const client = new Anthropic();

export const dynamic = "force-dynamic";

interface ExplainRequest {
  result:  UpgradeScoreResult;
  context: {
    flatType:            string;
    town:                string;
    targetPropertyPrice: number;
    propertyType:        string;
    monthlyGrossIncome:  number;
  };
}

function buildPrompt(req: ExplainRequest): string {
  const { result, context } = req;
  const km = result.keyMetrics;

  const fmtS = (n: number) => `S$${Math.round(n).toLocaleString("en-SG")}`;
  const fmtPct = (n: number) => `${(n * 100).toFixed(0)}%`;

  const catLines = result.categoryScores
    .map((c) => `  - ${c.name}: ${c.score}/${c.maxScore} (${c.weight})`)
    .join("\n");

  const reasons = result.topReasonsToUpgrade.map((r) => `  - ${r}`).join("\n");
  const risks   = result.topRisks.map((r) => `  - ${r}`).join("\n");

  return `You are a Singapore property advisor. A homeowner has run a deterministic upgrade suitability assessment. Write a clear, honest 2-3 paragraph plain-English explanation of their result. Do not invent numbers — use only the figures below. Be direct and practical; avoid generic disclaimers.

SCORE: ${result.totalScore}/100 — "${result.decisionLabel}"
CONSERVATIVE MODE: ${result.conservativeMode ? "Yes" : "No"}

CATEGORY BREAKDOWN:
${catLines}

KEY FINANCIAL METRICS:
  - Net cash after selling current home: ${fmtS(km.netCashProceeds)}
  - Total liquid funds before purchase: ${fmtS(km.totalLiquidBeforePurchase)}
  - Upfront required: ${fmtS(km.totalUpfrontRequired)} (down payment ${fmtS(km.downPayment)} + costs)
  - Surplus/(Shortfall): ${fmtS(km.surplus)} (${fmtPct(km.surplusRatio)} of upfront)
  - Cash buffer after purchase: ${fmtS(km.cashAfterPurchase)} (${km.bufferMonths.toFixed(1)} months expenses)
  - TDSR: ${fmtPct(km.TDSR)} | MSR: ${fmtPct(km.MSR)}

CONTEXT:
  - Current flat: ${context.flatType} in ${context.town}
  - Target: ${context.propertyType} at ${fmtS(context.targetPropertyPrice)}
  - Household income: ${fmtS(context.monthlyGrossIncome)}/month

TOP REASONS TO UPGRADE:
${reasons || "  - None identified"}

TOP RISKS:
${risks || "  - None identified"}

SUGGESTED NEXT STEP: ${result.suggestedNextStep}

Write 2-3 paragraphs. Paragraph 1: summarise the score and the single biggest deciding factor. Paragraph 2: address the main risk(s) concretely with the figures above. Paragraph 3: the suggested next step. Keep it under 180 words total.`;
}

export async function POST(req: NextRequest) {
  let body: ExplainRequest;
  try {
    body = await req.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  if (!body?.result || !body?.context) {
    return new Response("Missing result or context", { status: 400 });
  }

  const prompt = buildPrompt(body);

  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      try {
        const sdkStream = client.messages.stream({
          model:      "claude-opus-4-7",
          max_tokens: 512,
          thinking:   { type: "adaptive" },
          messages:   [{ role: "user", content: prompt }],
        });

        for await (const event of sdkStream) {
          if (
            event.type === "content_block_delta" &&
            event.delta.type === "text_delta"
          ) {
            controller.enqueue(enc.encode(event.delta.text));
          }
        }
      } catch (err) {
        const name = err instanceof Error ? err.name : "StreamError";
        controller.enqueue(enc.encode(`\n[Error: ${name}]`));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type":            "text/plain; charset=utf-8",
      "X-Content-Type-Options":  "nosniff",
      "Cache-Control":           "no-store",
    },
  });
}
