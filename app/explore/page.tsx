"use client";

import { useState, useRef } from "react";
import dynamic from "next/dynamic";

const AreaCondoSearch = dynamic(
  () => import("@/components/AreaCondoSearch"),
  { ssr: false },
);

type SeedEvent =
  | { type: "keyword_start"; keyword: string }
  | { type: "page"; keyword: string; page: number; totalPages: number; keptSoFar: number }
  | { type: "keyword_done"; keyword: string; kept: number; runningTotal: number }
  | { type: "inserting"; count: number }
  | { type: "done"; written: number; total: number; condos: number; ecs: number }
  | { type: "error"; message: string }
  | { type: "page_error"; keyword: string; page: number; status?: number; error?: string };

export default function ExplorePage() {
  const [seeding,  setSeeding]  = useState(false);
  const [logs,     setLogs]     = useState<string[]>([]);
  const [showSeed, setShowSeed] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);

  function addLog(line: string) {
    setLogs((prev) => [...prev, line]);
    setTimeout(() => {
      if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
    }, 10);
  }

  async function handleSeed() {
    setSeeding(true);
    setLogs([]);
    addLog("Starting seed — this takes 2–5 minutes…");

    try {
      const res = await fetch("/api/admin/seed-condos", { method: "POST" });
      if (!res.ok || !res.body) {
        addLog(`Error: HTTP ${res.status}`);
        setSeeding(false);
        return;
      }

      const reader  = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });

        const chunks = buf.split("\n\n");
        buf = chunks.pop() ?? "";

        for (const chunk of chunks) {
          const line = chunk.replace(/^data: /, "").trim();
          if (!line) continue;
          try {
            const ev: SeedEvent = JSON.parse(line);
            switch (ev.type) {
              case "keyword_start":
                addLog(`\n▸ "${ev.keyword}"`);
                break;
              case "page":
                addLog(`  page ${ev.page}/${ev.totalPages} — ${ev.keptSoFar} kept so far`);
                break;
              case "keyword_done":
                addLog(`  ✓ kept ${ev.kept}  (running total: ${ev.runningTotal})`);
                break;
              case "inserting":
                addLog(`\nInserting ${ev.count} records into DB (after dedup)…`);
                break;
              case "done":
                addLog(
                  `\n✅ Seed complete!\n` +
                  `   Written this run : ${ev.written}\n` +
                  `   Total in DB      : ${ev.total}\n` +
                  `   Condos           : ${ev.condos}\n` +
                  `   ECs              : ${ev.ecs}`
                );
                break;
              case "error":
                addLog(`\n❌ Error: ${ev.message}`);
                break;
              case "page_error":
                addLog(`  ⚠ page ${ev.page} failed: ${ev.status ?? ev.error}`);
                break;
            }
          } catch { /* malformed SSE line — skip */ }
        }
      }
    } catch (err) {
      addLog(`\n❌ ${err instanceof Error ? err.message : String(err)}`);
    }

    setSeeding(false);
  }

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Explore Condos &amp; ECs</h1>
          <p className="mt-1 text-sm text-gray-500">
            Search by postal code, address, MRT station, or town to see all private condos and
            executive condominiums within your chosen radius.
          </p>
        </div>

        <AreaCondoSearch />

        {/* Admin: DB seed panel */}
        <div className="mt-8 border border-slate-200 rounded-xl bg-white overflow-hidden">
          <button
            className="w-full flex items-center justify-between px-5 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
            onClick={() => setShowSeed((v) => !v)}
          >
            <span>Database — Seed All Singapore Condos</span>
            <span className="text-slate-400 text-xs">{showSeed ? "▲" : "▼"}</span>
          </button>

          {showSeed && (
            <div className="px-5 py-4 border-t border-slate-100">
              <p className="text-xs text-slate-500 mb-3">
                Pulls all private condos &amp; ECs from OneMap and writes them to the local SQLite
                database. Takes 2–5 minutes. Run once — searches then respond in &lt;400 ms instead
                of ~20 s.
              </p>

              <button
                onClick={handleSeed}
                disabled={seeding}
                className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-semibold
                           hover:bg-indigo-700 disabled:opacity-50 transition-colors"
              >
                {seeding ? "Seeding…" : "Seed All Singapore Condos"}
              </button>

              {logs.length > 0 && (
                <div
                  ref={logRef}
                  className="mt-3 rounded-lg bg-slate-900 text-green-400 font-mono text-xs
                             p-3 h-56 overflow-y-auto whitespace-pre-wrap leading-5"
                >
                  {logs.join("\n")}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
