import { config } from "dotenv";
config({ path: ".env.local" });
import { createClient } from "@libsql/client";
const db = createClient({ url: process.env.TURSO_DATABASE_URL!, authToken: process.env.TURSO_AUTH_TOKEN! });

async function main() {
  const dist = await db.execute("SELECT tenure, COUNT(*) as n FROM private_property_master GROUP BY tenure ORDER BY n DESC");
  console.log("=== Tenure distribution ===");
  dist.rows.forEach(r => console.log(String(r.tenure ?? "NULL").padEnd(26), r.n));

  const lc = await db.execute("SELECT COUNT(*) as n FROM private_property_master WHERE lease_commencement_year IS NOT NULL");
  console.log("\nWith lease_commencement_year:", lc.rows[0].n);

  const nullTenure = await db.execute("SELECT COUNT(*) as n FROM private_property_master WHERE tenure IS NULL");
  console.log("Tenure still NULL:", nullTenure.rows[0].n);

  const sample = await db.execute(`SELECT project_name, tenure, lease_commencement_year FROM private_property_master WHERE UPPER(project_name) IN ('NEWEST','HUNDRED TREES','PARC RIVIERA','TWIN VEW','BOTANNIA','THE TRILINQ','SEAHILL','FLORAVALE') LIMIT 15`);
  console.log("\n=== Sample condos ===");
  sample.rows.forEach(r => console.log(String(r.project_name).padEnd(28), String(r.tenure ?? "NULL").padEnd(26), r.lease_commencement_year ?? "NULL"));
}
main().catch(console.error);
