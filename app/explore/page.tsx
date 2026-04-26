"use client";

import dynamic from "next/dynamic";

const AreaCondoSearch = dynamic(
  () => import("@/components/AreaCondoSearch"),
  { ssr: false },
);

export default function ExplorePage() {
  return (
    <main className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Explore Condos &amp; ECs</h1>
          <p className="mt-1 text-sm text-gray-500">
            Search by postal code, address, MRT station, or town to see all private condos and
            executive condominiums within your chosen radius — with live transaction data.
          </p>
        </div>
        <AreaCondoSearch />
      </div>
    </main>
  );
}
