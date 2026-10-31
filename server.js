require("dotenv").config();
const express = require("express");
const helmet = require("helmet");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const path = require("path");
const { db, initDb } = require("./db");

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 24) {
  console.error("Set JWT_SECRET in .env to a random secret of at least 24 characters.");
  process.exit(1);
}
initDb();
const app = express();
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "10mb" }));
app.use(express.static(path.join(__dirname, "public")));

const roles = {
  admin: ["*"],
  headteacher: ["read", "students:write", "attendance:write", "staff:write", "reports:read", "academic:write"],
  bursar: ["read", "fees:write", "expenses:write", "reports:read"],
  teacher: ["read", "attendance:write", "students:read", "reports:read", "academic:write"],
  storekeeper: ["read", "inventory:write", "reports:read"]
};
function auth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const user = db.prepare("SELECT id, username, full_name, role, active FROM users WHERE id = ?").get(payload.id);
    if (!user || !user.active) return res.status(401).json({ error: "Account unavailable." });
    req.user = user;
    next();
  } catch {
    return res.status(401).json({ error: "Please sign in again." });
  }
}
function allow(permission) {
  return (req, res, next) => {
    const permissions = roles[req.user.role] || [];
    if (permissions.includes("*") || permissions.includes(permission)) return next();
    return res.status(403).json({ error: "Your account does not have permission for this action." });
  };
}
function audit(userId, action, entityType, entityId, details = "") {
  db.prepare("INSERT INTO audit_log (user_id, action, entity_type, entity_id, details) VALUES (?, ?, ?, ?, ?)")
    .run(userId, action, entityType, entityId || null, String(details).slice(0, 500));
}
const clean = v => typeof v === "string" ? v.trim() : v;
const positiveInt = v => Number.isSafeInteger(Number(v)) && Number(v) > 0;
const fail = (res, message, status = 400) => res.status(status).json({ error: message });

app.get("/api/health", (_req, res) => res.json({ ok: true, app: "Primary School Management", currency: "UGX" }));

app.post("/api/login", (req, res) => {
  const username = clean(req.body.username || "");
  const password = req.body.password || "";
  if (!username || !password) return fail(res, "Enter username and password.");
  const user = db.prepare("SELECT * FROM users WHERE username = ? AND active = 1").get(username);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) return fail(res, "Invalid username or password.", 401);
  const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET, { expiresIn: "8h" });
  audit(user.id, "login", "user", user.id);
  res.json({ token, user: { id: user.id, username: user.username, full_name: user.full_name, role: user.role } });
});

app.get("/api/me", auth, (req, res) => res.json({ user: req.user, school: process.env.SCHOOL_NAME || "CORNHILL NURSERY AND PRIMARY SCHOOL" }));

app.get("/api/dashboard", auth, allow("read"), (_req, res) => {
  const students = db.prepare("SELECT COUNT(*) n FROM students WHERE status='active'").get().n;
  const staff = db.prepare("SELECT COUNT(*) n FROM staff WHERE status='active'").get().n;
  const stock = db.prepare("SELECT COUNT(*) n FROM inventory_items WHERE quantity <= reorder_level").get().n;
  const today = new Date().toISOString().slice(0, 10);
  const attendance = db.prepare("SELECT COUNT(*) n FROM attendance WHERE attendance_date=? AND status='present'").get(today).n;
  const payments = db.prepare("SELECT COALESCE(SUM(amount_ugx),0) n FROM fee_payments WHERE date(created_at)=date('now','localtime')").get().n;
  const expenses = db.prepare("SELECT COALESCE(SUM(amount_ugx),0) n FROM expenses WHERE expense_date=?").get(today).n;
  res.json({ students, staff, lowStock: stock, presentToday: attendance, feesCollectedToday: payments, expensesToday: expenses, currency: "UGX" });
});

// Students
app.get("/api/students", auth, allow("read"), (req, res) => {
  const q = `%${String(req.query.q || "").slice(0, 80)}%`;
  res.json(db.prepare(`SELECT * FROM students WHERE admission_no LIKE ? OR first_name LIKE ? OR last_name LIKE ? OR class_name LIKE ? ORDER BY class_name, last_name LIMIT 500`)
    .all(q, q, q, q));
});
app.post("/api/students", auth, allow("students:write"), (req, res) => {
  const b = req.body || {};
  const admission = clean(b.admission_no || ""), first = clean(b.first_name || ""), last = clean(b.last_name || ""), cls = clean(b.class_name || "");
  const boarding = b.boarding_status === 'boarding' ? 'boarding' : 'day';
  const breakfast = b.takes_breakfast === '1' || b.takes_breakfast === 1 || b.takes_breakfast === true ? 1 : 0;
  const lunch = b.takes_lunch === '1' || b.takes_lunch === 1 || b.takes_lunch === true ? 1 : 0;
  const dorm = clean(b.house_or_dormitory || '');
  const bursary = ['full','partial'].includes(b.bursary_status) ? b.bursary_status : 'none';
  const bursaryAmount = Number(b.bursary_amount_ugx || 0);
  const photo = typeof b.photo_data_url === 'string' && /^data:image\/(png|jpeg|jpg|webp);base64,/i.test(b.photo_data_url) && b.photo_data_url.length <= 7000000 ? b.photo_data_url : null;
  if (!Number.isSafeInteger(bursaryAmount) || bursaryAmount < 0) return fail(res, 'Bursary amount must be a non-negative whole UGX amount.');
  if (!admission || !first || !last || !cls) return fail(res, "Admission number, first name, last name and class are required.");
  try {
    const result = db.prepare(`INSERT INTO students (admission_no,first_name,last_name,gender,date_of_birth,class_name,guardian_name,guardian_phone,boarding_status,takes_breakfast,takes_lunch,house_or_dormitory,photo_data_url,bursary_status,bursary_amount_ugx)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(admission, first, last, clean(b.gender || ""), clean(b.date_of_birth || ""), cls, clean(b.guardian_name || ""), clean(b.guardian_phone || ""), boarding, breakfast, lunch, dorm, photo, bursary, bursaryAmount);
    audit(req.user.id, "create", "student", result.lastInsertRowid, admission);
    res.status(201).json(db.prepare("SELECT * FROM students WHERE id=?").get(result.lastInsertRowid));
  } catch (e) { fail(res, e.code === "SQLITE_CONSTRAINT_UNIQUE" ? "That admission number already exists." : "Could not save student."); }
});

// Staff records
app.get("/api/staff", auth, allow("read"), (req, res) => {
  const rows = db.prepare("SELECT * FROM staff ORDER BY full_name LIMIT 500").all();
  if (!['admin','headteacher'].includes(req.user.role)) rows.forEach(s => { delete s.monthly_salary_ugx; delete s.payment_day; });
  res.json(rows);
});
app.post("/api/staff", auth, allow("staff:write"), (req, res) => {
  const b = req.body || {};
  const salary = Number(b.monthly_salary_ugx || 0), payDay = Number(b.payment_day || 30);
  const type = b.staff_type === 'non_teaching' ? 'non_teaching' : 'teaching';
  const photo = typeof b.photo_data_url === 'string' && /^data:image\/(png|jpeg|jpg|webp);base64,/i.test(b.photo_data_url) && b.photo_data_url.length <= 7000000 ? b.photo_data_url : null;
  if (!clean(b.staff_no || "") || !clean(b.full_name || "") || !clean(b.role_title || "")) return fail(res, "Staff number, name and job title are required.");
  if (!Number.isSafeInteger(salary) || salary < 0 || !Number.isInteger(payDay) || payDay < 1 || payDay > 31) return fail(res, "Enter a valid salary and payment day from 1 to 31.");
  try {
    const r = db.prepare("INSERT INTO staff (staff_no,full_name,role_title,phone,email,staff_type,monthly_salary_ugx,payment_day,photo_data_url) VALUES (?,?,?,?,?,?,?,?,?)")
      .run(clean(b.staff_no), clean(b.full_name), clean(b.role_title), clean(b.phone || ""), clean(b.email || ""), type, salary, payDay, photo);
    audit(req.user.id, "create", "staff", r.lastInsertRowid, b.staff_no);
    res.status(201).json(db.prepare("SELECT * FROM staff WHERE id=?").get(r.lastInsertRowid));
  } catch { fail(res, "Could not save staff record. Check that the staff number is unique."); }
});

// Salary tracking: one payment record per staff member for each of the three months in a term.
app.get("/api/payroll", auth, allow("staff:write"), (req, res) => {
  const year = Number(req.query.academic_year || new Date().getFullYear());
  const term = clean(req.query.term || 'Term 1');
  const rows = db.prepare(`SELECT s.id staff_id,s.staff_no,s.full_name,s.staff_type,s.monthly_salary_ugx,s.payment_day,s.photo_data_url,
    p.term_month,p.amount_paid_ugx,p.paid_on,p.reference
    FROM staff s LEFT JOIN staff_salary_payments p ON p.staff_id=s.id AND p.academic_year=? AND p.term=?
    WHERE s.status='active' ORDER BY s.staff_type,s.full_name,p.term_month`).all(year, term);
  const grouped = new Map();
  for (const row of rows) {
    if (!grouped.has(row.staff_id)) grouped.set(row.staff_id, {...row, months: [null,null,null]});
    if (row.term_month) grouped.get(row.staff_id).months[row.term_month-1] = {amount_paid_ugx:row.amount_paid_ugx,paid_on:row.paid_on,reference:row.reference};
  }
  res.json([...grouped.values()].map(s => { const paid=s.months.reduce((n,m)=>n+Number(m?.amount_paid_ugx||0),0); const due=Number(s.monthly_salary_ugx||0)*3; return {...s,total_term_due_ugx:due,total_paid_ugx:paid,balance_ugx:Math.max(0,due-paid)}; }));
});
app.post("/api/payroll", auth, allow("staff:write"), (req, res) => {
  const b=req.body||{}, staffId=Number(b.staff_id), year=Number(b.academic_year), month=Number(b.term_month), amount=Number(b.amount_paid_ugx);
  const term=clean(b.term||''), paidOn=clean(b.paid_on||'');
  if (!positiveInt(staffId) || !Number.isInteger(year) || year<2000 || year>2200 || !['Term 1','Term 2','Term 3'].includes(term) || !Number.isInteger(month) || month<1 || month>3 || !Number.isSafeInteger(amount) || amount<=0 || !/^\d{4}-\d{2}-\d{2}$/.test(paidOn)) return fail(res,'Choose staff, academic year, term, term month (1-3), payment date and a positive whole UGX amount.');
  if (!db.prepare("SELECT id FROM staff WHERE id=? AND status=\'active\'").get(staffId)) return fail(res,'Staff member not found or inactive.');
  try { const r=db.prepare(`INSERT INTO staff_salary_payments (staff_id,academic_year,term,term_month,amount_paid_ugx,paid_on,reference,recorded_by) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(staff_id,academic_year,term,term_month) DO UPDATE SET amount_paid_ugx=excluded.amount_paid_ugx,paid_on=excluded.paid_on,reference=excluded.reference,recorded_by=excluded.recorded_by`).run(staffId,year,term,month,amount,paidOn,clean(b.reference||''),req.user.id); audit(req.user.id,'record_salary_payment','staff',staffId,`${term} month ${month}: ${amount}`); res.json({ok:true}); }
  catch { fail(res,'Could not save salary payment.'); }
});

// Inventory
app.get("/api/inventory", auth, allow("read"), (_req, res) => res.json(db.prepare("SELECT * FROM inventory_items ORDER BY item_name LIMIT 500").all()));
app.post("/api/inventory", auth, allow("inventory:write"), (req, res) => {
  const b = req.body || {};
  if (!clean(b.item_code || "") || !clean(b.item_name || "")) return fail(res, "Item code and item name are required.");
  const qty = Number(b.quantity || 0), reorder = Number(b.reorder_level || 0), cost = Number(b.unit_cost || 0);
  if (![qty,reorder,cost].every(Number.isFinite) || qty < 0 || reorder < 0 || cost < 0 || !Number.isSafeInteger(cost)) return fail(res, "Enter valid non-negative stock quantities and whole UGX unit cost.");
  try {
    const r = db.prepare("INSERT INTO inventory_items (item_code,item_name,category,unit,quantity,reorder_level,unit_cost,location) VALUES (?,?,?,?,?,?,?,?)")
      .run(clean(b.item_code), clean(b.item_name), clean(b.category || ""), clean(b.unit || "piece"), qty, reorder, cost, clean(b.location || ""));
    if (qty > 0) db.prepare("INSERT INTO stock_movements (item_id,movement_type,quantity,note,created_by) VALUES (?,'received',?,'Opening balance',?)").run(r.lastInsertRowid, qty, req.user.id);
    audit(req.user.id, "create", "inventory_item", r.lastInsertRowid, b.item_code);
    res.status(201).json(db.prepare("SELECT * FROM inventory_items WHERE id=?").get(r.lastInsertRowid));
  } catch { fail(res, "Could not save item. Check that the item code is unique."); }
});
app.post("/api/inventory/:id/movements", auth, allow("inventory:write"), (req, res) => {
  const item = db.prepare("SELECT * FROM inventory_items WHERE id=?").get(Number(req.params.id));
  const qty = Number(req.body.quantity), type = req.body.movement_type;
  if (!item) return fail(res, "Item not found.", 404);
  if (!["received","issued"].includes(type) || !Number.isFinite(qty) || qty <= 0) return fail(res, "Choose received or issued and enter a positive quantity.");
  if (type === "issued" && item.quantity < qty) return fail(res, "Not enough stock available.");
  const update = db.transaction(() => {
    db.prepare("UPDATE inventory_items SET quantity=quantity+? WHERE id=?").run(type === "received" ? qty : -qty, item.id);
    db.prepare("INSERT INTO stock_movements (item_id,movement_type,quantity,note,created_by) VALUES (?,?,?,?,?)")
      .run(item.id, type, qty, clean(req.body.note || ""), req.user.id);
    audit(req.user.id, type, "inventory_item", item.id, `quantity=${qty}`);
  });
  update();
  res.json(db.prepare("SELECT * FROM inventory_items WHERE id=?").get(item.id));
});

// Fees and numbered receipts
app.get("/api/payments", auth, allow("read"), (_req, res) => res.json(db.prepare(`SELECT p.*, s.admission_no, s.first_name, s.last_name, s.class_name
  FROM fee_payments p JOIN students s ON s.id=p.student_id ORDER BY p.id DESC LIMIT 500`).all()));
app.post("/api/payments", auth, allow("fees:write"), (req, res) => {
  const b = req.body || {};
  const studentId = Number(b.student_id), amount = Number(b.amount_ugx);
  if (!positiveInt(studentId) || !Number.isSafeInteger(amount) || amount <= 0) return fail(res, "Choose a student and enter a positive whole-number UGX amount.");
  if (!["cash","bank","mobile_money","cheque"].includes(b.payment_method)) return fail(res, "Choose a valid payment method.");
  const student = db.prepare("SELECT id FROM students WHERE id=? AND status='active'").get(studentId);
  if (!student) return fail(res, "Student not found or inactive.");
  const receipt = `RCP-${new Date().getFullYear()}-${Date.now().toString().slice(-8)}`;
  const term = clean(b.term || ""), year = Number(b.academic_year);
  if (!term || !Number.isInteger(year) || year < 2000 || year > 2200) return fail(res, "Term and valid academic year are required.");
  try {
    const r = db.prepare("INSERT INTO fee_payments (receipt_no,student_id,amount_ugx,payment_method,term,academic_year,reference,received_by) VALUES (?,?,?,?,?,?,?,?)")
      .run(receipt, studentId, amount, b.payment_method, term, year, clean(b.reference || ""), req.user.id);
    audit(req.user.id, "create", "fee_payment", r.lastInsertRowid, receipt);
    res.status(201).json(db.prepare(`SELECT p.*, s.admission_no, s.first_name, s.last_name, s.class_name
      FROM fee_payments p JOIN students s ON s.id=p.student_id WHERE p.id=?`).get(r.lastInsertRowid));
  } catch { fail(res, "Could not record payment."); }
});

// Attendance
app.get("/api/attendance", auth, allow("read"), (req, res) => {
  const date = String(req.query.date || new Date().toISOString().slice(0,10));
  res.json(db.prepare(`SELECT a.*, s.admission_no, s.first_name, s.last_name, s.class_name FROM attendance a
    JOIN students s ON s.id=a.student_id WHERE a.attendance_date=? ORDER BY s.class_name,s.last_name`).all(date));
});
app.post("/api/attendance", auth, allow("attendance:write"), (req, res) => {
  const b = req.body || {}, studentId = Number(b.student_id), date = clean(b.attendance_date || new Date().toISOString().slice(0,10));
  if (!positiveInt(studentId) || !["present","absent","late","excused"].includes(b.status)) return fail(res, "Choose a student and valid attendance status.");
  try {
    db.prepare(`INSERT INTO attendance (student_id,attendance_date,status,note,recorded_by) VALUES (?,?,?,?,?)
      ON CONFLICT(student_id,attendance_date) DO UPDATE SET status=excluded.status,note=excluded.note,recorded_by=excluded.recorded_by`)
      .run(studentId, date, b.status, clean(b.note || ""), req.user.id);
    audit(req.user.id, "upsert", "attendance", studentId, `${date}:${b.status}`);
    res.json({ ok: true });
  } catch { fail(res, "Could not save attendance. Check the student and date."); }
});

// Expenses and reports
app.get("/api/expenses", auth, allow("read"), (_req, res) => res.json(db.prepare("SELECT * FROM expenses ORDER BY expense_date DESC,id DESC LIMIT 500").all()));
app.post("/api/expenses", auth, allow("expenses:write"), (req, res) => {
  const b = req.body || {}, amount = Number(b.amount_ugx);
  if (!clean(b.category || "") || !clean(b.description || "") || !clean(b.expense_date || "") || !Number.isSafeInteger(amount) || amount <= 0) return fail(res, "Date, category, description and positive whole-number UGX amount are required.");
  if (!["cash","bank","mobile_money","cheque"].includes(b.payment_method)) return fail(res, "Choose a valid payment method.");
  const no = `EXP-${new Date().getFullYear()}-${Date.now().toString().slice(-8)}`;
  try {
    const r = db.prepare("INSERT INTO expenses (expense_no,expense_date,category,description,amount_ugx,payment_method,reference,recorded_by) VALUES (?,?,?,?,?,?,?,?)")
      .run(no, b.expense_date, clean(b.category), clean(b.description), amount, b.payment_method, clean(b.reference || ""), req.user.id);
    audit(req.user.id, "create", "expense", r.lastInsertRowid, no);
    res.status(201).json(db.prepare("SELECT * FROM expenses WHERE id=?").get(r.lastInsertRowid));
  } catch { fail(res, "Could not record expense."); }
});
app.get("/api/reports/finance", auth, allow("reports:read"), (_req, res) => {
  const income = db.prepare("SELECT COALESCE(SUM(amount_ugx),0) total FROM fee_payments").get().total;
  const expenses = db.prepare("SELECT COALESCE(SUM(amount_ugx),0) total FROM expenses").get().total;
  const methods = db.prepare("SELECT payment_method, SUM(amount_ugx) total FROM fee_payments GROUP BY payment_method").all();
  res.json({ totalFeesCollectedUGX: income, totalExpensesUGX: expenses, netCashMovementUGX: income - expenses, feePaymentsByMethod: methods });
});
app.get("/api/reports/low-stock", auth, allow("reports:read"), (_req, res) => {
  res.json(db.prepare("SELECT item_code,item_name,quantity,unit,reorder_level,location FROM inventory_items WHERE quantity <= reorder_level ORDER BY item_name").all());
});

// Admin can create separate staff logins. Never expose password hashes.
// Academic records: subjects, three assessment periods, marks and class analysis.
const SCHOOL_CLASSES = ["Baby","Middle","Top","P.1","P.2","P.3","P.4","P.5","P.6","P.7"];
const ACADEMIC_TERMS = ["Term 1","Term 2","Term 3"];
const ASSESSMENT_PERIODS = ["Beginning of Term","Mid-Term","End of Term"];
app.get("/api/academic/subjects", auth, allow("read"), (req,res) => {
  const cls = String(req.query.class_name || "");
  if (!SCHOOL_CLASSES.includes(cls)) return fail(res,"Choose a valid class.");
  res.json(db.prepare("SELECT subject_name FROM academic_subjects WHERE class_name=? AND active=1 ORDER BY sort_order, subject_name").all(cls).map(x=>x.subject_name));
});
app.put("/api/academic/subjects", auth, allow("academic:write"), (req,res) => {
  const cls=clean(req.body.class_name||"");
  const subjects=Array.isArray(req.body.subjects)?req.body.subjects.map(x=>String(x||"").trim()).filter(Boolean):[];
  if(!SCHOOL_CLASSES.includes(cls)) return fail(res,"Choose a valid class.");
  if(subjects.length>20) return fail(res,"A class can have up to 20 subjects.");
  if(subjects.some(x=>x.length>60) || new Set(subjects.map(x=>x.toLowerCase())).size!==subjects.length) return fail(res,"Subject names must be under 60 characters and must not repeat.");
  const tx=db.transaction(()=>{
    db.prepare("UPDATE academic_subjects SET active=0 WHERE class_name=?").run(cls);
    subjects.forEach((name,i)=>db.prepare(`INSERT INTO academic_subjects(class_name,subject_name,sort_order,active) VALUES(?,?,?,1) ON CONFLICT(class_name,subject_name) DO UPDATE SET sort_order=excluded.sort_order,active=1`).run(cls,name,i));
  });
  tx(); audit(req.user.id,"update","academic_subjects",null,cls+": "+subjects.join(", "));
  res.json({class_name:cls,subjects});
});
// School-configured grading bands and term ranking summary.
app.get("/api/academic/grading", auth, allow("read"), (_req,res) => {
  res.json(db.prepare("SELECT label,min_mark,max_mark,remark FROM academic_grade_bands ORDER BY min_mark DESC").all());
});
app.put("/api/academic/grading", auth, allow("academic:write"), (req,res) => {
  const bands=Array.isArray(req.body.bands)?req.body.bands:[];
  if(bands.length>20) return fail(res,"Use no more than 20 grade bands.");
  const parsed=bands.map(b=>({label:String(b.label||"").trim(),min:Number(b.min_mark),max:Number(b.max_mark),remark:String(b.remark||"").trim()}));
  if(parsed.some(b=>!b.label||b.label.length>30||!Number.isFinite(b.min)||!Number.isFinite(b.max)||b.min<0||b.max>100||b.min>b.max||b.remark.length>120)) return fail(res,"Each grade needs a label, valid mark range from 0 to 100, and a short remark.");
  if(new Set(parsed.map(b=>b.label.toLowerCase())).size!==parsed.length) return fail(res,"Grade labels must be unique.");
  const sorted=[...parsed].sort((a,b)=>a.min-b.min);
  for(let i=1;i<sorted.length;i++){if(sorted[i].min<=sorted[i-1].max) return fail(res,"Grade ranges must not overlap.");}
  const tx=db.transaction(()=>{db.prepare("DELETE FROM academic_grade_bands").run();const ins=db.prepare("INSERT INTO academic_grade_bands(label,min_mark,max_mark,remark) VALUES(?,?,?,?)");for(const b of parsed)ins.run(b.label,b.min,b.max,b.remark);});
  tx();audit(req.user.id,"update","academic_grade_bands",null,`${parsed.length} grading bands configured`);res.json({bands:db.prepare("SELECT label,min_mark,max_mark,remark FROM academic_grade_bands ORDER BY min_mark DESC").all()});
});
app.get("/api/academic/ranking", auth, allow("read"), (req,res) => {
  const cls=String(req.query.class_name||""), year=Number(req.query.academic_year), term=String(req.query.term||"");
  if(!SCHOOL_CLASSES.includes(cls)||!Number.isInteger(year)||year<2000||year>2100||!ACADEMIC_TERMS.includes(term)) return fail(res,"Choose a valid class, year and term.");
  const learners=db.prepare(`SELECT s.id student_id,s.admission_no,s.first_name,s.last_name, m.mark
    FROM students s LEFT JOIN academic_marks m ON m.student_id=s.id AND m.academic_year=? AND m.term=?
    WHERE s.class_name=? AND s.status='active' ORDER BY s.last_name,s.first_name`).all(year,term,cls);
  const grouped=new Map();
  for(const r of learners){if(!grouped.has(r.student_id))grouped.set(r.student_id,{student_id:r.student_id,admission_no:r.admission_no,name:r.first_name+" "+r.last_name,marks:[]});if(r.mark!==null&&r.mark!==undefined)grouped.get(r.student_id).marks.push(Number(r.mark));}
  const result=[...grouped.values()].map(x=>({...x,marks_entered:x.marks.length,total:x.marks.length?Math.round(x.marks.reduce((a,b)=>a+b,0)*10)/10:null,average:x.marks.length?Math.round(x.marks.reduce((a,b)=>a+b,0)/x.marks.length*10)/10:null})).sort((a,b)=>{if(a.average===null&&b.average!==null)return 1;if(b.average===null&&a.average!==null)return -1;return (b.average??-1)-(a.average??-1)||a.name.localeCompare(b.name)});
  let lastAvg=null,rank=0;result.forEach((x,i)=>{if(x.average===null){x.rank=null;return;}if(lastAvg===null||x.average!==lastAvg)rank=i+1;x.rank=rank;lastAvg=x.average;delete x.marks;});
  res.json({class_name:cls,academic_year:year,term,learner_count:result.length,learners:result});
});

app.get("/api/academic/year-summary", auth, allow("read"), (req,res) => {
  const cls=String(req.query.class_name||""), year=Number(req.query.academic_year);
  if(!SCHOOL_CLASSES.includes(cls)||!Number.isInteger(year)||year<2000||year>2100) return fail(res,"Choose a valid class and academic year.");
  const nextClass={"Baby":"Middle","Middle":"Top","Top":"P.1","P.1":"P.2","P.2":"P.3","P.3":"P.4","P.4":"P.5","P.5":"P.6","P.6":"P.7","P.7":"Completion / school review"}[cls];
  const raw=db.prepare(`SELECT s.id student_id,s.admission_no,s.first_name,s.last_name,m.term,m.mark
    FROM students s LEFT JOIN academic_marks m ON m.student_id=s.id AND m.academic_year=?
    WHERE s.class_name=? AND s.status='active' ORDER BY s.last_name,s.first_name`).all(year,cls);
  const grouped=new Map();
  for(const row of raw){
    if(!grouped.has(row.student_id)) grouped.set(row.student_id,{student_id:row.student_id,admission_no:row.admission_no,name:row.first_name+" "+row.last_name,terms:{"Term 1":[],"Term 2":[],"Term 3":[]}});
    if(row.term&&row.mark!==null&&row.mark!==undefined) grouped.get(row.student_id).terms[row.term].push(Number(row.mark));
  }
  const learners=[...grouped.values()].map(x=>{
    const termAverages={};
    for(const term of ACADEMIC_TERMS){const marks=x.terms[term];termAverages[term]=marks.length?Math.round(marks.reduce((a,b)=>a+b,0)/marks.length*10)/10:null;}
    const completed=Object.values(termAverages).filter(v=>v!==null);
    return {student_id:x.student_id,admission_no:x.admission_no,name:x.name,term_averages:termAverages,terms_with_marks:completed.length,annual_average:completed.length?Math.round(completed.reduce((a,b)=>a+b,0)/completed.length*10)/10:null,marks_entered:Object.values(x.terms).reduce((n,a)=>n+a.length,0),suggested_next_class:nextClass,review_status:completed.length===3?"Ready for promotion review":completed.length?"Incomplete year results":"Missing results"};
  }).sort((a,b)=>{if(a.annual_average===null&&b.annual_average!==null)return 1;if(b.annual_average===null&&a.annual_average!==null)return -1;return (b.annual_average??-1)-(a.annual_average??-1)||a.name.localeCompare(b.name)});
  let last=null,rank=0;learners.forEach((x,i)=>{if(x.annual_average===null){x.rank=null;return;}if(last===null||x.annual_average!==last)rank=i+1;x.rank=rank;last=x.annual_average;});
  res.json({class_name:cls,academic_year:year,suggested_next_class:nextClass,learner_count:learners.length,learners,notice:"This is an academic review aid only. It does not promote learners automatically or apply a pass mark. School leadership must decide promotion using approved school policy and complete records."});
});

app.get("/api/academic/marks", auth, allow("read"), (req,res) => {
  const cls=String(req.query.class_name||""), year=Number(req.query.academic_year), term=String(req.query.term||""), period=String(req.query.assessment_period||"");
  if(!SCHOOL_CLASSES.includes(cls)||!Number.isInteger(year)||year<2000||year>2100||!ACADEMIC_TERMS.includes(term)||!ASSESSMENT_PERIODS.includes(period)) return fail(res,"Choose a valid class, year, term and assessment period.");
  res.json(db.prepare(`SELECT s.id student_id,s.admission_no,s.first_name,s.last_name,s.class_name,m.subject_name,m.mark,m.comment
    FROM students s LEFT JOIN academic_marks m ON m.student_id=s.id AND m.academic_year=? AND m.term=? AND m.assessment_period=?
    WHERE s.class_name=? AND s.status='active' ORDER BY s.last_name,s.first_name,m.subject_name`).all(year,term,period,cls));
});
app.post("/api/academic/marks/bulk", auth, allow("academic:write"), (req,res) => {
  const b=req.body||{}, cls=clean(b.class_name||""), year=Number(b.academic_year), term=clean(b.term||""), period=clean(b.assessment_period||""), rows=Array.isArray(b.marks)?b.marks:[];
  if(!SCHOOL_CLASSES.includes(cls)||!Number.isInteger(year)||year<2000||year>2100||!ACADEMIC_TERMS.includes(term)||!ASSESSMENT_PERIODS.includes(period)) return fail(res,"Choose a valid class, year, term and assessment period.");
  if(rows.length>3000) return fail(res,"Too many marks in one save.");
  const validSubjects=new Set(db.prepare("SELECT subject_name FROM academic_subjects WHERE class_name=? AND active=1").all(cls).map(x=>x.subject_name));
  const studentExists=db.prepare("SELECT id FROM students WHERE id=? AND class_name=? AND status='active'");
  const save=db.prepare(`INSERT INTO academic_marks(student_id,subject_name,academic_year,term,assessment_period,mark,comment,recorded_by,updated_at)
    VALUES(?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(student_id,subject_name,academic_year,term,assessment_period)
    DO UPDATE SET mark=excluded.mark,comment=excluded.comment,recorded_by=excluded.recorded_by,updated_at=CURRENT_TIMESTAMP`);
  try {
    const tx=db.transaction(()=>{ for(const r of rows){
      const sid=Number(r.student_id), subject=String(r.subject_name||"");
      if(!positiveInt(sid)||!studentExists.get(sid,cls)||!validSubjects.has(subject)) throw Error("A learner or subject does not match this class. Refresh and try again.");
      let mark=r.mark===null||r.mark===""?null:Number(r.mark);
      if(mark!==null&&(!Number.isFinite(mark)||mark<0||mark>100)) throw Error("Marks must be between 0 and 100.");
      const comment=String(r.comment||"").slice(0,300);
      save.run(sid,subject,year,term,period,mark,comment,req.user.id);
    }}); tx();
    audit(req.user.id,"save","academic_marks",null,`${cls}, ${year}, ${term}, ${period}, ${rows.length} marks`);
    res.json({saved:rows.length});
  } catch(e) { return fail(res,e.message||"Could not save marks."); }
});
app.get("/api/academic/report-card", auth, allow("read"), (req,res) => {
  const studentId=Number(req.query.student_id), year=Number(req.query.academic_year), term=String(req.query.term||"");
  if(!positiveInt(studentId)||!Number.isInteger(year)||year<2000||year>2100||!ACADEMIC_TERMS.includes(term)) return fail(res,"Choose a learner, valid academic year and term.");
  const learner=db.prepare("SELECT id,admission_no,first_name,last_name,class_name,gender,photo_data_url,guardian_name FROM students WHERE id=? AND status='active'").get(studentId);
  if(!learner) return fail(res,"Learner not found or inactive.",404);
  const subjects=db.prepare("SELECT subject_name FROM academic_subjects WHERE class_name=? AND active=1 ORDER BY sort_order,subject_name").all(learner.class_name).map(x=>x.subject_name);
  const rows=db.prepare("SELECT subject_name,assessment_period,mark,comment FROM academic_marks WHERE student_id=? AND academic_year=? AND term=? ORDER BY subject_name").all(studentId,year,term);
  const marks={}; for(const subject of subjects){ marks[subject]={}; for(const period of ASSESSMENT_PERIODS) marks[subject][period]=null; }
  const comments={}; for(const r of rows){if(!marks[r.subject_name]) marks[r.subject_name]={}; marks[r.subject_name][r.assessment_period]=r.mark; if(r.comment) comments[r.subject_name]=r.comment;}
  const gradeBands=db.prepare("SELECT label,min_mark,max_mark,remark FROM academic_grade_bands ORDER BY min_mark DESC").all();
  const result=subjects.map(subject=>{const m=marks[subject]||{};const vals=ASSESSMENT_PERIODS.map(period=>m[period]).filter(v=>v!==null&&v!==undefined&&v!=="").map(Number);const average=vals.length?Math.round(vals.reduce((a,b)=>a+b,0)/vals.length*10)/10:null;const band=average===null?null:gradeBands.find(g=>average>=g.min_mark&&average<=g.max_mark);return {subject,marks:m,average,grade:band?.label||null,remark:band?.remark||comments[subject]||""};});
  const averages=result.map(r=>r.average).filter(v=>v!==null); const overall=averages.length?Math.round(averages.reduce((a,b)=>a+b,0)/averages.length*10)/10:null;
  const overallBand=overall===null?null:gradeBands.find(g=>overall>=g.min_mark&&overall<=g.max_mark);
  const dateFrom=String(req.query.date_from||""), dateTo=String(req.query.date_to||"");
  const validDate=v=>/^\d{4}-\d{2}-\d{2}$/.test(v)&&!Number.isNaN(Date.parse(v));
  if((dateFrom&&!validDate(dateFrom))||(dateTo&&!validDate(dateTo))||(dateFrom&&dateTo&&dateFrom>dateTo)) return fail(res,"Attendance date range is invalid.");
  let attendance={present:0,absent:0,late:0,excused:0,total:0,date_from:dateFrom||null,date_to:dateTo||null};
  if(dateFrom&&dateTo){
    const counts=db.prepare("SELECT status,COUNT(*) n FROM attendance WHERE student_id=? AND attendance_date BETWEEN ? AND ? GROUP BY status").all(studentId,dateFrom,dateTo);
    for(const c of counts) attendance[c.status]=c.n;
    attendance.total=counts.reduce((n,c)=>n+c.n,0);
  }
  const notes=db.prepare("SELECT class_teacher_comment,headteacher_comment,updated_at FROM academic_report_notes WHERE student_id=? AND academic_year=? AND term=?").get(studentId,year,term)||{class_teacher_comment:"",headteacher_comment:"",updated_at:null};
  res.json({learner,academic_year:year,term,assessment_periods:ASSESSMENT_PERIODS,subjects:result,summary:{subjects_with_marks:averages.length,total_subjects:subjects.length,overall_average:overall,overall_grade:overallBand?.label||null,overall_remark:overallBand?.remark||""},grading_configured:gradeBands.length>0,attendance,notes});
});

app.put("/api/academic/report-notes", auth, allow("academic:write"), (req,res) => {
  const b=req.body||{}, studentId=Number(b.student_id), year=Number(b.academic_year), term=String(b.term||"");
  const teacher=String(b.class_teacher_comment||"").trim(), head=String(b.headteacher_comment||"").trim();
  if(!positiveInt(studentId)||!Number.isInteger(year)||year<2000||year>2100||!ACADEMIC_TERMS.includes(term)) return fail(res,"Choose a learner, valid academic year and term.");
  if(teacher.length>1000||head.length>1000) return fail(res,"Each report comment must be 1,000 characters or fewer.");
  const learner=db.prepare("SELECT id,class_name FROM students WHERE id=? AND status='active'").get(studentId);
  if(!learner) return fail(res,"Learner not found or inactive.",404);
  db.prepare(`INSERT INTO academic_report_notes(student_id,academic_year,term,class_teacher_comment,headteacher_comment,recorded_by,updated_at)
    VALUES(?,?,?,?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(student_id,academic_year,term) DO UPDATE SET
    class_teacher_comment=excluded.class_teacher_comment,headteacher_comment=excluded.headteacher_comment,recorded_by=excluded.recorded_by,updated_at=CURRENT_TIMESTAMP`)
    .run(studentId,year,term,teacher,head,req.user.id);
  audit(req.user.id,"save","academic_report_notes",studentId,`${year} ${term}`);
  res.json({saved:true,class_teacher_comment:teacher,headteacher_comment:head});
});

app.get("/api/academic/analysis", auth, allow("read"), (req,res) => {
  const cls=String(req.query.class_name||""), year=Number(req.query.academic_year), term=String(req.query.term||""), period=String(req.query.assessment_period||"");
  if(!SCHOOL_CLASSES.includes(cls)||!Number.isInteger(year)||year<2000||year>2100||!ACADEMIC_TERMS.includes(term)||!ASSESSMENT_PERIODS.includes(period)) return fail(res,"Choose a valid class, year, term and assessment period.");
  const subjects=db.prepare("SELECT subject_name FROM academic_subjects WHERE class_name=? AND active=1 ORDER BY sort_order,subject_name").all(cls).map(x=>x.subject_name);
  const rows=db.prepare(`SELECT s.id student_id,s.admission_no,s.first_name,s.last_name, m.subject_name,m.mark
    FROM students s LEFT JOIN academic_marks m ON m.student_id=s.id AND m.academic_year=? AND m.term=? AND m.assessment_period=?
    WHERE s.class_name=? AND s.status='active' ORDER BY s.last_name,s.first_name`).all(year,term,period,cls);
  const learners=new Map(); for(const r of rows){if(!learners.has(r.student_id))learners.set(r.student_id,{student_id:r.student_id,admission_no:r.admission_no,name:r.first_name+" "+r.last_name,marks:{}});if(r.subject_name)learners.get(r.student_id).marks[r.subject_name]=r.mark;}
  const summary=subjects.map(subject=>{const vals=[...learners.values()].map(x=>x.marks[subject]).filter(v=>v!==null&&v!==undefined&&v!=="").map(Number);return {subject,entered:vals.length,average:vals.length?Math.round(vals.reduce((a,b)=>a+b,0)/vals.length*10)/10:null,highest:vals.length?Math.max(...vals):null,lowest:vals.length?Math.min(...vals):null}});
  res.json({class_name:cls,academic_year:year,term,assessment_period:period,learner_count:learners.size,subjects:summary,learners:[...learners.values()]});
});

app.get("/api/users", auth, allow("*"), (_req, res) => res.json(db.prepare("SELECT id,username,full_name,role,active,created_at FROM users ORDER BY full_name").all()));
app.post("/api/users", auth, allow("*"), (req, res) => {
  const b = req.body || {}, username = clean(b.username || ""), password = b.password || "", name = clean(b.full_name || "");
  if (!username || !name || password.length < 12 || !["admin","headteacher","bursar","teacher","storekeeper"].includes(b.role)) return fail(res, "Enter name, username, a valid role, and password of at least 12 characters.");
  try {
    const hash = bcrypt.hashSync(password, 12);
    const r = db.prepare("INSERT INTO users (username,password_hash,full_name,role,active) VALUES (?,?,?,?,1)").run(username, hash, name, b.role);
    audit(req.user.id, "create", "user", r.lastInsertRowid, username);
    res.status(201).json(db.prepare("SELECT id,username,full_name,role,active FROM users WHERE id=?").get(r.lastInsertRowid));
  } catch { fail(res, "Could not create user. The username may already be taken."); }
});

app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api/")) return next();
  res.sendFile(path.join(__dirname, "public", "index.html"));
});
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: "Unexpected server error." });
});
const port = Number(process.env.PORT || 3000);
app.listen(port, "0.0.0.0", () => console.log(`School Management System running on http://localhost:${port}`));
