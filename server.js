// QistBook — Installment (Qist) business manager
// Express + PostgreSQL (Neon). Single process serves API + static UI.
process.env.TZ = process.env.TZ || 'Asia/Karachi';
const express = require('express');
const crypto = require('crypto');
const path = require('path');
const { Pool, types } = require('pg');
types.setTypeParser(1082, (v) => v); // DATE as plain 'YYYY-MM-DD' string

const PORT = process.env.PORT || 3000;
const DATABASE_URL = process.env.DATABASE_URL;
const SECRET = process.env.APP_SECRET || 'change-this-secret-on-render';
if (!DATABASE_URL) { console.error('DATABASE_URL is required'); process.exit(1); }

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: /localhost|127\.0\.0\.1|host=\/tmp/.test(DATABASE_URL) ? false : { rejectUnauthorized: false },
});
const q = (text, params) => pool.query(text, params);

// ---------- schema ----------
async function migrate() {
  await q(`
  CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY, name TEXT NOT NULL, pin TEXT NOT NULL UNIQUE,
    role TEXT NOT NULL DEFAULT 'staff', active BOOLEAN DEFAULT TRUE, created_at TIMESTAMPTZ DEFAULT now());
  CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
  CREATE TABLE IF NOT EXISTS products (
    id SERIAL PRIMARY KEY, name TEXT NOT NULL, category TEXT DEFAULT 'Electronics',
    cost_price NUMERIC DEFAULT 0, cash_price NUMERIC NOT NULL DEFAULT 0, stock INT DEFAULT 0,
    active BOOLEAN DEFAULT TRUE, created_at TIMESTAMPTZ DEFAULT now());
  CREATE TABLE IF NOT EXISTS packages (
    id SERIAL PRIMARY KEY, name TEXT NOT NULL, description TEXT DEFAULT '',
    active BOOLEAN DEFAULT TRUE, created_at TIMESTAMPTZ DEFAULT now());
  CREATE TABLE IF NOT EXISTS package_items (
    id SERIAL PRIMARY KEY, package_id INT REFERENCES packages(id) ON DELETE CASCADE,
    product_id INT REFERENCES products(id), qty INT NOT NULL DEFAULT 1);
  CREATE TABLE IF NOT EXISTS customers (
    id SERIAL PRIMARY KEY, name TEXT NOT NULL, father_name TEXT DEFAULT '', phone TEXT DEFAULT '',
    cnic TEXT DEFAULT '', address TEXT DEFAULT '', area TEXT DEFAULT '',
    guarantor_name TEXT DEFAULT '', guarantor_phone TEXT DEFAULT '', guarantor_cnic TEXT DEFAULT '',
    notes TEXT DEFAULT '', created_at TIMESTAMPTZ DEFAULT now());
  CREATE TABLE IF NOT EXISTS sales (
    id SERIAL PRIMARY KEY, bill_no TEXT UNIQUE, customer_id INT REFERENCES customers(id),
    sale_date DATE NOT NULL DEFAULT CURRENT_DATE, package_id INT REFERENCES packages(id),
    items_total NUMERIC NOT NULL, markup_pct NUMERIC DEFAULT 0, markup_amt NUMERIC DEFAULT 0,
    discount NUMERIC DEFAULT 0, total NUMERIC NOT NULL, advance NUMERIC DEFAULT 0,
    plan_type TEXT NOT NULL CHECK (plan_type IN ('monthly','yearly')),
    installments_count INT NOT NULL, installment_amt NUMERIC NOT NULL, first_due_date DATE NOT NULL,
    notes TEXT DEFAULT '', created_by INT REFERENCES users(id), created_at TIMESTAMPTZ DEFAULT now());
  CREATE TABLE IF NOT EXISTS sale_items (
    id SERIAL PRIMARY KEY, sale_id INT REFERENCES sales(id) ON DELETE CASCADE,
    product_id INT REFERENCES products(id), name TEXT NOT NULL, qty INT NOT NULL DEFAULT 1, price NUMERIC NOT NULL);
  CREATE TABLE IF NOT EXISTS installments (
    id SERIAL PRIMARY KEY, sale_id INT REFERENCES sales(id) ON DELETE CASCADE,
    seq INT NOT NULL, due_date DATE NOT NULL, amount NUMERIC NOT NULL);
  CREATE TABLE IF NOT EXISTS payments (
    id SERIAL PRIMARY KEY, receipt_no TEXT, sale_id INT REFERENCES sales(id) ON DELETE CASCADE,
    customer_id INT REFERENCES customers(id), amount NUMERIC NOT NULL,
    kind TEXT NOT NULL DEFAULT 'installment', paid_on DATE NOT NULL DEFAULT CURRENT_DATE,
    method TEXT DEFAULT 'Cash', note TEXT DEFAULT '', received_by INT REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT now());
  CREATE TABLE IF NOT EXISTS expenses (
    id SERIAL PRIMARY KEY, exp_date DATE NOT NULL DEFAULT CURRENT_DATE, category TEXT NOT NULL,
    amount NUMERIC NOT NULL, direction TEXT NOT NULL DEFAULT 'out', note TEXT DEFAULT '',
    created_by INT REFERENCES users(id), created_at TIMESTAMPTZ DEFAULT now());
  CREATE INDEX IF NOT EXISTS idx_inst_sale ON installments(sale_id);
  CREATE INDEX IF NOT EXISTS idx_pay_sale ON payments(sale_id);
  CREATE INDEX IF NOT EXISTS idx_sales_cust ON sales(customer_id);
  CREATE TABLE IF NOT EXISTS suppliers (
    id SERIAL PRIMARY KEY, name TEXT NOT NULL, phone TEXT DEFAULT '', address TEXT DEFAULT '',
    opening_balance NUMERIC DEFAULT 0, notes TEXT DEFAULT '', created_at TIMESTAMPTZ DEFAULT now());
  CREATE TABLE IF NOT EXISTS purchases (
    id SERIAL PRIMARY KEY, purchase_no TEXT, supplier_id INT REFERENCES suppliers(id),
    purchase_date DATE NOT NULL DEFAULT CURRENT_DATE, total NUMERIC NOT NULL, invoice_ref TEXT DEFAULT '',
    note TEXT DEFAULT '', created_by INT REFERENCES users(id), created_at TIMESTAMPTZ DEFAULT now());
  CREATE TABLE IF NOT EXISTS purchase_items (
    id SERIAL PRIMARY KEY, purchase_id INT REFERENCES purchases(id) ON DELETE CASCADE,
    product_id INT REFERENCES products(id), qty INT NOT NULL, cost NUMERIC NOT NULL);
  CREATE TABLE IF NOT EXISTS supplier_payments (
    id SERIAL PRIMARY KEY, supplier_id INT REFERENCES suppliers(id), purchase_id INT REFERENCES purchases(id) ON DELETE CASCADE,
    amount NUMERIC NOT NULL, paid_on DATE NOT NULL DEFAULT CURRENT_DATE, method TEXT DEFAULT 'Cash', note TEXT DEFAULT '',
    created_by INT REFERENCES users(id), created_at TIMESTAMPTZ DEFAULT now());
  CREATE TABLE IF NOT EXISTS stock_moves (
    id SERIAL PRIMARY KEY, product_id INT REFERENCES products(id), move_date DATE NOT NULL DEFAULT CURRENT_DATE,
    kind TEXT NOT NULL, qty INT NOT NULL, unit_cost NUMERIC DEFAULT 0, ref_type TEXT, ref_id INT, ref_no TEXT DEFAULT '',
    note TEXT DEFAULT '', created_by INT REFERENCES users(id), created_at TIMESTAMPTZ DEFAULT now());
  CREATE INDEX IF NOT EXISTS idx_moves_prod ON stock_moves(product_id);
  ALTER TABLE customers ADD COLUMN IF NOT EXISTS code TEXT;
  ALTER TABLE customers ADD COLUMN IF NOT EXISTS plan_type TEXT DEFAULT 'monthly';
  ALTER TABLE sales ADD COLUMN IF NOT EXISTS is_opening BOOLEAN DEFAULT FALSE;
  ALTER TABLE sales ADD COLUMN IF NOT EXISTS old_ref TEXT DEFAULT '';
  `);
  await q(`INSERT INTO stock_moves(product_id,move_date,kind,qty,unit_cost,note)
    SELECT p.id, CURRENT_DATE, 'opening', p.stock, p.cost_price, 'Opening stock' FROM products p
    WHERE p.stock <> 0 AND NOT EXISTS (SELECT 1 FROM stock_moves m WHERE m.product_id=p.id)`);
  await q(`UPDATE customers c SET code = 'GM-' || (1000 + x.rn + COALESCE((SELECT max(substring(code from '\\d+$')::int) - 1000 FROM customers WHERE code ~ '^GM-\\d+$'), 0))
    FROM (SELECT id, row_number() OVER (ORDER BY id) rn FROM customers WHERE code IS NULL OR code = '') x WHERE c.id = x.id`);
  await q('CREATE UNIQUE INDEX IF NOT EXISTS idx_cust_code ON customers (upper(code))');
  // one-time: customers whose bills are yearly get the yearly plan
  if (!(await q("SELECT 1 FROM settings WHERE key='plan_backfilled'")).rows.length) {
    await q(`UPDATE customers c SET plan_type='yearly' WHERE EXISTS (SELECT 1 FROM sales s WHERE s.customer_id=c.id AND s.plan_type='yearly')
      AND NOT EXISTS (SELECT 1 FROM sales s WHERE s.customer_id=c.id AND s.plan_type='monthly')`);
    await q("INSERT INTO settings(key,value) VALUES ('plan_backfilled','1')");
  }
  const u = await q('SELECT count(*)::int c FROM users');
  if (u.rows[0].c === 0) {
    await q("INSERT INTO users(name,pin,role) VALUES ('Owner','1234','owner'),('Recovery Staff','1111','staff')");
  }
  const defaults = {
    business_name: 'Ghulam Mustafa Electronics', business_phone: '0300-0000000',
    business_address: 'Main Bazaar, Loralai', yearly_month: '8', yearly_day: '10',
    default_markup: '25', currency: 'Rs', code_prefix: 'GM',
    wa_template: 'Assalam o Alaikum {name}, aap ki qist Rs {amount} (Bill {bill}) {due} ko due hai. Baqaya: Rs {balance}. Shukriya — {business}',
    receipt_template: 'Assalam o Alaikum {name}, aap ki qist Rs {amount} wusool ho gayi (Receipt {receipt}, Bill {bill}). Baqaya: Rs {balance}. Shukriya — {business}',
  };
  // rename old default name if it was never changed
  await q("UPDATE settings SET value='Ghulam Mustafa Electronics' WHERE key='business_name' AND value IN ('Al-Madina Installments','Al Qayyum Electronics')");
  // one-time: switch the old AQ code prefix (from the earlier name) to GM
  if (!(await q("SELECT 1 FROM settings WHERE key='gm_codes_done'")).rows.length) {
    await q("UPDATE settings SET value='GM' WHERE key='code_prefix' AND value='AQ'");
    await q("UPDATE customers SET code = 'GM-' || substring(code from 4) WHERE code ~ '^AQ-\\d+$' AND NOT EXISTS (SELECT 1 FROM customers c2 WHERE upper(c2.code) = 'GM-' || substring(customers.code from 4))");
    await q("INSERT INTO settings(key,value) VALUES ('gm_codes_done','1')");
  }
  await q("UPDATE settings SET value='Main Bazaar, Loralai' WHERE key='business_address' AND value='Main Bazaar, Faisalabad'");
  for (const [k, v] of Object.entries(defaults)) {
    await q('INSERT INTO settings(key,value) VALUES ($1,$2) ON CONFLICT (key) DO NOTHING', [k, v]);
  }
}

// ---------- helpers ----------
const num = (v) => Math.round((parseFloat(v) || 0) * 100) / 100;
const ymd = (d) => {
  if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}/.test(d)) return d.slice(0, 10);
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
};
const today = () => ymd(new Date());
function addMonths(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const target = new Date(y, m - 1 + n, 1);
  const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(d, last));
  return ymd(target);
}
async function getSettings() {
  const r = await q('SELECT key,value FROM settings');
  return Object.fromEntries(r.rows.map((x) => [x.key, x.value]));
}
function nextYearlyDate(fromStr, month, day) {
  const from = new Date(fromStr);
  let y = from.getFullYear();
  let cand = ymd(new Date(y, month - 1, day));
  if (cand <= fromStr) cand = ymd(new Date(y + 1, month - 1, day));
  return cand;
}
function buildSchedule(financed, count, planType, firstDue) {
  const out = [];
  if (financed <= 0 || count <= 0) return out;
  const base = Math.round(financed / count);
  let running = 0;
  for (let i = 0; i < count; i++) {
    const amt = i === count - 1 ? num(financed - running) : base;
    running += amt;
    out.push({ seq: i + 1, due_date: planType === 'monthly' ? addMonths(firstDue, i) : addMonths(firstDue, 12 * i), amount: amt });
  }
  return out;
}
// Apply installment payments FIFO across schedule; returns schedule with paid / status.
function allocate(schedule, paidTotal, asOf = today()) {
  let left = num(paidTotal);
  return schedule.map((s) => {
    const amount = num(s.amount);
    const paid = Math.min(amount, Math.max(0, left));
    left = num(left - paid);
    const remaining = num(amount - paid);
    const due = ymd(s.due_date);
    let status = 'upcoming';
    if (remaining <= 0) status = 'paid';
    else if (due < asOf) status = paid > 0 ? 'partial-overdue' : 'overdue';
    else if (due.slice(0, 7) === asOf.slice(0, 7)) status = paid > 0 ? 'partial' : 'due';
    else if (paid > 0) status = 'partial';
    return { ...s, due_date: due, amount, paid: num(paid), remaining, status };
  });
}
async function saleSnapshot(saleId) {
  const s = (await q(`SELECT s.*, c.name customer_name, c.phone customer_phone, c.father_name, c.address, c.cnic,
      c.guarantor_name, c.guarantor_phone, c.code customer_code, p.name package_name, u.name created_by_name
      FROM sales s JOIN customers c ON c.id=s.customer_id LEFT JOIN packages p ON p.id=s.package_id
      LEFT JOIN users u ON u.id=s.created_by WHERE s.id=$1`, [saleId])).rows[0];
  if (!s) return null;
  const items = (await q('SELECT * FROM sale_items WHERE sale_id=$1 ORDER BY id', [saleId])).rows;
  const sched = (await q('SELECT * FROM installments WHERE sale_id=$1 ORDER BY seq', [saleId])).rows;
  const pays = (await q(`SELECT p.*, u.name received_by_name FROM payments p LEFT JOIN users u ON u.id=p.received_by
      WHERE sale_id=$1 ORDER BY paid_on, id`, [saleId])).rows;
  const instPaid = pays.filter((p) => p.kind === 'installment' || p.kind === 'old-paid').reduce((a, p) => a + num(p.amount), 0);
  const totalPaid = pays.reduce((a, p) => a + num(p.amount), 0);
  const schedule = allocate(sched, instPaid);
  return { ...s, items, schedule, payments: pays, total_paid: num(totalPaid), balance: num(num(s.total) - totalPaid) };
}
// All active (balance > 0) sales with allocation — used for dashboard / recovery
async function allSalesAllocated() {
  const sales = (await q(`SELECT s.id, s.bill_no, s.customer_id, s.total, s.plan_type, s.sale_date, s.installment_amt,
      c.name customer_name, c.phone customer_phone, c.area, c.address, c.code customer_code
      FROM sales s JOIN customers c ON c.id=s.customer_id`)).rows;
  const inst = (await q('SELECT * FROM installments ORDER BY sale_id, seq')).rows;
  const pays = (await q(`SELECT sale_id, sum(amount) total, sum(CASE WHEN kind IN ('installment','old-paid') THEN amount ELSE 0 END) inst
      FROM payments GROUP BY sale_id`)).rows;
  const payMap = Object.fromEntries(pays.map((p) => [p.sale_id, p]));
  const instMap = {};
  for (const i of inst) (instMap[i.sale_id] ||= []).push(i);
  return sales.map((s) => {
    const pm = payMap[s.id] || { total: 0, inst: 0 };
    const schedule = allocate(instMap[s.id] || [], pm.inst);
    return { ...s, total: num(s.total), paid: num(pm.total), balance: num(num(s.total) - num(pm.total)), schedule };
  });
}

// Every stock change goes through here so the inventory khata always matches products.stock
async function addMove(db, { product_id, date, kind, qty, unit_cost = 0, ref_type = null, ref_id = null, ref_no = '', note = '', user = null }) {
  if (!product_id || !qty) return;
  await db.query(`INSERT INTO stock_moves(product_id,move_date,kind,qty,unit_cost,ref_type,ref_id,ref_no,note,created_by)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [product_id, date || today(), kind, qty, num(unit_cost), ref_type, ref_id, ref_no, note, user]);
  await db.query('UPDATE products SET stock=stock+$1 WHERE id=$2', [qty, product_id]);
}
async function undoMoves(db, ref_type, ref_id) {
  const mv = (await db.query('SELECT product_id, sum(qty) q FROM stock_moves WHERE ref_type=$1 AND ref_id=$2 GROUP BY 1', [ref_type, ref_id])).rows;
  for (const m of mv) await db.query('UPDATE products SET stock=stock-$1 WHERE id=$2', [m.q, m.product_id]);
  await db.query('DELETE FROM stock_moves WHERE ref_type=$1 AND ref_id=$2', [ref_type, ref_id]);
}

// ---------- auth ----------
const sign = (payload) => {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
};
const verify = (token) => {
  if (!token || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  const good = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  if (sig.length !== good.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good))) return null;
  const p = JSON.parse(Buffer.from(body, 'base64url').toString());
  return p.exp > Date.now() ? p : null;
};

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const wrap = (fn) => (req, res) => fn(req, res).catch((e) => { console.error(e); res.status(400).json({ error: e.message }); });
const auth = (req, res, next) => {
  const p = verify((req.headers.authorization || '').replace('Bearer ', ''));
  if (!p) return res.status(401).json({ error: 'Login required' });
  req.user = p; next();
};
const ownerOnly = (req, res, next) => (req.user.role === 'owner' ? next() : res.status(403).json({ error: 'Owner only' }));

app.get('/api/health', (req, res) => res.json({ ok: true }));
app.post('/api/login', wrap(async (req, res) => {
  const r = await q('SELECT id,name,role FROM users WHERE pin=$1 AND active', [String(req.body.pin || '')]);
  if (!r.rows[0]) return res.status(401).json({ error: 'Wrong PIN' });
  const u = r.rows[0];
  res.json({ token: sign({ id: u.id, name: u.name, role: u.role, exp: Date.now() + 30 * 864e5 }), user: u });
}));

app.use('/api', auth);

app.get('/api/settings', wrap(async (req, res) => res.json(await getSettings())));
app.put('/api/settings', ownerOnly, wrap(async (req, res) => {
  for (const [k, v] of Object.entries(req.body)) {
    await q('INSERT INTO settings(key,value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=$2', [k, String(v)]);
  }
  res.json(await getSettings());
}));

// users
app.get('/api/users', ownerOnly, wrap(async (req, res) => res.json((await q('SELECT id,name,pin,role,active FROM users ORDER BY id')).rows)));
app.post('/api/users', ownerOnly, wrap(async (req, res) => {
  const { id, name, pin, role, active } = req.body;
  if (!name || !/^\d{4,6}$/.test(String(pin))) throw new Error('Name and 4–6 digit PIN required');
  if (id) await q('UPDATE users SET name=$1,pin=$2,role=$3,active=$4 WHERE id=$5', [name, pin, role, active !== false, id]);
  else await q('INSERT INTO users(name,pin,role) VALUES ($1,$2,$3)', [name, pin, role || 'staff']);
  res.json({ ok: true });
}));

// products
app.get('/api/products', wrap(async (req, res) => res.json((await q('SELECT * FROM products WHERE active ORDER BY category,name')).rows)));
app.post('/api/products', ownerOnly, wrap(async (req, res) => {
  const { id, name, category, cost_price, cash_price, stock } = req.body;
  if (!name) throw new Error('Name required');
  if (id) {
    await q('UPDATE products SET name=$1,category=$2,cost_price=$3,cash_price=$4 WHERE id=$5', [name, category, num(cost_price), num(cash_price), id]);
    return res.json({ ok: true, id });
  }
  const pid = (await q('INSERT INTO products(name,category,cost_price,cash_price,stock) VALUES ($1,$2,$3,$4,0) RETURNING id', [name, category, num(cost_price), num(cash_price)])).rows[0].id;
  await addMove(pool, { product_id: pid, kind: 'opening', qty: parseInt(stock) || 0, unit_cost: cost_price, note: 'Opening stock', user: req.user.id });
  res.json({ ok: true, id: pid });
}));
app.delete('/api/products/:id', ownerOnly, wrap(async (req, res) => { await q('UPDATE products SET active=false WHERE id=$1', [req.params.id]); res.json({ ok: true }); }));

// packages (Jahez etc.)
app.get('/api/packages', wrap(async (req, res) => {
  const pk = (await q('SELECT * FROM packages WHERE active ORDER BY id')).rows;
  const it = (await q(`SELECT pi.*, p.name, p.cash_price, p.category FROM package_items pi JOIN products p ON p.id=pi.product_id`)).rows;
  res.json(pk.map((p) => {
    const items = it.filter((i) => i.package_id === p.id);
    return { ...p, items, total: num(items.reduce((a, i) => a + num(i.cash_price) * i.qty, 0)) };
  }));
}));
app.post('/api/packages', ownerOnly, wrap(async (req, res) => {
  const { id, name, description, items } = req.body;
  if (!name) throw new Error('Package name required');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let pid = id;
    if (id) await client.query('UPDATE packages SET name=$1,description=$2 WHERE id=$3', [name, description || '', id]);
    else pid = (await client.query('INSERT INTO packages(name,description) VALUES ($1,$2) RETURNING id', [name, description || ''])).rows[0].id;
    await client.query('DELETE FROM package_items WHERE package_id=$1', [pid]);
    for (const i of items || []) await client.query('INSERT INTO package_items(package_id,product_id,qty) VALUES ($1,$2,$3)', [pid, i.product_id, parseInt(i.qty) || 1]);
    await client.query('COMMIT');
    res.json({ ok: true, id: pid });
  } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
}));
app.delete('/api/packages/:id', ownerOnly, wrap(async (req, res) => { await q('UPDATE packages SET active=false WHERE id=$1', [req.params.id]); res.json({ ok: true }); }));

// customers
app.get('/api/customers', wrap(async (req, res) => {
  const cs = (await q('SELECT * FROM customers ORDER BY name')).rows;
  const all = await allSalesAllocated();
  const asOf = today();
  res.json(cs.map((c) => {
    const mine = all.filter((s) => s.customer_id === c.id);
    const overdue = mine.reduce((a, s) => a + s.schedule.filter((x) => x.due_date < asOf).reduce((b, x) => b + x.remaining, 0), 0);
    return { ...c, bills: mine.length, total: num(mine.reduce((a, s) => a + s.total, 0)), paid: num(mine.reduce((a, s) => a + s.paid, 0)),
      balance: num(mine.reduce((a, s) => a + s.balance, 0)), overdue: num(overdue) };
  }));
}));
app.post('/api/customers', wrap(async (req, res) => {
  const f = ['name', 'father_name', 'phone', 'cnic', 'address', 'area', 'guarantor_name', 'guarantor_phone', 'guarantor_cnic', 'notes', 'plan_type'];
  req.body.plan_type = req.body.plan_type === 'yearly' ? 'yearly' : 'monthly';
  const b = req.body;
  if (!b.name) throw new Error('Customer name required');
  const vals = f.map((k) => b[k] || '');
  const code = String(b.code || '').trim().toUpperCase();
  if (code) {
    const dup = (await q('SELECT id, name FROM customers WHERE upper(code)=$1 AND id<>$2', [code, b.id || 0])).rows[0];
    if (dup) throw new Error(`Code ${code} is already used by ${dup.name}`);
  }
  if (b.id) {
    await q(`UPDATE customers SET ${f.map((k, i) => `${k}=$${i + 1}`).join(',')} WHERE id=$${f.length + 1}`, [...vals, b.id]);
    if (code) await q('UPDATE customers SET code=$1 WHERE id=$2', [code, b.id]);
    return res.json({ ok: true, id: b.id });
  }
  const r = await q(`INSERT INTO customers(${f.join(',')}) VALUES (${f.map((_, i) => `$${i + 1}`).join(',')}) RETURNING id`, vals);
  const id = r.rows[0].id;
  const finalCode = code || await nextCode();
  await q('UPDATE customers SET code=$1 WHERE id=$2', [finalCode, id]);
  res.json({ ok: true, id, code: finalCode });
}));
// next sequential code for a prefix, e.g. GM-1007
async function nextCode() {
  const st = await getSettings();
  const prefix = (st.code_prefix || 'GM').toUpperCase().trim();
  const r = await q(`SELECT COALESCE(max(substring(code from '\\d+$')::int), 1000) m FROM customers WHERE upper(code) LIKE $1 AND code ~ '\\d+$'`, [prefix + '-%']);
  return `${prefix}-${Math.max(1000, r.rows[0].m) + 1}`;
}
app.get('/api/customers/next-code', wrap(async (req, res) => res.json({ code: await nextCode() })));

// quick lookup by customer code — installments paid / left, in count and rupees
app.get('/api/lookup/:code', wrap(async (req, res) => {
  const code = String(req.params.code || '').trim().toUpperCase();
  let c = (await q('SELECT * FROM customers WHERE upper(code)=$1', [code])).rows[0];
  if (!c && /^\d+$/.test(code)) c = (await q("SELECT * FROM customers WHERE upper(code) LIKE $1 ORDER BY id LIMIT 1", ['%-' + code])).rows[0];
  if (!c) throw new Error(`No customer with code ${code}`);
  const ids = (await q('SELECT id FROM sales WHERE customer_id=$1 ORDER BY sale_date, id', [c.id])).rows;
  const asOf = today();
  const bills = [];
  for (const r of ids) {
    const s = await saleSnapshot(r.id);
    const paidInst = s.schedule.filter((x) => x.status === 'paid');
    const left = s.schedule.filter((x) => x.remaining > 0);
    const next = left[0];
    bills.push({ id: s.id, bill_no: s.bill_no, sale_date: ymd(s.sale_date), plan_type: s.plan_type, package_name: s.package_name,
      items: s.items.map((i) => i.name + (i.qty > 1 ? ' ×' + i.qty : '')).join(', '),
      total: num(s.total), advance: num(s.advance), paid: s.total_paid, balance: s.balance,
      inst_total: s.schedule.length, inst_paid: paidInst.length, inst_left: left.length,
      inst_paid_amt: num(s.schedule.reduce((a, x) => a + x.paid, 0)), inst_left_amt: num(left.reduce((a, x) => a + x.remaining, 0)),
      installment_amt: num(s.installment_amt), next_due: next ? next.due_date : null, next_amt: next ? next.remaining : 0,
      overdue_amt: num(s.schedule.filter((x) => x.due_date < asOf).reduce((a, x) => a + x.remaining, 0)),
      overdue_count: s.schedule.filter((x) => x.due_date < asOf && x.remaining > 0).length,
      last_payment: s.payments.length ? { date: ymd(s.payments[s.payments.length - 1].paid_on), amount: num(s.payments[s.payments.length - 1].amount) } : null });
  }
  const sum = (k) => num(bills.reduce((a, b) => a + b[k], 0));
  res.json({ customer: c, bills, total: sum('total'), paid: sum('paid'), balance: sum('balance'), overdue: sum('overdue_amt'),
    inst_total: bills.reduce((a, b) => a + b.inst_total, 0), inst_paid: bills.reduce((a, b) => a + b.inst_paid, 0), inst_left: bills.reduce((a, b) => a + b.inst_left, 0) });
}));
app.get('/api/customers/:id', wrap(async (req, res) => {
  const c = (await q('SELECT * FROM customers WHERE id=$1', [req.params.id])).rows[0];
  if (!c) throw new Error('Not found');
  const ids = (await q('SELECT id FROM sales WHERE customer_id=$1 ORDER BY sale_date,id', [c.id])).rows;
  const sales = [];
  for (const r of ids) sales.push(await saleSnapshot(r.id));
  // Khata (ledger): debit = bill total, credit = payments
  const entries = [];
  for (const s of sales) {
    entries.push({ date: ymd(s.sale_date), type: 'bill', ref: s.bill_no, desc: `Bill — ${s.package_name || s.items[0].name}${s.items.length > 1 ? ` (${s.items.length} items)` : ''}`, debit: num(s.total), credit: 0, sort: 0 });
    for (const p of s.payments) entries.push({ date: ymd(p.paid_on), type: p.kind, ref: `${s.bill_no} · ${p.receipt_no}`, desc: `${{ advance: 'Advance', installment: 'Qist', 'old-advance': 'Advance (old record)', 'old-paid': 'Paid before app (old record)' }[p.kind] || p.kind}${p.kind.startsWith('old') ? '' : ` (${p.method})`}${p.note ? ' · ' + p.note : ''}`, debit: 0, credit: num(p.amount), sort: 1, payment_id: p.id });
  }
  entries.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.sort - b.sort));
  let bal = 0;
  for (const e of entries) { bal = num(bal + e.debit - e.credit); e.balance = bal; }
  res.json({ customer: c, sales, ledger: entries, balance: bal });
}));
app.delete('/api/customers/:id', ownerOnly, wrap(async (req, res) => {
  const n = (await q('SELECT count(*)::int c FROM sales WHERE customer_id=$1', [req.params.id])).rows[0].c;
  if (n) throw new Error('Customer has bills — delete the bills first');
  await q('DELETE FROM customers WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
}));

// sales / bills
app.post('/api/sales/preview', wrap(async (req, res) => res.json(await computeSale(req.body))));
async function computeSale(b) {
  const st = await getSettings();
  const items = (b.items || []).filter((i) => i.name && num(i.price) >= 0 && (parseInt(i.qty) || 0) > 0)
    .map((i) => ({ product_id: i.product_id || null, name: i.name, qty: parseInt(i.qty), price: num(i.price) }));
  if (!items.length) throw new Error('Add at least one item');
  const items_total = num(items.reduce((a, i) => a + i.qty * i.price, 0));
  const markup_pct = num(b.markup_pct);
  const markup_amt = Math.round(items_total * markup_pct / 100);
  const discount = num(b.discount);
  const total = num(items_total + markup_amt - discount);
  const advance = num(b.advance);
  if (advance > total) throw new Error('Advance is more than bill total');
  const plan_type = b.plan_type === 'yearly' ? 'yearly' : 'monthly';
  const count = parseInt(b.installments_count) || 1;
  const sale_date = b.sale_date || today();
  const first_due_date = b.first_due_date || (plan_type === 'monthly' ? addMonths(sale_date, 1)
    : nextYearlyDate(sale_date, parseInt(st.yearly_month) || 8, parseInt(st.yearly_day) || 10));
  const schedule = buildSchedule(total - advance, count, plan_type, first_due_date);
  return { items, items_total, markup_pct, markup_amt, discount, total, advance, plan_type, installments_count: count,
    installment_amt: schedule[0] ? schedule[0].amount : 0, sale_date, first_due_date, schedule };
}
app.post('/api/sales', wrap(async (req, res) => {
  const b = req.body;
  if (!b.customer_id) throw new Error('Select a customer');
  const c = await computeSale(b);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const s = (await client.query(`INSERT INTO sales(customer_id,sale_date,package_id,items_total,markup_pct,markup_amt,discount,total,advance,
        plan_type,installments_count,installment_amt,first_due_date,notes,created_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id`,
    [b.customer_id, c.sale_date, b.package_id || null, c.items_total, c.markup_pct, c.markup_amt, c.discount, c.total, c.advance,
      c.plan_type, c.installments_count, c.installment_amt, c.first_due_date, b.notes || '', req.user.id])).rows[0];
    const bill_no = 'B-' + String(s.id).padStart(5, '0');
    await client.query('UPDATE sales SET bill_no=$1 WHERE id=$2', [bill_no, s.id]);
    for (const i of c.items) {
      await client.query('INSERT INTO sale_items(sale_id,product_id,name,qty,price) VALUES ($1,$2,$3,$4,$5)', [s.id, i.product_id, i.name, i.qty, i.price]);
      if (i.product_id) await addMove(client, { product_id: i.product_id, date: c.sale_date, kind: 'sale', qty: -i.qty, ref_type: 'sale', ref_id: s.id, ref_no: bill_no, note: 'Sold on qist', user: req.user.id });
    }
    for (const x of c.schedule) await client.query('INSERT INTO installments(sale_id,seq,due_date,amount) VALUES ($1,$2,$3,$4)', [s.id, x.seq, x.due_date, x.amount]);
    if (c.advance > 0) {
      const p = (await client.query(`INSERT INTO payments(sale_id,customer_id,amount,kind,paid_on,method,received_by)
        VALUES ($1,$2,$3,'advance',$4,$5,$6) RETURNING id`, [s.id, b.customer_id, c.advance, c.sale_date, b.advance_method || 'Cash', req.user.id])).rows[0];
      await client.query('UPDATE payments SET receipt_no=$1 WHERE id=$2', ['R-' + String(p.id).padStart(5, '0'), p.id]);
    }
    await client.query('COMMIT');
    res.json({ ok: true, id: s.id, bill_no });
  } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
}));
app.get('/api/sales', wrap(async (req, res) => {
  const all = await allSalesAllocated();
  all.sort((a, b) => b.id - a.id);
  res.json(all.map(({ schedule, ...s }) => ({ ...s, next_due: (schedule.find((x) => x.remaining > 0) || {}).due_date || null,
    overdue: num(schedule.filter((x) => x.due_date < today()).reduce((a, x) => a + x.remaining, 0)) })));
}));
app.get('/api/sales/:id', wrap(async (req, res) => {
  const s = await saleSnapshot(req.params.id);
  if (!s) throw new Error('Bill not found');
  res.json(s);
}));
app.delete('/api/sales/:id', ownerOnly, wrap(async (req, res) => {
  await undoMoves(pool, 'sale', +req.params.id);
  await q('DELETE FROM sales WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
}));

// ---------- old / ongoing customers (opening bills) ----------
// Records a bill that started before the app: no stock movement, no cash entry today.
function parseDate(v) {
  if (!v) return null;
  if (v instanceof Date) return ymd(v);
  const t = String(v).trim();
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = t.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/); // dd/mm/yyyy (Pakistan format)
  if (m) { const y = m[3].length === 2 ? '20' + m[3] : m[3]; return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; }
  const d = new Date(t);
  return isNaN(d) ? null : ymd(d);
}
async function computeOpening(b) {
  const st = await getSettings();
  const plan_type = /^y|year|aug|sal/i.test(String(b.plan_type || '')) ? 'yearly' : 'monthly';
  const total = num(b.total), advance = num(b.advance);
  const count = parseInt(b.installments_count) || 0;
  if (!(total > 0)) throw new Error('Total installment price is required');
  if (advance > total) throw new Error('Advance is more than total');
  if (count < 1) throw new Error('Total number of installments is required');
  const financed = num(total - advance);
  const base = Math.round(financed / count);
  const paidCount = Math.min(count, Math.max(0, parseInt(b.paid_count) || 0));
  let paidAmt = b.paid_amount === '' || b.paid_amount == null ? null : num(b.paid_amount);
  if (paidAmt == null) paidAmt = paidCount >= count ? financed : num(base * paidCount);
  if (paidAmt > financed + 0.01) throw new Error(`Paid so far (Rs ${paidAmt}) is more than the installment amount (Rs ${financed})`);
  const fullPaid = base > 0 ? Math.min(count, Math.floor((paidAmt + 0.5) / base)) : 0;
  const step = plan_type === 'monthly' ? 1 : 12;
  let next = parseDate(b.next_due);
  if (!next) next = plan_type === 'monthly' ? addMonths(today().slice(0, 8) + '10', 1) : nextYearlyDate(today(), parseInt(st.yearly_month) || 8, parseInt(st.yearly_day) || 10);
  const first_due_date = addMonths(next, -step * Math.min(fullPaid, count));
  const sale_date = parseDate(b.sale_date) || addMonths(first_due_date, -step);
  const schedule = allocate(buildSchedule(financed, count, plan_type, first_due_date), paidAmt);
  return { plan_type, total, advance, financed, installments_count: count, installment_amt: schedule[0] ? schedule[0].amount : 0,
    paid_amount: paidAmt, paid_installments: schedule.filter((x) => x.status === 'paid').length, left_installments: schedule.filter((x) => x.remaining > 0).length,
    balance: num(financed - paidAmt), first_due_date, next_due: (schedule.find((x) => x.remaining > 0) || {}).due_date || null, sale_date, schedule,
    goods: String(b.goods || '').trim() };
}
async function saveOpening(client, b, userId) {
  const c = await computeOpening(b);
  if (!c.goods) throw new Error('Goods bought is required');
  let code = String(b.code || '').trim().toUpperCase();
  let cust = null;
  if (b.customer_id) cust = (await client.query('SELECT * FROM customers WHERE id=$1', [b.customer_id])).rows[0];
  if (!cust && code) cust = (await client.query('SELECT * FROM customers WHERE upper(code)=$1', [code])).rows[0];
  let created = false;
  if (!cust) {
    if (!String(b.name || '').trim()) throw new Error('Customer name is required');
    if (!code) code = await nextCode();
    cust = (await client.query(`INSERT INTO customers(name,code,father_name,phone,cnic,area,address,guarantor_name,guarantor_phone,notes,plan_type)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`, [String(b.name).trim(), code, b.father_name || '', String(b.phone || '').trim(), b.cnic || '', b.area || '', b.address || '',
      b.guarantor_name || '', String(b.guarantor_phone || '').trim(), 'Added as old customer', c.plan_type])).rows[0];
    created = true;
  }
  const s = (await client.query(`INSERT INTO sales(customer_id,sale_date,items_total,markup_pct,markup_amt,discount,total,advance,plan_type,installments_count,
      installment_amt,first_due_date,notes,created_by,is_opening,old_ref) VALUES ($1,$2,$3,0,0,0,$3,$4,$5,$6,$7,$8,$9,$10,TRUE,$11) RETURNING id`,
    [cust.id, c.sale_date, c.total, c.advance, c.plan_type, c.installments_count, c.installment_amt, c.first_due_date, b.notes || '', userId, String(b.old_ref || '').trim()])).rows[0];
  const bill_no = 'B-' + String(s.id).padStart(5, '0');
  await client.query('UPDATE sales SET bill_no=$1 WHERE id=$2', [bill_no, s.id]);
  await client.query('INSERT INTO sale_items(sale_id,product_id,name,qty,price) VALUES ($1,NULL,$2,1,$3)', [s.id, c.goods, c.total]);
  for (const x of c.schedule) await client.query('INSERT INTO installments(sale_id,seq,due_date,amount) VALUES ($1,$2,$3,$4)', [s.id, x.seq, x.due_date, x.amount]);
  const addPay = async (amt, kind, date, note) => {
    if (!(amt > 0)) return;
    const p = (await client.query(`INSERT INTO payments(sale_id,customer_id,amount,kind,paid_on,method,note,received_by) VALUES ($1,$2,$3,$4,$5,'Old record',$6,$7) RETURNING id`,
      [s.id, cust.id, amt, kind, date, note, userId])).rows[0];
    await client.query('UPDATE payments SET receipt_no=$1 WHERE id=$2', ['R-' + String(p.id).padStart(5, '0'), p.id]);
  };
  await addPay(c.advance, 'old-advance', c.sale_date, '');
  const lastPaid = c.schedule.filter((x) => x.paid > 0).pop();
  await addPay(c.paid_amount, 'old-paid', lastPaid ? (lastPaid.due_date < today() ? lastPaid.due_date : today()) : today(), `${c.paid_installments} qist paid before app`);
  return { sale_id: s.id, bill_no, customer_id: cust.id, code: cust.code, name: cust.name, created, ...c, schedule: undefined };
}
app.post('/api/opening/preview', wrap(async (req, res) => res.json(await computeOpening(req.body))));
app.post('/api/opening', wrap(async (req, res) => {
  const client = await pool.connect();
  try { await client.query('BEGIN'); const r = await saveOpening(client, req.body, req.user.id); await client.query('COMMIT'); res.json({ ok: true, ...r }); }
  catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
}));
// payments (qist collection)
app.post('/api/payments', wrap(async (req, res) => {
  const { sale_id, amount, paid_on, method, note } = req.body;
  const s = await saleSnapshot(sale_id);
  if (!s) throw new Error('Bill not found');
  const amt = num(amount);
  if (amt <= 0) throw new Error('Enter amount');
  if (amt > s.balance + 0.01) throw new Error(`Amount is more than remaining balance (Rs ${s.balance})`);
  const p = (await q(`INSERT INTO payments(sale_id,customer_id,amount,kind,paid_on,method,note,received_by)
    VALUES ($1,$2,$3,'installment',$4,$5,$6,$7) RETURNING id`, [sale_id, s.customer_id, amt, paid_on || today(), method || 'Cash', note || '', req.user.id])).rows[0];
  const receipt_no = 'R-' + String(p.id).padStart(5, '0');
  await q('UPDATE payments SET receipt_no=$1 WHERE id=$2', [receipt_no, p.id]);
  res.json({ ok: true, id: p.id, receipt_no, balance: num(s.balance - amt) });
}));
app.delete('/api/payments/:id', ownerOnly, wrap(async (req, res) => { await q('DELETE FROM payments WHERE id=$1', [req.params.id]); res.json({ ok: true }); }));
app.get('/api/payments', wrap(async (req, res) => {
  const from = req.query.from || today(), to = req.query.to || today();
  res.json((await q(`SELECT p.*, c.name customer_name, s.bill_no, u.name received_by_name FROM payments p
    JOIN customers c ON c.id=p.customer_id JOIN sales s ON s.id=p.sale_id LEFT JOIN users u ON u.id=p.received_by
    WHERE paid_on BETWEEN $1 AND $2 AND p.kind IN ('advance','installment') ORDER BY paid_on DESC, p.id DESC`, [from, to])).rows);
}));

// recovery list
app.get('/api/recovery', wrap(async (req, res) => {
  const mode = req.query.mode || 'due'; // due = overdue + this month, overdue, month, yearly, all
  const asOf = today();
  const monthEnd = ymd(new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0));
  const all = await allSalesAllocated();
  const rows = [];
  for (const s of all) {
    if (s.balance <= 0) continue;
    if (mode === 'yearly' && s.plan_type !== 'yearly') continue;
    if (mode === 'monthly' && s.plan_type !== 'monthly') continue;
    const pending = s.schedule.filter((x) => x.remaining > 0);
    let pick;
    if (mode === 'overdue') pick = pending.filter((x) => x.due_date < asOf);
    else if (mode === 'yearly') pick = pending.slice(0, 1);
    else if (mode === 'all') pick = pending.slice(0, 1);
    else pick = pending.filter((x) => x.due_date <= monthEnd);
    if (!pick.length) continue;
    const dueNow = num(pick.reduce((a, x) => a + x.remaining, 0));
    rows.push({ sale_id: s.id, bill_no: s.bill_no, customer_id: s.customer_id, customer_code: s.customer_code, customer_name: s.customer_name, customer_phone: s.customer_phone,
      area: s.area, plan_type: s.plan_type, oldest_due: pick[0].due_date, count: pick.length, due_now: dueNow, balance: s.balance,
      overdue: pick.some((x) => x.due_date < asOf) });
  }
  rows.sort((a, b) => (a.oldest_due < b.oldest_due ? -1 : 1));
  res.json(rows);
}));

// expenses / business khata
app.get('/api/expenses', wrap(async (req, res) => {
  const from = req.query.from || '2000-01-01', to = req.query.to || '2999-12-31';
  res.json((await q('SELECT e.*, u.name created_by_name FROM expenses e LEFT JOIN users u ON u.id=e.created_by WHERE exp_date BETWEEN $1 AND $2 ORDER BY exp_date DESC,id DESC', [from, to])).rows);
}));
app.post('/api/expenses', ownerOnly, wrap(async (req, res) => {
  const { exp_date, category, amount, direction, note } = req.body;
  if (!category || num(amount) <= 0) throw new Error('Category and amount required');
  await q('INSERT INTO expenses(exp_date,category,amount,direction,note,created_by) VALUES ($1,$2,$3,$4,$5,$6)', [exp_date || today(), category, num(amount), direction === 'in' ? 'in' : 'out', note || '', req.user.id]);
  res.json({ ok: true });
}));
app.delete('/api/expenses/:id', ownerOnly, wrap(async (req, res) => { await q('DELETE FROM expenses WHERE id=$1', [req.params.id]); res.json({ ok: true }); }));

// ---------- inventory khata ----------
app.get('/api/inventory', ownerOnly, wrap(async (req, res) => {
  const month = today().slice(0, 7);
  const rows = (await q(`SELECT p.*,
      COALESCE((SELECT -sum(qty) FROM stock_moves m WHERE m.product_id=p.id AND m.kind='sale' AND to_char(move_date,'YYYY-MM')=$1),0) sold_month,
      COALESCE((SELECT sum(qty) FROM stock_moves m WHERE m.product_id=p.id AND m.kind='purchase' AND to_char(move_date,'YYYY-MM')=$1),0) in_month,
      (SELECT max(move_date) FROM stock_moves m WHERE m.product_id=p.id AND m.kind='purchase') last_purchase
    FROM products p WHERE active ORDER BY category, name`, [month])).rows;
  const items = rows.map((r) => ({ ...r, cost_price: num(r.cost_price), cash_price: num(r.cash_price), sold_month: +r.sold_month, in_month: +r.in_month,
    value_cost: num(r.stock * num(r.cost_price)), value_cash: num(r.stock * num(r.cash_price)) }));
  res.json({ items, units: items.reduce((a, i) => a + Math.max(0, i.stock), 0),
    value_cost: num(items.reduce((a, i) => a + Math.max(0, i.value_cost), 0)), value_cash: num(items.reduce((a, i) => a + Math.max(0, i.value_cash), 0)),
    low: items.filter((i) => i.stock <= 2).length });
}));
app.get('/api/products/:id/moves', ownerOnly, wrap(async (req, res) => {
  const p = (await q('SELECT * FROM products WHERE id=$1', [req.params.id])).rows[0];
  if (!p) throw new Error('Product not found');
  const mv = (await q(`SELECT m.*, s.name supplier_name, c.name customer_name, u.name by_name FROM stock_moves m
    LEFT JOIN purchases pu ON m.ref_type='purchase' AND pu.id=m.ref_id LEFT JOIN suppliers s ON s.id=pu.supplier_id
    LEFT JOIN sales sa ON m.ref_type='sale' AND sa.id=m.ref_id LEFT JOIN customers c ON c.id=sa.customer_id
    LEFT JOIN users u ON u.id=m.created_by WHERE m.product_id=$1 ORDER BY move_date, m.id`, [p.id])).rows;
  let bal = 0;
  const moves = mv.map((m) => { bal += m.qty; return { ...m, unit_cost: num(m.unit_cost), balance: bal }; });
  res.json({ product: p, moves, total_in: moves.filter((m) => m.qty > 0).reduce((a, m) => a + m.qty, 0), total_out: -moves.filter((m) => m.qty < 0).reduce((a, m) => a + m.qty, 0) });
}));
app.post('/api/stock-adjust', ownerOnly, wrap(async (req, res) => {
  const { product_id, qty, note, date } = req.body;
  const n2 = parseInt(qty);
  if (!product_id || !n2) throw new Error('Enter quantity (+ to add, − to remove)');
  const p = (await q('SELECT cost_price FROM products WHERE id=$1', [product_id])).rows[0];
  await addMove(pool, { product_id, date, kind: n2 > 0 ? 'adjust-in' : 'adjust-out', qty: n2, unit_cost: p.cost_price, note: note || '', user: req.user.id });
  res.json({ ok: true });
}));

// ---------- suppliers & purchases ----------
async function supplierBalances() {
  return (await q(`SELECT s.*,
      COALESCE((SELECT sum(total) FROM purchases p WHERE p.supplier_id=s.id),0) purchased,
      COALESCE((SELECT sum(amount) FROM supplier_payments sp WHERE sp.supplier_id=s.id),0) paid
    FROM suppliers s ORDER BY name`)).rows.map((s) => ({ ...s, opening_balance: num(s.opening_balance), purchased: num(s.purchased), paid: num(s.paid),
    balance: num(num(s.opening_balance) + num(s.purchased) - num(s.paid)) }));
}
app.get('/api/suppliers', ownerOnly, wrap(async (req, res) => res.json(await supplierBalances())));
app.post('/api/suppliers', ownerOnly, wrap(async (req, res) => {
  const { id, name, phone, address, opening_balance, notes } = req.body;
  if (!name) throw new Error('Supplier name required');
  if (id) { await q('UPDATE suppliers SET name=$1,phone=$2,address=$3,opening_balance=$4,notes=$5 WHERE id=$6', [name, phone || '', address || '', num(opening_balance), notes || '', id]); return res.json({ ok: true, id }); }
  const r = await q('INSERT INTO suppliers(name,phone,address,opening_balance,notes) VALUES ($1,$2,$3,$4,$5) RETURNING id', [name, phone || '', address || '', num(opening_balance), notes || '']);
  res.json({ ok: true, id: r.rows[0].id });
}));
app.get('/api/suppliers/:id', ownerOnly, wrap(async (req, res) => {
  const s = (await supplierBalances()).find((x) => x.id === +req.params.id);
  if (!s) throw new Error('Supplier not found');
  const purchases = (await q('SELECT * FROM purchases WHERE supplier_id=$1 ORDER BY purchase_date, id', [s.id])).rows;
  const items = (await q(`SELECT pi.*, p.name FROM purchase_items pi JOIN products p ON p.id=pi.product_id
    WHERE purchase_id IN (SELECT id FROM purchases WHERE supplier_id=$1)`, [s.id])).rows;
  const pays = (await q('SELECT * FROM supplier_payments WHERE supplier_id=$1 ORDER BY paid_on, id', [s.id])).rows;
  const entries = [];
  if (s.opening_balance) entries.push({ date: ymd(s.created_at), desc: 'Opening balance (purana udhaar)', plus: s.opening_balance, minus: 0, sort: -1 });
  for (const p of purchases) {
    const its = items.filter((i) => i.purchase_id === p.id);
    entries.push({ date: ymd(p.purchase_date), desc: `Purchase ${p.purchase_no}${p.invoice_ref ? ' (inv ' + p.invoice_ref + ')' : ''} — ${its.map((i) => i.name + ' ×' + i.qty).join(', ')}`, plus: num(p.total), minus: 0, sort: 0, purchase_id: p.id });
  }
  for (const p of pays) entries.push({ date: ymd(p.paid_on), desc: `Paid (${p.method})${p.note ? ' · ' + p.note : ''}`, plus: 0, minus: num(p.amount), sort: 1, payment_id: p.id });
  entries.sort((a, b) => (a.sort === -1 ? -1 : b.sort === -1 ? 1 : a.date < b.date ? -1 : a.date > b.date ? 1 : a.sort - b.sort));
  if (entries[0] && entries[0].sort === -1 && entries[1]) entries[0].date = entries[1].date < entries[0].date ? entries[1].date : entries[0].date;
  let bal = 0;
  for (const e of entries) { bal = num(bal + e.plus - e.minus); e.balance = bal; }
  res.json({ supplier: s, ledger: entries, purchases: purchases.map((p) => ({ ...p, items: items.filter((i) => i.purchase_id === p.id) })) });
}));
app.post('/api/purchases', ownerOnly, wrap(async (req, res) => {
  const { supplier_id, purchase_date, items, paid, method, invoice_ref, note, update_cost } = req.body;
  if (!supplier_id) throw new Error('Select a supplier');
  const lines = (items || []).filter((i) => i.product_id && parseInt(i.qty) > 0).map((i) => ({ product_id: +i.product_id, qty: parseInt(i.qty), cost: num(i.cost) }));
  if (!lines.length) throw new Error('Add at least one product');
  const total = num(lines.reduce((a, i) => a + i.qty * i.cost, 0));
  const date = purchase_date || today();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const pid = (await client.query('INSERT INTO purchases(supplier_id,purchase_date,total,invoice_ref,note,created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
      [supplier_id, date, total, invoice_ref || '', note || '', req.user.id])).rows[0].id;
    const no = 'P-' + String(pid).padStart(5, '0');
    await client.query('UPDATE purchases SET purchase_no=$1 WHERE id=$2', [no, pid]);
    for (const l of lines) {
      await client.query('INSERT INTO purchase_items(purchase_id,product_id,qty,cost) VALUES ($1,$2,$3,$4)', [pid, l.product_id, l.qty, l.cost]);
      await addMove(client, { product_id: l.product_id, date, kind: 'purchase', qty: l.qty, unit_cost: l.cost, ref_type: 'purchase', ref_id: pid, ref_no: no, note: 'Stock in', user: req.user.id });
      if (update_cost !== false) await client.query('UPDATE products SET cost_price=$1 WHERE id=$2', [l.cost, l.product_id]);
    }
    if (num(paid) > 0) await client.query('INSERT INTO supplier_payments(supplier_id,purchase_id,amount,paid_on,method,note,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [supplier_id, pid, num(paid), date, method || 'Cash', 'Paid with ' + no, req.user.id]);
    await client.query('COMMIT');
    res.json({ ok: true, id: pid, purchase_no: no, total });
  } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
}));
app.delete('/api/purchases/:id', ownerOnly, wrap(async (req, res) => {
  await undoMoves(pool, 'purchase', +req.params.id);
  await q('DELETE FROM purchases WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
}));
app.post('/api/supplier-payments', ownerOnly, wrap(async (req, res) => {
  const { supplier_id, amount, paid_on, method, note } = req.body;
  if (!supplier_id || num(amount) <= 0) throw new Error('Enter amount');
  await q('INSERT INTO supplier_payments(supplier_id,amount,paid_on,method,note,created_by) VALUES ($1,$2,$3,$4,$5,$6)', [supplier_id, num(amount), paid_on || today(), method || 'Cash', note || '', req.user.id]);
  res.json({ ok: true });
}));
app.delete('/api/supplier-payments/:id', ownerOnly, wrap(async (req, res) => { await q('DELETE FROM supplier_payments WHERE id=$1', [req.params.id]); res.json({ ok: true }); }));

// cashbook = all money in/out by day
app.get('/api/cashbook', ownerOnly, wrap(async (req, res) => {
  const from = req.query.from || today().slice(0, 8) + '01', to = req.query.to || today();
  const opening = (await q(`SELECT
      COALESCE((SELECT sum(amount) FROM payments WHERE paid_on < $1 AND kind IN ('advance','installment')),0)
    + COALESCE((SELECT sum(amount) FROM expenses WHERE direction='in' AND exp_date < $1),0)
    - COALESCE((SELECT sum(amount) FROM expenses WHERE direction='out' AND exp_date < $1),0)
    - COALESCE((SELECT sum(amount) FROM supplier_payments WHERE paid_on < $1),0) AS bal`, [from])).rows[0].bal;
  const sps = (await q(`SELECT sp.paid_on d, sp.amount, sp.method, sp.note, s.name FROM supplier_payments sp JOIN suppliers s ON s.id=sp.supplier_id
    WHERE paid_on BETWEEN $1 AND $2`, [from, to])).rows;
  const pays = (await q(`SELECT p.paid_on d, p.amount, p.kind, p.receipt_no, p.method, c.name, s.bill_no FROM payments p
    JOIN customers c ON c.id=p.customer_id JOIN sales s ON s.id=p.sale_id WHERE paid_on BETWEEN $1 AND $2 AND p.kind IN ('advance','installment')`, [from, to])).rows;
  const exps = (await q('SELECT exp_date d, amount, direction, category, note FROM expenses WHERE exp_date BETWEEN $1 AND $2', [from, to])).rows;
  const entries = [
    ...pays.map((p) => ({ date: ymd(p.d), desc: `${p.kind === 'advance' ? 'Advance' : 'Qist'} — ${p.name} (${p.bill_no}, ${p.receipt_no}, ${p.method})`, in: num(p.amount), out: 0 })),
    ...exps.map((e) => ({ date: ymd(e.d), desc: `${e.category}${e.note ? ' — ' + e.note : ''}`, in: e.direction === 'in' ? num(e.amount) : 0, out: e.direction === 'out' ? num(e.amount) : 0 })),
    ...sps.map((e) => ({ date: ymd(e.d), desc: `Paid supplier — ${e.name} (${e.method})${e.note ? ' · ' + e.note : ''}`, in: 0, out: num(e.amount) })),
  ].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  let bal = num(opening);
  for (const e of entries) { bal = num(bal + e.in - e.out); e.balance = bal; }
  res.json({ from, to, opening: num(opening), entries, closing: bal,
    total_in: num(entries.reduce((a, e) => a + e.in, 0)), total_out: num(entries.reduce((a, e) => a + e.out, 0)) });
}));

// dashboard
app.get('/api/dashboard', wrap(async (req, res) => {
  const asOf = today();
  const month = asOf.slice(0, 7);
  const all = await allSalesAllocated();
  const st = await getSettings();
  let receivable = 0, overdue = 0, overdueCount = 0, dueMonth = 0, dueMonthCount = 0, yearlyNext = 0, yearlyCount = 0, active = 0;
  const yMonth = String(parseInt(st.yearly_month) || 8).padStart(2, '0');
  for (const s of all) {
    if (s.balance > 0) active++;
    receivable += s.balance;
    let od = false;
    for (const x of s.schedule) {
      if (x.remaining <= 0) continue;
      if (x.due_date < asOf) { overdue += x.remaining; od = true; }
      if (x.due_date.slice(0, 7) === month) { dueMonth += x.remaining; dueMonthCount++; }
    }
    if (od) overdueCount++;
    if (s.plan_type === 'yearly') {
      const nxt = s.schedule.find((x) => x.remaining > 0 && x.due_date.slice(5, 7) === yMonth && x.due_date >= asOf.slice(0, 4) + '-01-01');
      if (nxt && nxt.due_date.slice(0, 4) === (asOf.slice(5, 7) > yMonth ? String(+asOf.slice(0, 4) + 1) : asOf.slice(0, 4))) { yearlyNext += nxt.remaining; yearlyCount++; }
    }
  }
  const r = (await q(`SELECT
      COALESCE((SELECT sum(amount) FROM payments WHERE paid_on=$1 AND kind IN ('advance','installment')),0) today_in,
      COALESCE((SELECT sum(amount) FROM payments WHERE to_char(paid_on,'YYYY-MM')=$2 AND kind IN ('advance','installment')),0) month_in,
      COALESCE((SELECT sum(total) FROM sales WHERE to_char(sale_date,'YYYY-MM')=$2 AND NOT is_opening),0) month_sales,
      COALESCE((SELECT count(*) FROM sales WHERE to_char(sale_date,'YYYY-MM')=$2 AND NOT is_opening),0) month_bills,
      COALESCE((SELECT sum(amount) FROM expenses WHERE direction='out' AND to_char(exp_date,'YYYY-MM')=$2),0) month_exp,
      (SELECT count(*) FROM customers) customers,
      (SELECT count(*) FROM products WHERE active AND stock<=2) low_stock,
      COALESCE((SELECT sum(GREATEST(stock,0)*cost_price) FROM products WHERE active),0) stock_value,
      COALESCE((SELECT sum(opening_balance) FROM suppliers),0) + COALESCE((SELECT sum(total) FROM purchases),0) - COALESCE((SELECT sum(amount) FROM supplier_payments),0) payable,
      COALESCE((SELECT sum(amount) FROM supplier_payments WHERE to_char(paid_on,'YYYY-MM')=$2),0) month_sup_paid`, [asOf, month])).rows[0];
  // last 6 months collections
  const trend = (await q(`SELECT to_char(paid_on,'YYYY-MM') m, sum(amount) amt FROM payments
    WHERE paid_on >= (date_trunc('month', CURRENT_DATE) - interval '5 months') AND kind IN ('advance','installment') GROUP BY 1 ORDER BY 1`)).rows;
  res.json({ receivable: num(receivable), overdue: num(overdue), overdue_count: overdueCount, due_month: num(dueMonth), due_month_count: dueMonthCount,
    yearly_next: num(yearlyNext), yearly_count: yearlyCount, active_bills: active,
    today_in: num(r.today_in), month_in: num(r.month_in), month_sales: num(r.month_sales), month_bills: +r.month_bills,
    month_exp: num(num(r.month_exp) + num(r.month_sup_paid)), stock_value: num(r.stock_value), payable: num(r.payable), customers: +r.customers, low_stock: +r.low_stock, trend: trend.map((t) => ({ m: t.m, amt: num(t.amt) })) });
}));

// monthly report
app.get('/api/report', ownerOnly, wrap(async (req, res) => {
  const month = req.query.month || today().slice(0, 7);
  const [y, m] = month.split('-').map(Number);
  const from = `${month}-01`, to = ymd(new Date(y, m, 0));
  const sales = (await q(`SELECT s.bill_no, s.sale_date, s.total, s.items_total, s.markup_amt, s.advance, s.plan_type, c.name, p.name package_name
    FROM sales s JOIN customers c ON c.id=s.customer_id LEFT JOIN packages p ON p.id=s.package_id
    WHERE sale_date BETWEEN $1 AND $2 AND NOT s.is_opening ORDER BY sale_date`, [from, to])).rows;
  const cost = (await q(`SELECT COALESCE(sum(si.qty*pr.cost_price),0) c FROM sale_items si JOIN sales s ON s.id=si.sale_id
    LEFT JOIN products pr ON pr.id=si.product_id WHERE s.sale_date BETWEEN $1 AND $2 AND NOT s.is_opening`, [from, to])).rows[0].c;
  const pays = (await q(`SELECT kind, method, sum(amount) amt, count(*) n FROM payments WHERE paid_on BETWEEN $1 AND $2 AND kind IN ('advance','installment') GROUP BY 1,2`, [from, to])).rows;
  const exps = (await q(`SELECT category, direction, sum(amount) amt FROM expenses WHERE exp_date BETWEEN $1 AND $2 GROUP BY 1,2 ORDER BY 3 DESC`, [from, to])).rows;
  const purch = (await q(`SELECT p.purchase_no, p.purchase_date, p.total, s.name FROM purchases p JOIN suppliers s ON s.id=p.supplier_id
    WHERE purchase_date BETWEEN $1 AND $2 ORDER BY purchase_date`, [from, to])).rows;
  const supPaid = (await q('SELECT COALESCE(sum(amount),0) a FROM supplier_payments WHERE paid_on BETWEEN $1 AND $2', [from, to])).rows[0].a;
  const byStaff = (await q(`SELECT COALESCE(u.name,'—') name, sum(p.amount) amt, count(*) n FROM payments p LEFT JOIN users u ON u.id=p.received_by
    WHERE paid_on BETWEEN $1 AND $2 AND kind='installment' GROUP BY 1 ORDER BY 2 DESC`, [from, to])).rows;
  // expected vs collected for installments due this month
  const all = await allSalesAllocated();
  let expected = 0, stillDue = 0;
  for (const s of all) for (const x of s.schedule) if (x.due_date >= from && x.due_date <= to) { expected += x.amount; stillDue += x.remaining; }
  res.json({ month, from, to, sales: sales.map((s) => ({ ...s, sale_date: ymd(s.sale_date) })),
    sales_total: num(sales.reduce((a, s) => a + num(s.total), 0)), markup_total: num(sales.reduce((a, s) => a + num(s.markup_amt), 0)),
    cost_total: num(cost), payments: pays.map((p) => ({ ...p, amt: num(p.amt), n: +p.n })), expenses: exps.map((e) => ({ ...e, amt: num(e.amt) })),
    purchases: purch.map((p) => ({ ...p, total: num(p.total) })), purchases_total: num(purch.reduce((a, p) => a + num(p.total), 0)), supplier_paid: num(supPaid),
    by_staff: byStaff.map((b) => ({ ...b, amt: num(b.amt), n: +b.n })), expected: num(expected), still_due: num(stillDue) });
}));

// demo data loader (owner) — only when there are no bills
app.post('/api/demo-data', ownerOnly, wrap(async (req, res) => {
  const n = (await q('SELECT count(*)::int c FROM sales')).rows[0].c;
  if (n) throw new Error('Demo data can only be loaded into an empty app');
  const prods = [
    ['LED TV 43" (Samsung)', 'Electronics', 72000, 85000, 6], ['Refrigerator 14 cft (Dawlance)', 'Electronics', 98000, 115000, 4],
    ['Washing Machine Twin Tub', 'Electronics', 30000, 36000, 5], ['Split AC 1.5 Ton Inverter', 'Electronics', 140000, 165000, 3],
    ['Microwave Oven', 'Electronics', 22000, 27000, 6], ['Mobile Phone (Infinix Hot)', 'Mobiles', 32000, 38000, 8],
    ['Honda CD 70', 'Bikes', 152000, 162000, 3], ['Honda CG 125', 'Bikes', 228000, 240000, 2], ['Electric Scooter', 'Bikes', 115000, 130000, 2],
    ['Bridal Dress (Lehnga)', 'Clothes', 45000, 60000, 4], ['Unstitched Suit 3pc (Lawn)', 'Clothes', 3500, 5000, 30], ['Gents Suit (Shalwar Kameez)', 'Clothes', 2800, 4000, 20],
    ['Bed Set (Double + 2 Side Tables)', 'Furniture', 85000, 105000, 3], ['Sofa Set 5 Seater', 'Furniture', 70000, 88000, 2], ['Dinner Set 72 pcs', 'Crockery', 9000, 12000, 10],
    ['Iron (Philips)', 'Electronics', 4000, 5500, 10], ['Ceiling Fan', 'Electronics', 9500, 12500, 12],
  ];
  const ids = {};
  const base0 = new Date();
  const openDate = ymd(new Date(base0.getFullYear() - 1, base0.getMonth(), 1));
  for (const p of prods) {
    ids[p[0]] = (await q('INSERT INTO products(name,category,cost_price,cash_price,stock) VALUES ($1,$2,$3,$4,0) RETURNING id', p.slice(0, 4))).rows[0].id;
    await addMove(pool, { product_id: ids[p[0]], date: openDate, kind: 'opening', qty: p[4] + 2, unit_cost: p[2], note: 'Opening stock', user: req.user.id });
  }
  const mk = async (name, desc, list) => {
    const pid = (await q('INSERT INTO packages(name,description) VALUES ($1,$2) RETURNING id', [name, desc])).rows[0].id;
    for (const [n2, qty] of list) await q('INSERT INTO package_items(package_id,product_id,qty) VALUES ($1,$2,$3)', [pid, ids[n2], qty]);
    return pid;
  };
  const jahezBasic = await mk('Jahez Package — Basic', 'Essential dowry items', [['Refrigerator 14 cft (Dawlance)', 1], ['Washing Machine Twin Tub', 1], ['Iron (Philips)', 1], ['Dinner Set 72 pcs', 1], ['Ceiling Fan', 2]]);
  await mk('Jahez Package — Premium', 'Complete dowry: furniture + appliances + bridal', [['Bed Set (Double + 2 Side Tables)', 1], ['Sofa Set 5 Seater', 1], ['Refrigerator 14 cft (Dawlance)', 1], ['LED TV 43" (Samsung)', 1], ['Washing Machine Twin Tub', 1], ['Microwave Oven', 1], ['Dinner Set 72 pcs', 1], ['Bridal Dress (Lehnga)', 1]]);
  await mk('Eid Clothes Package', 'Family clothes bundle', [['Unstitched Suit 3pc (Lawn)', 4], ['Gents Suit (Shalwar Kameez)', 2]]);
  const custs = [
    ['Abdul Wali', 'Haji Gul Muhammad', '03001234567', '56302-1234567-1', 'House 12', 'Zhob Road', 'Naseebullah', '03011112222'],
    ['Zarghuna Bibi', 'Muhammad Akbar', '03111234567', '56302-2345678-2', 'Street 7', 'Cantt Area', 'Muhammad Akbar', '03215556666'],
    ['Saifullah Kakar', 'Abdul Rauf', '03211234567', '56302-3456789-3', 'Near Jamia Masjid', 'Main Bazaar', 'Hayatullah', '03334445555'],
    ['Gul Bibi', 'Abdul Samad', '03331234567', '56302-4567890-4', 'Mohalla Kakar', 'Duki Road', 'Ahmed Jan', '03456667777'],
    ['Habibullah', 'Ghulam Haider', '03451234567', '56302-5678901-5', 'Block C', 'Satellite Town', 'Wali Muhammad', '03007778888'],
    ['Rahmatullah', 'Sher Muhammad', '03061234567', '56302-6789012-6', 'Gali 2', 'Sabzi Mandi', 'Abdul Hadi', '03128889999'],
  ];
  const cid = [];
  for (const c of custs) { const id = (await q(`INSERT INTO customers(name,father_name,phone,cnic,address,area,guarantor_name,guarantor_phone) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`, c)).rows[0].id; await q('UPDATE customers SET code=$1 WHERE id=$2', [await nextCode(), id]); cid.push(id); }
  const base = new Date();
  const ago = (months) => ymd(new Date(base.getFullYear(), base.getMonth() - months, Math.min(base.getDate(), 5)));
  const pk = (await q('SELECT * FROM packages')).rows;
  const prodRow = async (name) => (await q('SELECT * FROM products WHERE id=$1', [ids[name]])).rows[0];
  const makeSale = async (customer_id, itemNames, opt) => {
    const items = [];
    for (const [n2, qty] of itemNames) { const p = await prodRow(n2); items.push({ product_id: p.id, name: p.name, qty, price: num(p.cash_price) }); }
    const fake = { body: { customer_id, items, ...opt }, user: req.user };
    const c = await computeSale(fake.body);
    const s = (await q(`INSERT INTO sales(customer_id,sale_date,package_id,items_total,markup_pct,markup_amt,discount,total,advance,plan_type,installments_count,installment_amt,first_due_date,created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`, [customer_id, c.sale_date, opt.package_id || null, c.items_total, c.markup_pct, c.markup_amt, c.discount, c.total, c.advance, c.plan_type, c.installments_count, c.installment_amt, c.first_due_date, req.user.id])).rows[0];
    await q('UPDATE sales SET bill_no=$1 WHERE id=$2', ['B-' + String(s.id).padStart(5, '0'), s.id]);
    for (const i of c.items) { await q('INSERT INTO sale_items(sale_id,product_id,name,qty,price) VALUES ($1,$2,$3,$4,$5)', [s.id, i.product_id, i.name, i.qty, i.price]); await addMove(pool, { product_id: i.product_id, date: c.sale_date, kind: 'sale', qty: -i.qty, ref_type: 'sale', ref_id: s.id, ref_no: 'B-' + String(s.id).padStart(5, '0'), note: 'Sold on qist', user: req.user.id }); }
    for (const x of c.schedule) await q('INSERT INTO installments(sale_id,seq,due_date,amount) VALUES ($1,$2,$3,$4)', [s.id, x.seq, x.due_date, x.amount]);
    const pay = async (amt, d, kind = 'installment') => {
      const p = (await q('INSERT INTO payments(sale_id,customer_id,amount,kind,paid_on,method,received_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id', [s.id, customer_id, amt, kind, d, 'Cash', req.user.id])).rows[0];
      await q('UPDATE payments SET receipt_no=$1 WHERE id=$2', ['R-' + String(p.id).padStart(5, '0'), p.id]);
    };
    if (c.advance) await pay(c.advance, c.sale_date, 'advance');
    for (const x of c.schedule.slice(0, opt.paidCount || 0)) await pay(x.amount, x.due_date);
    return s.id;
  };
  const basicItems = pk.find((p) => p.id === jahezBasic) ? [['Refrigerator 14 cft (Dawlance)', 1], ['Washing Machine Twin Tub', 1], ['Iron (Philips)', 1], ['Dinner Set 72 pcs', 1], ['Ceiling Fan', 2]] : [];
  await makeSale(cid[0], [['Honda CD 70', 1]], { sale_date: ago(5), markup_pct: 20, advance: 40000, plan_type: 'monthly', installments_count: 12, paidCount: 4 });
  await makeSale(cid[1], [...basicItems, ['Bridal Dress (Lehnga)', 1]], { sale_date: ago(4), package_id: jahezBasic, markup_pct: 30, advance: 50000, plan_type: 'yearly', installments_count: 3, paidCount: 0 });
  await makeSale(cid[2], [['LED TV 43" (Samsung)', 1]], { sale_date: ago(4), markup_pct: 25, advance: 15000, plan_type: 'monthly', installments_count: 10, paidCount: 2 });
  await makeSale(cid[3], [['Mobile Phone (Infinix Hot)', 1], ['Unstitched Suit 3pc (Lawn)', 3]], { sale_date: ago(2), markup_pct: 25, advance: 8000, plan_type: 'monthly', installments_count: 6, paidCount: 2 });
  await makeSale(cid[4], [['Split AC 1.5 Ton Inverter', 1]], { sale_date: ago(13), markup_pct: 25, advance: 30000, plan_type: 'yearly', installments_count: 2, paidCount: 1 });
  await makeSale(cid[5], [['Honda CG 125', 1]], { sale_date: ago(1), markup_pct: 20, advance: 60000, plan_type: 'monthly', installments_count: 18, paidCount: 0 });
  for (const [d, cat, amt, dir, note] of [[ago(1), 'Shop Rent', 45000, 'out', ''], [ago(1), 'Staff Salary', 35000, 'out', 'Recovery staff'], [ago(0), 'Electricity Bill', 12000, 'out', ''], [ago(2), 'Owner Investment', 500000, 'in', 'Capital']])
    await q('INSERT INTO expenses(exp_date,category,amount,direction,note,created_by) VALUES ($1,$2,$3,$4,$5,$6)', [d, cat, amt, dir, note, req.user.id]);
  await q(`UPDATE customers c SET plan_type='yearly' WHERE EXISTS (SELECT 1 FROM sales s WHERE s.customer_id=c.id AND s.plan_type='yearly')`);
  // suppliers + purchases
  const sup1 = (await q(`INSERT INTO suppliers(name,phone,address,opening_balance) VALUES ('Atlas Honda Dealer Quetta','03007001122','Sariab Road, Quetta',0) RETURNING id`)).rows[0].id;
  const sup2 = (await q(`INSERT INTO suppliers(name,phone,address,opening_balance) VALUES ('Quetta Electronics Wholesale','03214445566','Liaquat Bazaar, Quetta',75000) RETURNING id`)).rows[0].id;
  const buy = async (sup, date, lines, paid, invoice) => {
    const total = lines.reduce((a, [nm, qty, cost]) => a + qty * cost, 0);
    const pid = (await q('INSERT INTO purchases(supplier_id,purchase_date,total,invoice_ref,created_by) VALUES ($1,$2,$3,$4,$5) RETURNING id', [sup, date, total, invoice, req.user.id])).rows[0].id;
    const no = 'P-' + String(pid).padStart(5, '0');
    await q('UPDATE purchases SET purchase_no=$1 WHERE id=$2', [no, pid]);
    for (const [nm, qty, cost] of lines) {
      await q('INSERT INTO purchase_items(purchase_id,product_id,qty,cost) VALUES ($1,$2,$3,$4)', [pid, ids[nm], qty, cost]);
      await addMove(pool, { product_id: ids[nm], date, kind: 'purchase', qty, unit_cost: cost, ref_type: 'purchase', ref_id: pid, ref_no: no, note: 'Stock in', user: req.user.id });
    }
    if (paid) await q('INSERT INTO supplier_payments(supplier_id,purchase_id,amount,paid_on,method,note,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7)', [sup, pid, paid, date, 'Cash', 'Paid with ' + no, req.user.id]);
  };
  await buy(sup1, ago(0), [['Honda CD 70', 1, 152000], ['Honda CG 125', 1, 228000]], 150000, 'AH-2231');
  await buy(sup2, ago(1), [['LED TV 43" (Samsung)', 2, 72000], ['Microwave Oven', 2, 22000]], 100000, 'HR-889');
  await q(`INSERT INTO supplier_payments(supplier_id,amount,paid_on,method,note,created_by) VALUES ($1,50000,$2,'Bank Transfer','Part payment',$3)`, [sup2, ago(0), req.user.id]);
  res.json({ ok: true });
}));

app.get(/^\/(?!api).*/, (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

migrate().then(() => app.listen(PORT, () => console.log(`QistBook running on :${PORT}`)))
  .catch((e) => { console.error('Migration failed', e); process.exit(1); });
