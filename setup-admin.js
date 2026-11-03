require("dotenv").config();
const bcrypt = require("bcryptjs");
const { pool, initDb } = require("./db");
async function main() {
  await initDb();
  const username = (process.env.ADMIN_USERNAME || "").trim();
  const password = process.env.ADMIN_PASSWORD || "";
  if (!username || password.length < 12) throw new Error("Set ADMIN_USERNAME and ADMIN_PASSWORD (at least 12 characters) in the hosting environment.");
  const existing = await pool.query("SELECT id FROM users WHERE username = $1", [username]);
  if (existing.rowCount) throw new Error("That username already exists. Choose a different ADMIN_USERNAME.");
  const hash = await bcrypt.hash(password, 12);
  await pool.query("INSERT INTO users(username,password_hash,full_name,role,active) VALUES($1,$2,$3,\'admin\',TRUE)", [username, hash, "System Administrator"]);
  console.log("Admin account created: " + username);
  console.log("Sign in and create separate accounts for each staff member. Do not share this account.");
}
main().catch(err => { console.error(err.message); process.exitCode = 1; }).finally(() => pool.end());
