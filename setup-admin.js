require("dotenv").config();
const bcrypt = require("bcryptjs");
const { db, initDb } = require("./db");

initDb();
const username = (process.env.ADMIN_USERNAME || "").trim();
const password = process.env.ADMIN_PASSWORD || "";
if (!username || password.length < 12) {
  console.error("Set ADMIN_USERNAME and ADMIN_PASSWORD (at least 12 characters) in .env first.");
  process.exit(1);
}
const existing = db.prepare("SELECT id FROM users WHERE username = ?").get(username);
if (existing) {
  console.error("That username already exists. Choose a different ADMIN_USERNAME or reset the user securely.");
  process.exit(1);
}
const hash = bcrypt.hashSync(password, 12);
db.prepare("INSERT INTO users (username, password_hash, full_name, role, active) VALUES (?, ?, ?, 'admin', 1)")
  .run(username, hash, "System Administrator");
console.log(`Admin account created: ${username}`);
console.log("Sign in and create separate accounts for each staff member. Do not share this account.");
