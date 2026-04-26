"use client";

import { useState, useEffect, useCallback } from "react";

const TOKEN = "admin:admin";

interface Candidate {
  id:               number;
  project_name:     string;
  property_type:    string;
  address:          string;
  postal_code:      string;
  lat:              number;
  lng:              number;
  confidence_score: number;
  reason:           string;
  source_keyword:   string;
  seeded_at:        string;
}

interface PageData {
  candidates: Candidate[];
  total:      number;
  page:       number;
  limit:      number;
}

export default function AdminPage() {
  const [authed,   setAuthed]   = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [authErr,  setAuthErr]  = useState("");

  const [data,    setData]    = useState<PageData | null>(null);
  const [page,    setPage]    = useState(1);
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState<Record<number, boolean>>({});
  const [toast,   setToast]   = useState<{ msg: string; ok: boolean } | null>(null);

  function showToast(msg: string, ok: boolean) {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 2500);
  }

  const load = useCallback(async (p: number) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/candidates?page=${p}`, {
        headers: { "x-admin-token": TOKEN },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Load failed", false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (authed) load(page);
  }, [authed, page, load]);

  function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    if (username === "admin" && password === "admin") {
      setAuthed(true);
      setAuthErr("");
    } else {
      setAuthErr("Invalid username or password.");
    }
  }

  async function handleAction(id: number, action: "accept" | "reject") {
    setPending((p) => ({ ...p, [id]: true }));
    try {
      const res = await fetch("/api/admin/candidates", {
        method:  "POST",
        headers: { "Content-Type": "application/json", "x-admin-token": TOKEN },
        body:    JSON.stringify({ action, id }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      showToast(action === "accept" ? "Moved to master ✓" : "Rejected ✓", true);
      // Remove from local list immediately for snappy UX
      setData((prev) => prev
        ? { ...prev, candidates: prev.candidates.filter((c) => c.id !== id), total: prev.total - 1 }
        : prev
      );
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Action failed", false);
    } finally {
      setPending((p) => { const n = { ...p }; delete n[id]; return n; });
    }
  }

  // ── Login screen ──────────────────────────────────────────────────────────
  if (!authed) {
    return (
      <main className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
        <div className="w-full max-w-sm bg-white rounded-2xl shadow-sm border border-slate-200 p-8">
          <div className="flex items-center gap-2.5 mb-6">
            <div className="w-8 h-8 bg-neutral-900 rounded-full flex items-center justify-center shrink-0">
              <span className="text-white text-[10px] font-black tracking-tighter">SG</span>
            </div>
            <span className="font-bold text-neutral-900 text-sm">Admin</span>
          </div>
          <h1 className="text-xl font-bold text-slate-900 mb-1">Sign in</h1>
          <p className="text-slate-400 text-sm mb-6">Candidate review panel</p>
          <form onSubmit={handleLogin} className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Username</label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                placeholder="admin"
                autoComplete="username"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                placeholder="••••••"
                autoComplete="current-password"
              />
            </div>
            {authErr && <p className="text-red-500 text-xs">{authErr}</p>}
            <button
              type="submit"
              className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-2 rounded-lg text-sm transition-colors"
            >
              Sign in
            </button>
          </form>
        </div>
      </main>
    );
  }

  // ── Admin panel ───────────────────────────────────────────────────────────
  const totalPages = data ? Math.ceil(data.total / data.limit) : 1;

  return (
    <main className="min-h-screen bg-slate-50">
      {/* Toast */}
      {toast && (
        <div className={`fixed top-4 right-4 z-50 px-4 py-2.5 rounded-xl text-sm font-medium shadow-lg transition-all
          ${toast.ok ? "bg-emerald-600 text-white" : "bg-red-600 text-white"}`}>
          {toast.msg}
        </div>
      )}

      {/* Header */}
      <header className="sticky top-0 z-20 bg-white border-b border-slate-200 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 bg-neutral-900 rounded-full flex items-center justify-center shrink-0">
            <span className="text-white text-[9px] font-black tracking-tighter">SG</span>
          </div>
          <span className="font-bold text-slate-900 text-sm">Candidate Review</span>
          {data && (
            <span className="bg-indigo-100 text-indigo-700 text-xs font-semibold px-2 py-0.5 rounded-full">
              {data.total.toLocaleString()} remaining
            </span>
          )}
        </div>
        <button
          onClick={() => setAuthed(false)}
          className="text-xs text-slate-400 hover:text-slate-600 transition-colors"
        >
          Sign out
        </button>
      </header>

      <div className="max-w-5xl mx-auto px-4 py-6">
        {/* Legend */}
        <div className="mb-4 flex flex-wrap gap-4 text-xs text-slate-500">
          <span><span className="font-semibold text-emerald-600">Accept</span> — moves to master DB (appears on map)</span>
          <span><span className="font-semibold text-red-500">Reject</span> — removes permanently</span>
        </div>

        {/* Table */}
        {loading ? (
          <div className="text-center py-20 text-slate-400 text-sm">Loading…</div>
        ) : data?.candidates.length === 0 ? (
          <div className="text-center py-20 text-slate-400 text-sm">No candidates remaining.</div>
        ) : (
          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">
                  <th className="px-4 py-3">Project</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Address</th>
                  <th className="px-4 py-3 text-center">Score</th>
                  <th className="px-4 py-3">Reason</th>
                  <th className="px-4 py-3 text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data?.candidates.map((c) => (
                  <tr key={c.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3 font-medium text-slate-800 max-w-[180px]">
                      <div className="truncate" title={c.project_name}>{c.project_name}</div>
                      <div className="text-[10px] text-slate-400 mt-0.5">#{c.postal_code}</div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full
                        ${c.property_type === "EC" ? "bg-emerald-100 text-emerald-700" : "bg-indigo-100 text-indigo-700"}`}>
                        {c.property_type}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-500 text-xs max-w-[200px]">
                      <div className="truncate" title={c.address}>{c.address || "—"}</div>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className="font-bold text-slate-700">{c.confidence_score}</span>
                    </td>
                    <td className="px-4 py-3 text-slate-400 text-xs max-w-[180px]">
                      <div className="truncate" title={c.reason}>{c.reason}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-center gap-2">
                        <button
                          onClick={() => handleAction(c.id, "accept")}
                          disabled={!!pending[c.id]}
                          className="px-3 py-1 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-semibold transition-colors disabled:opacity-40"
                        >
                          Accept
                        </button>
                        <button
                          onClick={() => handleAction(c.id, "reject")}
                          disabled={!!pending[c.id]}
                          className="px-3 py-1 rounded-lg bg-red-100 hover:bg-red-200 text-red-600 text-xs font-semibold transition-colors disabled:opacity-40"
                        >
                          Reject
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="mt-4 flex items-center justify-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-medium text-slate-600
                         hover:bg-slate-50 disabled:opacity-40 transition-colors"
            >
              ← Prev
            </button>
            <span className="text-xs text-slate-500">Page {page} of {totalPages}</span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-medium text-slate-600
                         hover:bg-slate-50 disabled:opacity-40 transition-colors"
            >
              Next →
            </button>
          </div>
        )}
      </div>
    </main>
  );
}
