import { NextRequest } from "next/server";
import { getPropertyEstimate } from "@/lib/services/propertyResearchService";

export const dynamic = "force-dynamic";

interface RequestBody {
  projectName:   string;
  unitType:      string;
  targetPsf:     number;
  forceRefresh?: boolean;
}

export async function POST(req: NextRequest) {
  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { projectName, unitType = "any", targetPsf = 0, forceRefresh = false } = body;
  if (!projectName || typeof projectName !== "string" || !projectName.trim()) {
    return Response.json({ error: "projectName is required" }, { status: 400 });
  }

  try {
    const result = await getPropertyEstimate(
      projectName.trim(),
      unitType.trim() || "any",
      Number(targetPsf) || 0,
      Boolean(forceRefresh),
    );
    return Response.json(result);
  } catch (err) {
    console.error("[research-property]", err instanceof Error ? err.message : err);
    return Response.json({ error: "Research failed — check server logs" }, { status: 500 });
  }
}
