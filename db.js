const { Pool } = require("pg");
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required. Configure the Supabase PostgreSQL connection string in your hosting environment.");
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.PGSSLMODE === "disable" ? false : { rejectUnauthorized: false }, max: Number(process.env.PGPOOL_MAX || 5), idleTimeoutMillis: 30000, connectionTimeoutMillis: 15000 });
pool.on("error", err => console.error("Unexpected PostgreSQL pool error:", err.message));
async function initDb() {
  await pool.query("SELECT 1");
  const required = ["users","students","staff","staff_salary_payments","inventory_items","stock_movements","fee_payments","attendance","expenses","audit_log","academic_subjects","academic_marks","academic_grade_bands","academic_report_notes"];
  const result = await pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ANY($1::text[])", [required]);
  const found = new Set(result.rows.map(row => row.table_name));
  const missing = required.filter(name => !found.has(name));
  if (missing.length) throw new Error("Supabase schema incomplete; missing tables: " + missing.join(", ") + ". Run supabase/schema.sql.");
  console.log("Connected to Supabase PostgreSQL; schema verified.");
}
module.exports = { pool, initDb };
