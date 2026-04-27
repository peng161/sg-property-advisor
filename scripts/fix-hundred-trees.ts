import { config } from "dotenv";
config({ path: ".env.local" });
import { createClient } from "@libsql/client";
const db = createClient({ url: process.env.TURSO_DATABASE_URL!, authToken: process.env.TURSO_AUTH_TOKEN! });

async function main() {
  const r = await db.execute(
    "UPDATE private_property_master SET tenure = '999-year leasehold', lease_commencement_year = 1841 WHERE UPPER(project_name) = 'HUNDRED TREES'"
  );
  console.log(`Updated ${r.rowsAffected} row(s) for Hundred Trees`);

  const check = await db.execute("SELECT project_name, tenure, lease_commencement_year FROM private_property_master WHERE UPPER(project_name) = 'HUNDRED TREES'");
  check.rows.forEach(r => console.log(r.project_name, r.tenure, r.lease_commencement_year));
}
main().catch(console.error);
