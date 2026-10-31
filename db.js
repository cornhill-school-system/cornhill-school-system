const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

const defaultDataDir = path.join(__dirname, "data");
const databasePath = process.env.DB_PATH || path.join(defaultDataDir, "school.sqlite");
fs.mkdirSync(path.dirname(databasePath), { recursive: true });
const db = new Database(databasePath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

function initDb() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      full_name TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('admin','headteacher','bursar','teacher','storekeeper')),
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS students (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      admission_no TEXT NOT NULL UNIQUE,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      gender TEXT,
      date_of_birth TEXT,
      class_name TEXT NOT NULL,
      guardian_name TEXT,
      guardian_phone TEXT,
      boarding_status TEXT NOT NULL DEFAULT 'day' CHECK(boarding_status IN ('day','boarding')),
      takes_breakfast INTEGER NOT NULL DEFAULT 0,
      takes_lunch INTEGER NOT NULL DEFAULT 0,
      house_or_dormitory TEXT,
      photo_data_url TEXT,
      bursary_status TEXT NOT NULL DEFAULT 'none' CHECK(bursary_status IN ('none','full','partial')),
      bursary_amount_ugx INTEGER NOT NULL DEFAULT 0 CHECK(bursary_amount_ugx >= 0),
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS staff (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      staff_no TEXT NOT NULL UNIQUE,
      full_name TEXT NOT NULL,
      role_title TEXT NOT NULL,
      phone TEXT,
      email TEXT,
      staff_type TEXT NOT NULL DEFAULT 'teaching' CHECK(staff_type IN ('teaching','non_teaching')),
      monthly_salary_ugx INTEGER NOT NULL DEFAULT 0 CHECK(monthly_salary_ugx >= 0),
      payment_day INTEGER NOT NULL DEFAULT 30 CHECK(payment_day BETWEEN 1 AND 31),
      photo_data_url TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS staff_salary_payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      staff_id INTEGER NOT NULL REFERENCES staff(id),
      academic_year INTEGER NOT NULL,
      term TEXT NOT NULL,
      term_month INTEGER NOT NULL CHECK(term_month BETWEEN 1 AND 3),
      amount_paid_ugx INTEGER NOT NULL CHECK(amount_paid_ugx > 0),
      paid_on TEXT NOT NULL,
      reference TEXT,
      recorded_by INTEGER REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(staff_id, academic_year, term, term_month)
    );
    CREATE TABLE IF NOT EXISTS inventory_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_code TEXT NOT NULL UNIQUE,
      item_name TEXT NOT NULL,
      category TEXT,
      unit TEXT NOT NULL DEFAULT 'piece',
      quantity REAL NOT NULL DEFAULT 0 CHECK(quantity >= 0),
      reorder_level REAL NOT NULL DEFAULT 0 CHECK(reorder_level >= 0),
      unit_cost INTEGER NOT NULL DEFAULT 0 CHECK(unit_cost >= 0),
      location TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS stock_movements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id INTEGER NOT NULL REFERENCES inventory_items(id),
      movement_type TEXT NOT NULL CHECK(movement_type IN ('received','issued','adjustment')),
      quantity REAL NOT NULL CHECK(quantity > 0),
      note TEXT,
      created_by INTEGER REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS fee_payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      receipt_no TEXT NOT NULL UNIQUE,
      student_id INTEGER NOT NULL REFERENCES students(id),
      amount_ugx INTEGER NOT NULL CHECK(amount_ugx > 0),
      payment_method TEXT NOT NULL,
      term TEXT NOT NULL,
      academic_year INTEGER NOT NULL,
      reference TEXT,
      received_by INTEGER REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS attendance (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id INTEGER NOT NULL REFERENCES students(id),
      attendance_date TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('present','absent','late','excused')),
      note TEXT,
      recorded_by INTEGER REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(student_id, attendance_date)
    );
    CREATE TABLE IF NOT EXISTS expenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      expense_no TEXT NOT NULL UNIQUE,
      expense_date TEXT NOT NULL,
      category TEXT NOT NULL,
      description TEXT NOT NULL,
      amount_ugx INTEGER NOT NULL CHECK(amount_ugx > 0),
      payment_method TEXT NOT NULL,
      reference TEXT,
      recorded_by INTEGER REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER REFERENCES users(id),
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id INTEGER,
      details TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_students_class ON students(class_name);
    CREATE INDEX IF NOT EXISTS idx_payments_date ON fee_payments(created_at);
    CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance(attendance_date);
    CREATE TABLE IF NOT EXISTS academic_subjects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      class_name TEXT NOT NULL,
      subject_name TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      UNIQUE(class_name, subject_name)
    );
    CREATE TABLE IF NOT EXISTS academic_marks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id INTEGER NOT NULL REFERENCES students(id),
      subject_name TEXT NOT NULL,
      academic_year INTEGER NOT NULL,
      term TEXT NOT NULL CHECK(term IN ('Term 1','Term 2','Term 3')),
      assessment_period TEXT NOT NULL CHECK(assessment_period IN ('Beginning of Term','Mid-Term','End of Term')),
      mark REAL CHECK(mark >= 0 AND mark <= 100),
      comment TEXT,
      recorded_by INTEGER REFERENCES users(id),
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(student_id, subject_name, academic_year, term, assessment_period)
    );
    CREATE TABLE IF NOT EXISTS academic_grade_bands (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      label TEXT NOT NULL UNIQUE,
      min_mark REAL NOT NULL,
      max_mark REAL NOT NULL,
      remark TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS academic_report_notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      academic_year INTEGER NOT NULL,
      term TEXT NOT NULL CHECK(term IN ('Term 1','Term 2','Term 3')),
      class_teacher_comment TEXT NOT NULL DEFAULT '',
      headteacher_comment TEXT NOT NULL DEFAULT '',
      recorded_by INTEGER REFERENCES users(id),
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(student_id, academic_year, term)
    );
  `);
  // Safe schema upgrades for databases created by earlier versions.
  // Safe schema upgrades for databases created by earlier versions. Keep existing learner/staff records.
  const addMissingColumns = (table, definitions) => {
    const existing = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name));
    for (const [name, definition] of Object.entries(definitions)) {
      if (!existing.has(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
    }
  };
  addMissingColumns('students', {
    boarding_status: "TEXT NOT NULL DEFAULT 'day'",
    takes_breakfast: 'INTEGER NOT NULL DEFAULT 0',
    takes_lunch: 'INTEGER NOT NULL DEFAULT 0',
    house_or_dormitory: 'TEXT',
    photo_data_url: 'TEXT',
    bursary_status: "TEXT NOT NULL DEFAULT 'none'",
    bursary_amount_ugx: 'INTEGER NOT NULL DEFAULT 0'
  });
  addMissingColumns('staff', {
    staff_type: "TEXT NOT NULL DEFAULT 'teaching'",
    monthly_salary_ugx: 'INTEGER NOT NULL DEFAULT 0',
    payment_day: 'INTEGER NOT NULL DEFAULT 30',
    photo_data_url: 'TEXT'
  });
}
module.exports = { db, initDb };
