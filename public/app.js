/* QistBook front-end — vanilla JS SPA */
const S = { token: localStorage.getItem('qb_token'), user: JSON.parse(localStorage.getItem('qb_user') || 'null'), settings: {}, cache: {} };
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const n = (v) => Math.round((parseFloat(v) || 0) * 100) / 100;
const rs = (v) => 'Rs ' + Math.round(n(v)).toLocaleString('en-PK');
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fd = (d) => { if (!d) return '—'; const [y, m, dd] = String(d).slice(0, 10).split('-'); return `${+dd} ${MONTHS[+m - 1]} ${y}`; };
const fm = (ym) => { const [y, m] = ym.split('-'); return `${MONTHS[+m - 1]} ${y}`; };
const isOwner = () => S.user && S.user.role === 'owner';
const initials = (s) => String(s || '?').split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

async function api(path, opts = {}) {
  const res = await fetch('/api' + path, {
    method: opts.method || 'GET',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (S.token || '') },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== '/login') { logout(); throw new Error('Please login again'); }
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}
function toast(msg, err) {
  const t = $('#toast'); t.textContent = msg; t.className = 'toast' + (err ? ' err' : '');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.add('hidden'), 2600);
}
function openSheet(html) { $('#sheetCard').innerHTML = html; $('#sheet').classList.remove('hidden'); }
function closeSheet() { $('#sheet').classList.add('hidden'); $('#sheetCard').innerHTML = ''; }
function logout() { localStorage.removeItem('qb_token'); localStorage.removeItem('qb_user'); S.token = null; S.user = null; render(); }
const go = (h) => { location.hash = h; };
window.addEventListener('hashchange', render);

function waLink(phone, text) {
  let p = String(phone || '').replace(/\D/g, '');
  if (p.startsWith('0')) p = '92' + p.slice(1);
  else if (p.length === 10) p = '92' + p;
  return `https://wa.me/${p}?text=${encodeURIComponent(text)}`;
}
function fillTpl(tpl, vals) { return String(tpl || '').replace(/\{(\w+)\}/g, (_, k) => (vals[k] ?? '')); }

// ---------- layout ----------
function shell(title, body, { back, action, sub } = {}) {
  const r = (location.hash || '#/home').split('?')[0];
  const tab = (h, i, l, cls = '') => `<a href="${h}" class="${cls} ${r.startsWith(h) ? 'on' : ''}"><span class="i">${i}</span>${l}</a>`;
  const side = (h, i, l, also = []) => `<a href="${h}" class="${[h, ...also].some((x) => r === x || r.startsWith(x + '/')) ? 'on' : ''}"><span class="i">${i}</span>${l}</a>`;
  $('#app').innerHTML = `
    <aside class="side">
      <div class="brand"><img src="/icon.svg" alt=""><div><b>QistBook</b><small>${esc(S.settings.business_name || '')}</small></div></div>
      <a href="#/new" class="newbill">+ New installment bill</a>
      <form class="slook" onsubmit="event.preventDefault();lookupCode(this.c.value)"><input name="c" placeholder="Customer code…" autocomplete="off"><button>Check</button></form>
      <div class="sgroup">Daily work</div>
      ${side('#/home', '⌂', 'Dashboard')}
      ${side('#/recovery', '◷', 'Recovery / collection')}
      ${side('#/customers', '☺', 'Customers', ['#/customer'])}
      ${side('#/bills', '▤', 'All bills', ['#/bill'])}
      ${side('#/old', '⟲', 'Add old customers')}
      ${isOwner() ? `<div class="sgroup">Stock</div>
      ${side('#/inventory', '▦', 'Inventory khata', ['#/stock', '#/products'])}
      ${side('#/purchase', '⇩', 'Stock in (purchase)')}
      ${side('#/suppliers', '⚑', 'Suppliers khata', ['#/supplier'])}
      ${side('#/packages', '♦', 'Packages (Jahez)')}
      <div class="sgroup">Accounts</div>
      ${side('#/khata', '₨', 'Business khata')}
      ${side('#/report', '▥', 'Monthly report')}
      <div class="sgroup">Admin</div>
      ${side('#/staff', '☻', 'Staff & PINs')}
      ${side('#/settings', '⚙', 'Settings')}` : ''}
      <div class="sfoot"><div><b>${esc(S.user.name)}</b><small>${S.user.role === 'owner' ? 'Owner' : 'Recovery staff'}</small></div><button onclick="logout()">Log out</button></div>
    </aside>
    <main class="main">
      <div class="top">
        ${back ? `<button class="back" onclick="history.back()">‹</button>` : ''}
        <h1>${esc(title)}${sub ? `<div class="sub">${esc(sub)}</div>` : ''}</h1>
        ${action || ''}
      </div>
      <div class="wrap">${body}</div>
    </main>
    <nav class="nav"><div class="nav-in">
      ${tab('#/home', '⌂', 'Home')}
      ${tab('#/recovery', '◷', 'Recovery')}
      ${tab('#/new', '+', 'New Bill', 'plus')}
      ${tab('#/customers', '☺', 'Customers')}
      ${tab('#/more', '☰', 'More')}
    </div></nav>`;
}
const loading = (t) => shell(t, '<div class="empty"><div class="i">⏳</div>Loading…</div>');

// ---------- router ----------
async function render() {
  if (!S.token) return renderLogin();
  if (!S.settings.business_name) { try { S.settings = await api('/settings'); } catch (e) { return; } }
  const [, route, id] = (location.hash || '#/home').split('?')[0].split('/');
  window.scrollTo(0, 0);
  closeSheet();
  try {
    switch (route) {
      case 'recovery': return await renderRecovery(id || 'due');
      case 'new': return await renderNewBill();
      case 'customers': return await renderCustomers();
      case 'customer': return await renderCustomer(id);
      case 'bill': return await renderBill(id);
      case 'bills': return await renderBills();
      case 'more': return renderMore();
      case 'products': case 'inventory': return await renderInventory();
      case 'stock': return await renderStock(id);
      case 'old': return await renderOld(id);
      case 'purchase': return await renderPurchase();
      case 'suppliers': return await renderSuppliers();
      case 'supplier': return await renderSupplier(id);
      case 'packages': return await renderPackages();
      case 'khata': return await renderKhata(id);
      case 'report': return await renderReport(id);
      case 'staff': return await renderStaff();
      case 'settings': return renderSettings();
      default: return await renderHome();
    }
  } catch (e) { shell('Error', `<div class="card">${esc(e.message)}</div>`); }
}

// ---------- login ----------
function renderLogin() {
  let pin = '';
  $('#app').innerHTML = `<div class="login">
    <img class="logo" src="/icon.svg" alt="">
    <h2>QistBook</h2><p>Installment business manager</p>
    <div class="dots" id="dots">${'<i></i>'.repeat(4)}</div>
    <div class="pad">${[1, 2, 3, 4, 5, 6, 7, 8, 9, '', 0, '⌫'].map((k) => `<button ${k === '' ? 'style="visibility:hidden"' : ''} data-k="${k}">${k}</button>`).join('')}</div>
    <div class="hint">Demo PINs — Owner: 1234 · Recovery staff: 1111</div></div>`;
  const paint = () => $('#dots').innerHTML = [0, 1, 2, 3].map((i) => `<i class="${i < pin.length ? 'on' : ''}"></i>`).join('');
  const press = async (k) => {
    if (k === '⌫') pin = pin.slice(0, -1); else if (pin.length < 6) pin += k;
    paint();
    if (pin.length >= 4) {
      try {
        const r = await api('/login', { method: 'POST', body: { pin } });
        S.token = r.token; S.user = r.user; localStorage.setItem('qb_token', r.token); localStorage.setItem('qb_user', JSON.stringify(r.user));
        S.settings = {}; render();
      } catch (e) { if (pin.length >= 4) { toast(e.message, 1); pin = ''; paint(); } }
    }
  };
  document.querySelectorAll('.pad button').forEach((b) => b.onclick = () => press(b.dataset.k));
  document.onkeydown = (e) => { if (!S.token && /^\d$/.test(e.key)) press(e.key); if (!S.token && e.key === 'Backspace') press('⌫'); };
}

// ---------- home ----------
async function renderHome() {
  loading(S.settings.business_name);
  const d = await api('/dashboard');
  const max = Math.max(1, ...d.trend.map((t) => t.amt));
  const yMonth = MONTHS[(+S.settings.yearly_month || 8) - 1];
  const rec = await api('/recovery?mode=overdue');
  shell(S.settings.business_name, `
    ${lookupBox()}
    <div class="stats">
      <div class="stat hero" onclick="go('#/bills')"><div class="l">Total receivable (market mein baqaya)</div><div class="v money">${rs(d.receivable)}</div><div class="s">${d.active_bills} active bills · ${d.customers} customers</div></div>
      <div class="stat" onclick="go('#/recovery/due')"><div class="l">Due this month</div><div class="v money">${rs(d.due_month)}</div><div class="s">${d.due_month_count} installments</div></div>
      <div class="stat red" onclick="go('#/recovery/overdue')"><div class="l">Overdue</div><div class="v money">${rs(d.overdue)}</div><div class="s">${d.overdue_count} customers late</div></div>
      <div class="stat amb" onclick="go('#/recovery/yearly')"><div class="l">Next ${yMonth} collection</div><div class="v money">${rs(d.yearly_next)}</div><div class="s">${d.yearly_count} yearly-plan bills</div></div>
      <div class="stat blue"><div class="l">Collected today</div><div class="v money">${rs(d.today_in)}</div><div class="s">This month: ${rs(d.month_in)}</div></div>
    </div>
    <div class="cols"><div>
    <div class="card"><div class="row"><h3 class="grow" style="margin:0">Collections — last 6 months</h3></div>
      <div class="bar">${d.trend.length ? d.trend.map((t) => `<div><em>${Math.round(t.amt / 1000)}k</em><span class="b2" style="height:${Math.max(3, (t.amt / max) * 80)}px"></span><small>${fm(t.m).slice(0, 3)}</small></div>`).join('') : '<div class="mut sm" style="align-self:center">No collections yet</div>'}</div>
    </div>
    <div class="card"><div class="g2">
      <div><div class="mut sm">Sales this month</div><div class="b money">${rs(d.month_sales)} <span class="mut sm">(${d.month_bills} bills)</span></div></div>
      ${isOwner() ? `<div><div class="mut sm">Expenses this month</div><div class="b money">${rs(d.month_exp)}</div></div>` : ''}
    </div>
    ${isOwner() ? `<div class="g2" style="margin-top:10px"><div style="cursor:pointer" onclick="go('#/inventory')"><div class="mut sm">Stock value (at cost)</div><div class="b money">${rs(d.stock_value)}</div></div>
      <div style="cursor:pointer" onclick="go('#/suppliers')"><div class="mut sm">Payable to suppliers</div><div class="b money" style="color:var(--red)">${rs(d.payable)}</div></div></div>` : ''}
    ${d.low_stock && isOwner() ? `<div class="sm" style="margin-top:10px"><span class="pill amb">${d.low_stock} products low on stock</span> <a href="#/inventory">View</a></div>` : ''}</div>
    </div><div>
    <div class="row" style="margin:6px 2px 8px"><h3 class="grow" style="margin:0;font-size:15px">Late customers</h3><a class="sm" href="#/recovery/overdue">See all</a></div>
    ${recList(rec.slice(0, 5))}
    ${d.active_bills === 0 && isOwner() ? `<div class="card"><h3>Start with sample data?</h3><p class="mut sm">Load demo products (electronics, bikes, clothes), Jahez packages, customers and bills to see how the app works.</p><button class="btn" onclick="loadDemo()">Load demo data</button></div>` : ''}
    </div></div>
  `, { action: `<button class="act" onclick="go('#/new')">+ Bill</button>` });
}
async function loadDemo() {
  try { await api('/demo-data', { method: 'POST' }); toast('Demo data loaded'); render(); } catch (e) { toast(e.message, 1); }
}

// ---------- customer code lookup ----------
function lookupBox() {
  return `<form class="card lookup" onsubmit="event.preventDefault();lookupCode(this.c.value)">
    <div class="grow"><div class="b" style="margin-bottom:6px">Check customer by code</div>
    <div class="row"><input name="c" placeholder="Enter code e.g. ${esc(S.settings.code_prefix || 'AQ')}-1001" autocomplete="off" style="text-transform:uppercase"><button class="btn">Check</button></div></div></form>`;
}
async function lookupCode(code) {
  code = String(code || '').trim();
  if (!code) return toast('Enter a customer code', 1);
  let d;
  try { d = await api('/lookup/' + encodeURIComponent(code)); } catch (e) { return toast(e.message, 1); }
  const c = d.customer;
  window._look = d;
  const pct = d.total ? Math.round((d.paid / d.total) * 100) : 0;
  openSheet(`<div class="row" style="margin-bottom:12px"><div class="av" style="width:48px;height:48px">${initials(c.name)}</div>
      <div class="grow"><div class="b" style="font-size:18px">${esc(c.name)} <span class="code">${esc(c.code)}</span></div>
      <div class="mut sm">${esc(c.phone || '')}${c.area ? ' · ' + esc(c.area) : ''}${c.father_name ? ' · ' + esc(c.father_name) : ''}</div></div>
      <button class="btn sm ghost" onclick="closeSheet()">✕</button></div>
    ${d.bills.length ? `
    <div class="g3 lk-big">
      <div><div class="mut sm">Total</div><b class="money">${rs(d.total)}</b></div>
      <div><div class="mut sm">Paid</div><b class="money" style="color:var(--g2)">${rs(d.paid)}</b></div>
      <div><div class="mut sm">Remaining</div><b class="money" style="color:${d.balance > 0 ? 'var(--red)' : 'var(--g)'}">${rs(d.balance)}</b></div>
    </div>
    <div class="progress" style="margin:8px 0 4px"><i style="width:${pct}%"></i></div>
    <div class="row sm" style="margin-bottom:12px"><span class="grow mut">${pct}% paid</span>
      <b>${d.inst_paid} qist paid · <span style="color:${d.inst_left ? 'var(--red)' : 'var(--g)'}">${d.inst_left} left</span> <span class="mut">(of ${d.inst_total})</span></b></div>
    ${d.overdue > 0 ? `<div class="card" style="background:var(--redl);border-color:#f0c6c1;padding:10px 12px"><b style="color:var(--red)">Late: ${rs(d.overdue)}</b></div>` : ''}
    ${d.bills.map((b) => `<div class="card" style="padding:12px">
      <div class="row"><div class="grow"><b>${b.bill_no}</b> <span class="pill ${b.plan_type === 'yearly' ? 'amb' : 'blue'}">${b.plan_type === 'yearly' ? 'Yearly' : 'Monthly'}</span> ${b.balance <= 0 ? '<span class="pill">Completed</span>' : ''}
        <div class="sm mut" style="margin-top:2px">${b.package_name ? esc(b.package_name) + ' · ' : ''}${esc(b.items)} · ${fd(b.sale_date)}</div></div></div>
      <table class="lk-tbl" style="margin-top:8px">
        <tr><td></td><th class="right">Qist</th><th class="right">Rupees</th></tr>
        <tr><td>Total (${b.inst_total} × ${rs(b.installment_amt)} + advance ${rs(b.advance)})</td><td class="right">${b.inst_total}</td><td class="right money">${rs(b.total)}</td></tr>
        <tr><td style="color:var(--g2)">Given / paid</td><td class="right b" style="color:var(--g2)">${b.inst_paid}</td><td class="right money b" style="color:var(--g2)">${rs(b.paid)}</td></tr>
        <tr><td style="color:var(--red)">Left</td><td class="right b" style="color:var(--red)">${b.inst_left}</td><td class="right money b" style="color:var(--red)">${rs(b.balance)}</td></tr>
      </table>
      <div class="sm" style="margin-top:8px">${b.next_due ? `Next qist: <b>${rs(b.next_amt)}</b> on <b>${fd(b.next_due)}</b>` : '<b style="color:var(--g)">All installments paid</b>'}
        ${b.overdue_count ? ` · <span style="color:var(--red)">${b.overdue_count} late (${rs(b.overdue_amt)})</span>` : ''}
        ${b.last_payment ? `<div class="mut">Last payment: ${rs(b.last_payment.amount)} on ${fd(b.last_payment.date)}</div>` : ''}</div>
      <div class="btns" style="margin-top:10px">${b.balance > 0 ? `<button class="btn sm" onclick="collectSheet(${b.id})">Collect qist</button>` : ''}<button class="btn sm ghost" onclick="go('#/bill/${b.id}')">Open bill</button></div>
    </div>`).join('')}` : '<div class="empty">This customer has no bills yet.</div>'}
    <div class="btns"><button class="btn ghost grow" onclick="go('#/customer/${c.id}')">Full khata</button>
      ${c.phone && d.bills.length ? `<a class="btn wa grow" target="_blank" href="${waLink(c.phone, lookupWaText(d))}">Send on WhatsApp</a>` : ''}</div>`);
}
function lookupWaText(d) {
  const c = d.customer;
  const lines = d.bills.filter((b) => b.balance > 0).map((b) => `${b.bill_no}: ${b.inst_paid} qist paid (Rs ${Math.round(b.paid).toLocaleString('en-PK')}), ${b.inst_left} qist baqi (Rs ${Math.round(b.balance).toLocaleString('en-PK')})${b.next_due ? ', agli qist ' + fd(b.next_due) : ''}`);
  return `Assalam o Alaikum ${c.name} (Code ${c.code}),\n${lines.join('\n')}\nKul baqaya: Rs ${Math.round(d.balance).toLocaleString('en-PK')}\n— ${S.settings.business_name}`;
}

// ---------- old / ongoing customers ----------
const OB = { plan: 'monthly', existing: null };
async function renderOld(tab) {
  const pre = new URLSearchParams(location.hash.split('?')[1] || '');
  shell('Add old customers', `
    <p class="mut sm" style="margin:0 2px 12px">For customers who bought <b>before</b> you started using the app. Enter their old code, what they bought, their plan and how much they have already paid. This does <b>not</b> change your current stock or today's cash.</p>
    <div id="oldBody"></div>`, { back: true });
  OB.plan = 'monthly'; OB.existing = null;
  let suggested = pre.get('code') || '';
  if (!suggested) { try { suggested = (await api('/customers/next-code')).code; } catch (e) { /* ignore */ } }
  const f = (k, l, t = 'text', ph = '', v = '') => `<label class="f"><span>${l}</span><input id="ob_${k}" type="${t}" placeholder="${ph}" value="${esc(v)}"></label>`;
  $('#oldBody').innerHTML = `<div class="cols wide"><div>
    <div class="card"><h3>1 · Customer</h3>
      <div class="codebox"><div class="grow"><div class="mut sm b">Customer code (their old code)</div><input id="ob_code" value="${esc(suggested)}" autocomplete="off"></div>
      <div class="sm mut" style="max-width:190px">Type the code from your register. If the code already exists, the bill is added to that customer.</div></div>
      <div id="obExisting"></div>
      <div id="obNew">
        <div class="g2">${f('name', 'Full name *')}${f('father_name', 'Father / Husband name')}</div>
        <div class="g2">${f('phone', 'Mobile (WhatsApp)', 'tel', '03xx-xxxxxxx')}${f('area', 'Area / Mohalla')}</div>
        <div class="g2">${f('cnic', 'CNIC')}${f('address', 'Address')}</div>
        <div class="g2">${f('guarantor_name', 'Guarantor (zamin)')}${f('guarantor_phone', 'Guarantor phone', 'tel')}</div>
      </div>
    </div>
    <div class="card"><h3>2 · Goods bought</h3>
      <label class="f"><span>Goods bought *</span><textarea id="ob_goods" rows="2" placeholder="e.g. Honda CD 70  /  Jahez: fridge, washing machine, bed set"></textarea></label>
      <div class="g2">${f('old_ref', 'Old bill / register no.', 'text', 'optional')}${f('sale_date', 'Purchase date', 'date')}</div>
    </div>
    <div class="card"><h3>3 · Plan and payments so far</h3>
      <div class="seg" id="obSeg"><button data-p="monthly" class="on">Pays every month</button><button data-p="yearly">Pays once a year (${MONTHS[(+S.settings.yearly_month || 8) - 1]} to ${MONTHS[(+S.settings.yearly_month || 8) - 1]})</button></div>
      <div class="g2">${f('total', 'Total installment price (Rs) *', 'number')}${f('advance', 'Advance paid (Rs)', 'number', '0')}</div>
      <div class="g2">${f('installments_count', 'Total installments *', 'number', '12')}${f('paid_count', 'Installments already paid', 'number', '0')}</div>
      <div class="g2">${f('paid_amount', 'Paid so far, without advance (Rs)', 'number', 'auto')}${f('next_due', 'Next installment due date', 'date')}</div>
      <div class="mut sm">Leave "Paid so far" empty to calculate it from installments paid. Fill it in only if the customer paid an odd amount.</div>
    </div>
  </div><div class="sticky">
    <div class="card" id="obSum"><div class="mut sm">Fill in the amounts to see the summary.</div></div>
    <button class="btn full amb" id="obSave" style="padding:14px;font-size:15px">Save old customer</button>
  </div></div>`;
  document.querySelectorAll('#obSeg button').forEach((b) => b.onclick = () => { OB.plan = b.dataset.p; document.querySelectorAll('#obSeg button').forEach((x) => x.classList.toggle('on', x === b)); obPreview(); });
  ['total', 'advance', 'installments_count', 'paid_count', 'paid_amount', 'next_due', 'sale_date'].forEach((k) => $('#ob_' + k).oninput = debounce(obPreview, 300));
  $('#ob_code').oninput = debounce(obCheckCode, 400);
  $('#obSave').onclick = obSave;
  if (pre.get('code')) obCheckCode();
}
async function obCheckCode() {
  const code = $('#ob_code').value.trim();
  OB.existing = null;
  if (code) { try { const d = await api('/lookup/' + encodeURIComponent(code)); if (d.customer.code.toUpperCase() === code.toUpperCase()) OB.existing = d; } catch (e) { /* new */ } }
  $('#obNew').classList.toggle('hidden', !!OB.existing);
  $('#obExisting').innerHTML = OB.existing ? `<div class="card" style="background:var(--bluel);border-color:#c9daf0;margin:0 0 4px;padding:10px 12px">
    <b>Existing customer: ${esc(OB.existing.customer.name)}</b> <span class="sm mut">${esc(OB.existing.customer.phone || '')} · ${OB.existing.bills.length} bill(s) · balance ${rs(OB.existing.balance)}</span>
    <div class="sm">This old bill will be added to this customer.</div></div>` : '';
}
function obBody() {
  const v = (k) => { const el = $('#ob_' + k); return el ? el.value.trim() : ''; };
  const body = { plan_type: OB.plan };
  ['code', 'name', 'father_name', 'phone', 'area', 'cnic', 'address', 'guarantor_name', 'guarantor_phone', 'goods', 'old_ref', 'sale_date', 'total', 'advance', 'installments_count', 'paid_count', 'paid_amount', 'next_due'].forEach((k) => body[k] = v(k));
  if (OB.existing) body.customer_id = OB.existing.customer.id;
  return body;
}
async function obPreview() {
  const box = $('#obSum'); if (!box) return;
  const b = obBody();
  if (!b.total || !b.installments_count) { box.innerHTML = '<div class="mut sm">Fill in the total price and number of installments to see the summary.</div>'; return; }
  try {
    const p = await api('/opening/preview', { method: 'POST', body: b });
    if (!b.next_due && p.next_due) $('#ob_next_due').placeholder = p.next_due;
    box.innerHTML = `<h3>Summary</h3>
      <table class="lk-tbl"><tr><td></td><th class="right">Qist</th><th class="right">Rupees</th></tr>
      <tr><td>Total (${p.installments_count} × ${rs(p.installment_amt)}${p.advance ? ' + advance ' + rs(p.advance) : ''})</td><td class="right">${p.installments_count}</td><td class="right money">${rs(p.total)}</td></tr>
      <tr><td style="color:var(--g2)">Already paid${p.advance ? ' (incl. advance)' : ''}</td><td class="right b" style="color:var(--g2)">${p.paid_installments}</td><td class="right money b" style="color:var(--g2)">${rs(p.paid_amount + p.advance)}</td></tr>
      <tr><td style="color:var(--red)">Left</td><td class="right b" style="color:var(--red)">${p.left_installments}</td><td class="right money b" style="color:var(--red)">${rs(p.balance)}</td></tr></table>
      <div class="sumline" style="background:var(--ambl);border-radius:10px;padding:10px;margin-top:10px"><span><b>${rs(p.installment_amt)}</b> ${p.plan_type === 'yearly' ? 'every year' : 'per month'}</span><span class="sm">${p.next_due ? 'next ' + fd(p.next_due) : 'fully paid'}</span></div>
      <details style="margin-top:8px"><summary class="sm mut" style="cursor:pointer">View full schedule</summary>
      <table style="margin-top:6px"><tr><th>#</th><th>Due</th><th class="right">Qist</th><th>Status</th></tr>${p.schedule.map((x) => `<tr><td>${x.seq}</td><td>${fd(x.due_date)}</td><td class="right money">${rs(x.amount)}</td><td><span class="pill ${ST[x.status][1]}">${ST[x.status][0]}</span></td></tr>`).join('')}</table></details>`;
  } catch (e) { box.innerHTML = `<div class="sm" style="color:var(--red)">${esc(e.message)}</div>`; }
}
async function obSave() {
  try {
    $('#obSave').disabled = true;
    const b = obBody();
    const r = await api('/opening', { method: 'POST', body: b });
    const phone = OB.existing ? OB.existing.customer.phone : b.phone;
    const msg = `Assalam o Alaikum ${r.name}, ${S.settings.business_name} mein aap ka Customer Code ${r.code} hai. ${r.paid_installments} qist ada ho chuki hain, ${r.left_installments} qist baqi (Rs ${Math.round(r.balance).toLocaleString('en-PK')}).${r.next_due ? ' Agli qist ' + fd(r.next_due) + ' ko.' : ''} Shukriya.`;
    openSheet(`<div style="text-align:center;padding:6px 0 4px"><div style="font-size:34px">✓</div><h2 style="margin:4px 0 2px">Old customer saved</h2>
      <div class="mut">${esc(r.name)} · ${r.bill_no}${r.created ? '' : ' (added to existing customer)'}</div>
      <div class="bigcode" style="margin-top:12px">${esc(r.code)}</div>
      <div class="sm" style="margin-top:6px"><b>${r.paid_installments}</b> qist paid · <b style="color:var(--red)">${r.left_installments}</b> left · remaining <b>${rs(r.balance)}</b></div></div>
      <div class="btns" style="margin-top:16px"><button class="btn amb grow" onclick="closeSheet();renderOld('one')">+ Add another old customer</button>
      ${phone ? `<a class="btn wa grow" target="_blank" href="${waLink(phone, msg)}">Send on WhatsApp</a>` : ''}
      <button class="btn ghost grow" onclick="go('#/customer/${r.customer_id}')">Open customer</button></div>`);
  } catch (e) { toast(e.message, 1); } finally { const b2 = $('#obSave'); if (b2) b2.disabled = false; }
}

// ---------- recovery ----------
function recList(rows) {
  if (!rows.length) return `<div class="list"><div class="empty"><div class="i">✓</div>No pending installments here</div></div>`;
  return `<div class="list">${rows.map((r) => `
    <div class="item" onclick="go('#/bill/${r.sale_id}')">
      <div class="av">${initials(r.customer_name)}</div>
      <div class="grow">
        <div class="t">${r.customer_code ? `<span class="code">${esc(r.customer_code)}</span>` : ''} ${esc(r.customer_name)} <span class="pill ${r.plan_type === 'yearly' ? 'amb' : 'blue'}">${r.plan_type === 'yearly' ? 'Yearly' : 'Monthly'}</span></div>
        <div class="d">${r.bill_no} · ${r.area ? esc(r.area) + ' · ' : ''}due ${fd(r.oldest_due)}${r.count > 1 ? ` · ${r.count} qist pending` : ''}</div>
      </div>
      <div class="right"><div class="b money" style="color:${r.overdue ? 'var(--red)' : 'inherit'}">${rs(r.due_now)}</div><div class="sm mut money">Bal ${rs(r.balance)}</div></div>
    </div>
    <div class="btns" style="padding:0 14px 12px 66px;border-bottom:1px solid var(--line)">
      <button class="btn sm" onclick="event.stopPropagation();collectSheet(${r.sale_id})">Collect</button>
      ${r.customer_phone ? `<a class="btn sm wa" target="_blank" onclick="event.stopPropagation()" href="${waLink(r.customer_phone, fillTpl(S.settings.wa_template, { name: r.customer_name, amount: Math.round(r.due_now).toLocaleString('en-PK'), bill: r.bill_no, due: fd(r.oldest_due), balance: Math.round(r.balance).toLocaleString('en-PK'), business: S.settings.business_name }))}">WhatsApp reminder</a>
      <a class="btn sm ghost" onclick="event.stopPropagation()" href="tel:${esc(r.customer_phone)}">Call</a>` : ''}
    </div>`).join('')}</div>`;
}
async function renderRecovery(mode) {
  loading('Recovery');
  const rows = await api('/recovery?mode=' + mode);
  const total = rows.reduce((a, r) => a + r.due_now, 0);
  const tabs = [['due', 'This month'], ['overdue', 'Overdue'], ['monthly', 'Monthly plans'], ['yearly', `Yearly (${MONTHS[(+S.settings.yearly_month || 8) - 1]})`], ['all', 'All active']];
  shell('Recovery', `
    <div class="tabs">${tabs.map(([k, l]) => `<button class="${k === mode ? 'on' : ''}" onclick="go('#/recovery/${k}')">${l}</button>`).join('')}</div>
    <div class="search"><input placeholder="Search code, name, bill, area…" oninput="filterItems(this.value)"></div>
    <div class="card row"><div class="grow"><div class="mut sm">${rows.length} bills</div><div class="b money" style="font-size:18px">${rs(total)}</div></div>
      <div class="mut sm right">${mode === 'yearly' ? 'Next yearly qist per bill' : mode === 'all' ? 'Next qist per bill' : 'Due up to month end'}</div></div>
    <div id="rlist">${recList(rows)}</div>`, { sub: S.user.name });
  window._rec = rows;
}
function filterItems(v) {
  v = v.toLowerCase();
  const rows = (window._rec || []).filter((r) => [r.customer_code, r.customer_name, r.bill_no, r.area, r.customer_phone].join(' ').toLowerCase().includes(v));
  $('#rlist').innerHTML = recList(rows);
}

// collect sheet
async function collectSheet(saleId) {
  const s = await api('/sales/' + saleId);
  const next = s.schedule.filter((x) => x.remaining > 0);
  const overdue = next.filter((x) => x.due_date < today()).reduce((a, x) => a + x.remaining, 0);
  const suggested = overdue > 0 ? overdue : (next[0] ? next[0].remaining : 0);
  openSheet(`<h2>Collect qist — ${esc(s.customer_name)}</h2>
    <div class="card" style="background:var(--bg)"><div class="g2 sm">
      <div><div class="mut">Bill</div><b>${s.bill_no}</b> <span class="pill ${s.plan_type === 'yearly' ? 'amb' : 'blue'}">${s.plan_type}</span></div>
      <div><div class="mut">Balance</div><b class="money">${rs(s.balance)}</b></div>
      <div><div class="mut">Next due</div><b>${next[0] ? fd(next[0].due_date) + ' · ' + rs(next[0].remaining) : '—'}</b></div>
      <div><div class="mut">Overdue</div><b class="money" style="color:${overdue ? 'var(--red)' : ''}">${rs(overdue)}</b></div>
    </div></div>
    <label class="f"><span>Amount received</span><input id="cAmt" type="number" inputmode="numeric" value="${Math.round(suggested)}"></label>
    <div class="btns" style="margin:-4px 0 10px">${next[0] ? `<button class="btn sm ghost" onclick="$('#cAmt').value=${Math.round(next[0].remaining)}">1 qist</button>` : ''}
      ${overdue ? `<button class="btn sm ghost" onclick="$('#cAmt').value=${Math.round(overdue)}">All overdue</button>` : ''}
      <button class="btn sm ghost" onclick="$('#cAmt').value=${Math.round(s.balance)}">Full balance</button></div>
    <div class="g2"><label class="f"><span>Date</span><input id="cDate" type="date" value="${today()}"></label>
      <label class="f"><span>Method</span><select id="cMeth"><option>Cash</option><option>JazzCash</option><option>Easypaisa</option><option>Bank Transfer</option><option>Cheque</option></select></label></div>
    <label class="f"><span>Note (optional)</span><input id="cNote" placeholder="e.g. collected at shop"></label>
    <button class="btn full" id="cBtn">Save payment</button>`);
  $('#cBtn').onclick = async () => {
    try {
      $('#cBtn').disabled = true;
      const r = await api('/payments', { method: 'POST', body: { sale_id: saleId, amount: $('#cAmt').value, paid_on: $('#cDate').value, method: $('#cMeth').value, note: $('#cNote').value } });
      const amt = n($('#cAmt').value);
      openSheet(`<h2>✓ Payment saved</h2>
        <div class="card" style="background:var(--gl)"><div class="kv"><b>Receipt</b><span>${r.receipt_no}</span><b>Customer</b><span>${esc(s.customer_name)}</span>
        <b>Amount</b><span class="money">${rs(amt)}</span><b>Balance left</b><span class="money">${rs(r.balance)}</span></div></div>
        <div class="btns">
          ${s.customer_phone ? `<a class="btn wa grow" target="_blank" href="${waLink(s.customer_phone, fillTpl(S.settings.receipt_template, { name: s.customer_name, amount: Math.round(amt).toLocaleString('en-PK'), receipt: r.receipt_no, bill: s.bill_no, balance: Math.round(r.balance).toLocaleString('en-PK'), business: S.settings.business_name }))}">Send receipt on WhatsApp</a>` : ''}
          <button class="btn ghost grow" onclick="printReceipt(${saleId}, ${r.id})">Print receipt</button>
          <button class="btn ghost grow" onclick="closeSheet();render()">Done</button></div>`);
    } catch (e) { toast(e.message, 1); $('#cBtn').disabled = false; }
  };
}

// ---------- new bill ----------
const NB = { items: [], package_id: null, plan: 'monthly' };
async function renderNewBill() {
  loading('New Bill');
  const [customers, products, packages] = await Promise.all([api('/customers'), api('/products'), api('/packages')]);
  S.cache.products = products; S.cache.packages = packages; S.cache.customers = customers;
  const pre = new URLSearchParams(location.hash.split('?')[1] || '');
  Object.assign(NB, { items: [], package_id: null, plan: 'monthly', customer_id: pre.get('c') || '' });
  const cats = [...new Set(products.map((p) => p.category))];
  shell('New Installment Bill', `<div class="cols wide"><div>
    <div class="card"><h3>1 · Customer</h3>
      <div class="row"><select id="nbCust" class="grow"><option value="">— Select customer —</option>${customers.map((c) => `<option value="${c.id}" data-plan="${c.plan_type || 'monthly'}" ${String(c.id) === NB.customer_id ? 'selected' : ''}>${c.code ? esc(c.code) + ' · ' : ''}${esc(c.name)}${c.phone ? ' · ' + esc(c.phone) : ''}${c.balance ? ' (bal ' + rs(c.balance) + ')' : ''}</option>`).join('')}</select>
      <button class="btn ghost" onclick="customerSheet(null, true)">+ New</button></div>
    </div>
    <div class="card"><h3>2 · Items</h3>
      ${packages.length ? `<div class="mut sm" style="margin-bottom:6px">Start from a package (Jahez etc.) — then add or remove items as the customer chooses:</div>
      <div id="pkgs">${packages.map((p) => `<div class="pkg" data-id="${p.id}" onclick="pickPackage(${p.id})"><div class="row"><b class="grow">${esc(p.name)}</b><span class="money b">${rs(p.total)}</span></div><div class="sm mut">${p.items.map((i) => esc(i.name) + (i.qty > 1 ? ' ×' + i.qty : '')).join(', ')}</div></div>`).join('')}</div>` : ''}
      <div class="row" style="margin:10px 0"><select id="nbAdd" class="grow"><option value="">+ Add product…</option>${cats.map((c) => `<optgroup label="${esc(c)}">${products.filter((p) => p.category === c).map((p) => `<option value="${p.id}">${esc(p.name)} — ${rs(p.cash_price)}${p.stock <= 0 ? ' (out of stock)' : ''}</option>`).join('')}</optgroup>`).join('')}</select>
      <button class="btn ghost" onclick="addCustomItem()">Custom</button></div>
      <div class="cart-line mut sm" style="font-weight:600"><span>Item</span><span>Qty</span><span>Cash price</span><span></span></div>
      <div id="cart"></div>
    </div>
    <div class="card"><h3>3 · Price & plan</h3>
      <div class="g3">
        <label class="f"><span>Markup %</span><input id="nbMk" type="number" value="${esc(S.settings.default_markup || 25)}"></label>
        <label class="f"><span>Discount (Rs)</span><input id="nbDisc" type="number" value="0"></label>
        <label class="f"><span>Advance (Rs)</span><input id="nbAdv" type="number" value="0"></label>
      </div>
      <div class="seg" id="nbSeg"><button data-p="monthly" class="on">Every month</button><button data-p="yearly">Once a year (every ${MONTHS[(+S.settings.yearly_month || 8) - 1]})</button></div>
      <div class="g2">
        <label class="f"><span id="nbCntL">No. of monthly installments</span><input id="nbCnt" type="number" value="12" min="1"></label>
        <label class="f"><span>First installment date</span><input id="nbFirst" type="date"></label>
      </div>
      <div class="g2"><label class="f"><span>Bill date</span><input id="nbDate" type="date" value="${today()}"></label>
      <label class="f"><span>Note</span><input id="nbNote" placeholder="optional"></label></div>
    </div>
    </div><div class="sticky">
    <div class="card" id="nbSum"></div>
    <button class="btn full amb" id="nbSave" style="padding:14px;font-size:15px">Create bill</button>
    </div></div>
  `, { back: true });
  $('#nbAdd').onchange = (e) => { const p = products.find((x) => String(x.id) === e.target.value); if (p) { const ex = NB.items.find((i) => i.product_id === p.id); ex ? ex.qty++ : NB.items.push({ product_id: p.id, name: p.name, qty: 1, price: n(p.cash_price) }); } e.target.value = ''; paintCart(); };
  document.querySelectorAll('#nbSeg button').forEach((b) => b.onclick = () => nbApplyPlan(b.dataset.p));
  $('#nbCust').onchange = (e) => { const o = e.target.selectedOptions[0]; if (o && o.dataset.plan) nbApplyPlan(o.dataset.plan); };
  { const o = $('#nbCust').selectedOptions[0]; if (o && o.dataset.plan && o.value) setTimeout(() => nbApplyPlan(o.dataset.plan), 0); }
  ['nbMk', 'nbDisc', 'nbAdv', 'nbCnt', 'nbFirst', 'nbDate'].forEach((id) => $('#' + id).oninput = debounce(preview, 300));
  $('#nbSave').onclick = saveBill;
  paintCart();
}
function nbApplyPlan(p) {
  if (!$('#nbSeg')) return;
  const changed = NB.plan !== p;
  NB.plan = p; document.querySelectorAll('#nbSeg button').forEach((x) => x.classList.toggle('on', x.dataset.p === p));
  $('#nbCntL').textContent = p === 'yearly' ? 'No. of yearly installments' : 'No. of monthly installments';
  if (changed) { $('#nbCnt').value = p === 'yearly' ? 2 : 12; $('#nbFirst').value = ''; }
  preview();
}
function debounce(f, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => f(...a), ms); }; }
function pickPackage(id) {
  const p = S.cache.packages.find((x) => x.id === id);
  NB.package_id = NB.package_id === id ? null : id;
  document.querySelectorAll('.pkg').forEach((el) => el.classList.toggle('on', +el.dataset.id === NB.package_id));
  if (NB.package_id) NB.items = p.items.map((i) => ({ product_id: i.product_id, name: i.name, qty: i.qty, price: n(i.cash_price) }));
  else NB.items = [];
  paintCart();
}
function addCustomItem() { NB.items.push({ product_id: null, name: '', qty: 1, price: 0 }); paintCart(); }
function paintCart() {
  $('#cart').innerHTML = NB.items.length ? NB.items.map((i, k) => `<div class="cart-line">
    <input value="${esc(i.name)}" placeholder="Item name" oninput="NB.items[${k}].name=this.value;dPreview()">
    <input type="number" value="${i.qty}" min="1" oninput="NB.items[${k}].qty=+this.value;dPreview()">
    <input type="number" value="${i.price}" oninput="NB.items[${k}].price=+this.value;dPreview()">
    <button class="x" onclick="NB.items.splice(${k},1);paintCart()">×</button></div>`).join('') : '<div class="mut sm" style="padding:8px 0">No items yet — pick a package or add products.</div>';
  preview();
}
const dPreview = debounce(() => preview(), 300);
function billBody() {
  return { customer_id: $('#nbCust').value, items: NB.items, package_id: NB.package_id, markup_pct: $('#nbMk').value, discount: $('#nbDisc').value,
    advance: $('#nbAdv').value, plan_type: NB.plan, installments_count: $('#nbCnt').value, first_due_date: $('#nbFirst').value || null, sale_date: $('#nbDate').value, notes: $('#nbNote').value };
}
async function preview() {
  const box = $('#nbSum'); if (!box) return;
  if (!NB.items.length) { box.innerHTML = '<div class="mut sm">Bill summary will appear here.</div>'; return; }
  try {
    const p = await api('/sales/preview', { method: 'POST', body: billBody() });
    if (!$('#nbFirst').value) $('#nbFirst').placeholder = p.first_due_date;
    box.innerHTML = `<h3>Bill summary</h3>
      <div class="sumline"><span>Items (cash price)</span><span class="money">${rs(p.items_total)}</span></div>
      <div class="sumline"><span>Markup ${p.markup_pct}%</span><span class="money">+ ${rs(p.markup_amt)}</span></div>
      ${p.discount ? `<div class="sumline"><span>Discount</span><span class="money">− ${rs(p.discount)}</span></div>` : ''}
      <div class="sumline big"><span>Installment price</span><span class="money">${rs(p.total)}</span></div>
      <div class="sumline"><span>Advance now</span><span class="money">${rs(p.advance)}</span></div>
      <div class="sumline b"><span>Remaining in ${p.installments_count} ${p.plan_type === 'yearly' ? 'yearly' : 'monthly'} qist</span><span class="money">${rs(p.total - p.advance)}</span></div>
      <div class="sumline" style="background:var(--ambl);border-radius:10px;padding:10px;margin-top:8px"><span><b>${rs(p.installment_amt)}</b> ${p.plan_type === 'yearly' ? 'every year' : 'per month'}</span><span class="sm">from ${fd(p.first_due_date)}</span></div>
      <details style="margin-top:8px"><summary class="sm mut" style="cursor:pointer">View full schedule</summary>
      <table style="margin-top:6px"><tr><th>#</th><th>Due date</th><th class="right">Amount</th></tr>${p.schedule.map((x) => `<tr><td>${x.seq}</td><td>${fd(x.due_date)}</td><td class="right money">${rs(x.amount)}</td></tr>`).join('')}</table></details>`;
  } catch (e) { box.innerHTML = `<div class="sm" style="color:var(--red)">${esc(e.message)}</div>`; }
}
async function saveBill() {
  try {
    $('#nbSave').disabled = true;
    const r = await api('/sales', { method: 'POST', body: billBody() });
    toast('Bill ' + r.bill_no + ' created'); go('#/bill/' + r.id);
  } catch (e) { toast(e.message, 1); $('#nbSave').disabled = false; }
}

// ---------- customers ----------
async function renderCustomers() {
  loading('Customers');
  const cs = await api('/customers');
  window._cs = cs;
  shell('Customers', `
    <div class="btns" style="margin-bottom:12px"><button class="btn ghost" onclick="go('#/old/one')">⟲ Add old customer</button></div>
    <div class="search"><input placeholder="Search code, name, phone, CNIC, area…" oninput="filterCust(this.value)"></div>
    <div class="card row sm"><div class="grow"><span class="mut">${cs.length} customers</span></div><div class="right"><span class="mut">Total baqaya</span> <b class="money">${rs(cs.reduce((a, c) => a + c.balance, 0))}</b></div></div>
    <div id="clist">${custList(cs)}</div>`, { action: `<button class="act" onclick="customerSheet()">+ Customer</button>` });
}
function custList(cs) {
  if (!cs.length) return `<div class="list"><div class="empty"><div class="i">☺</div>No customers yet</div></div>`;
  return `<div class="list">${cs.map((c) => `<div class="item" onclick="go('#/customer/${c.id}')">
    <div class="av">${initials(c.name)}</div>
    <div class="grow"><div class="t">${c.code ? `<span class="code">${esc(c.code)}</span>` : ''} ${esc(c.name)} ${c.overdue > 0 ? '<span class="pill red">Late</span>' : c.balance <= 0 && c.bills ? '<span class="pill">Clear</span>' : ''}</div>
    <div class="d">${c.plan_type === 'yearly' ? '<b style="color:#8a5d00">Yearly</b> · ' : ''}${esc(c.phone || 'No phone')}${c.area ? ' · ' + esc(c.area) : ''} · ${c.bills} bill${c.bills === 1 ? '' : 's'}</div></div>
    <div class="right"><div class="b money">${rs(c.balance)}</div>${c.overdue > 0 ? `<div class="sm money" style="color:var(--red)">late ${rs(c.overdue)}</div>` : ''}</div></div>`).join('')}</div>`;
}
function filterCust(v) { v = v.toLowerCase(); $('#clist').innerHTML = custList(window._cs.filter((c) => [c.code, c.name, c.phone, c.cnic, c.area, c.father_name].join(' ').toLowerCase().includes(v))); }
async function customerSheet(c, fromBill) {
  c = c || {};
  const isNew = !c.id;
  let suggested = '';
  if (isNew) { try { suggested = (await api('/customers/next-code')).code; } catch (e) { /* server will assign */ } }
  const f = (k, l, t = 'text', ph = '') => `<label class="f"><span>${l}</span><input id="cf_${k}" type="${t}" value="${esc(c[k] || '')}" placeholder="${ph}"></label>`;
  openSheet(`<h2>${isNew ? 'New' : 'Edit'} customer</h2>
    <div class="codebox"><div class="grow"><div class="mut sm b">Customer code ${isNew ? '(assigned automatically)' : ''}</div>
      <input id="cf_code" value="${esc(isNew ? suggested : c.code || '')}" autocomplete="off"></div>
      <div class="sm mut" style="max-width:170px">${isNew ? 'You can keep this code or type the shop’s own code.' : 'Change only if needed.'}</div></div>
    ${f('name', 'Full name *')}
    <div class="mut sm b" style="margin:2px 0 6px">How will this customer pay installments?</div>
    <div class="seg" id="cfPlan"><button data-p="monthly" class="${c.plan_type === 'yearly' ? '' : 'on'}">Every month</button><button data-p="yearly" class="${c.plan_type === 'yearly' ? 'on' : ''}">Once a year — every ${MONTHS[(+S.settings.yearly_month || 8) - 1]}</button></div>
    <div class="sm mut" id="cfPlanNote" style="margin:-4px 0 12px"></div>
    <div class="g2">${f('father_name', 'Father / Husband name')}${f('phone', 'Mobile (WhatsApp)', 'tel', '03xx-xxxxxxx')}</div>
    <div class="g2">${f('cnic', 'CNIC', 'text', 'xxxxx-xxxxxxx-x')}${f('area', 'Area / Mohalla')}</div>
    ${f('address', 'Full address')}
    <div class="mut sm b" style="margin:6px 0 8px">Guarantor (Zamin)</div>
    <div class="g2">${f('guarantor_name', 'Guarantor name')}${f('guarantor_phone', 'Guarantor phone', 'tel')}</div>
    ${f('guarantor_cnic', 'Guarantor CNIC')}
    ${f('notes', 'Notes (job, reference…)')}
    <button class="btn full" id="cfSave">Save customer</button>`);
  let plan = c.plan_type === 'yearly' ? 'yearly' : 'monthly';
  const planNote = () => {
    const y = new Date().getFullYear(), mi = (+S.settings.yearly_month || 8) - 1, d = +S.settings.yearly_day || 10;
    const firstY = new Date() < new Date(y, mi, d) ? y : y + 1;
    $('#cfPlanNote').innerHTML = plan === 'yearly' ? `Pays one big qist every year: ${d} ${MONTHS[mi]} ${firstY}, then ${d} ${MONTHS[mi]} ${firstY + 1}, ${d} ${MONTHS[mi]} ${firstY + 2}…` : 'Pays a qist every month.';
  };
  document.querySelectorAll('#cfPlan button').forEach((b) => b.onclick = () => { plan = b.dataset.p; document.querySelectorAll('#cfPlan button').forEach((x) => x.classList.toggle('on', x === b)); planNote(); });
  planNote();
  $('#cfSave').onclick = async () => {
    const body = { id: c.id, plan_type: plan };
    ['name', 'code', 'father_name', 'phone', 'cnic', 'area', 'address', 'guarantor_name', 'guarantor_phone', 'guarantor_cnic', 'notes'].forEach((k) => body[k] = $('#cf_' + k).value.trim());
    try {
      $('#cfSave').disabled = true;
      const r = await api('/customers', { method: 'POST', body });
      if (!isNew) { closeSheet(); toast('Customer saved'); return render(); }
      if (fromBill) {
        closeSheet(); toast(`Customer added — code ${r.code}`);
        const sel = $('#nbCust'); sel.insertAdjacentHTML('beforeend', `<option value="${r.id}" data-plan="${plan}">${esc(r.code)} · ${esc(body.name)}</option>`); sel.value = r.id; nbApplyPlan(plan); return;
      }
      const msg = `Assalam o Alaikum ${body.name}, ${S.settings.business_name} mein aap ka Customer Code ${r.code} hai. Qist ki maloomat ke liye yeh code batayein. Shukriya.`;
      openSheet(`<div style="text-align:center;padding:6px 0 4px">
        <div style="font-size:34px">✓</div><h2 style="margin:4px 0 2px">Customer added</h2><div class="mut">${esc(body.name)}${body.phone ? ' · ' + esc(body.phone) : ''}</div>
        <div class="mut sm" style="margin-top:16px">Customer code</div>
        <div class="bigcode">${esc(r.code)}</div>
        <div class="mut sm">Write this on the customer’s card / bill book</div>
        <div style="margin-top:10px"><span class="pill ${plan === 'yearly' ? 'amb' : 'blue'}">${plan === 'yearly' ? 'Pays yearly — every ' + MONTHS[(+S.settings.yearly_month || 8) - 1] : 'Pays monthly'}</span></div></div>
        <div class="btns" style="margin-top:16px">
          <button class="btn amb grow" onclick="go('#/new?c=${r.id}')">+ Make bill for this customer</button>
          ${body.phone ? `<a class="btn wa grow" target="_blank" href="${waLink(body.phone, msg)}">Send code on WhatsApp</a>` : ''}
          <button class="btn ghost grow" onclick="go('#/customer/${r.id}')">Open customer</button>
        </div>`);
    } catch (e) { toast(e.message, 1); const b2 = $('#cfSave'); if (b2) b2.disabled = false; }
  };
}
async function renderCustomer(id) {
  loading('Customer');
  const d = await api('/customers/' + id);
  const c = d.customer;
  window._cust = d;
  const active = d.sales.filter((s) => s.balance > 0);
  shell(c.name, `<div class="cols"><div>
    <div class="card">
      <div class="row" style="margin-bottom:10px"><div class="av" style="width:52px;height:52px;font-size:18px">${initials(c.name)}</div>
      <div class="grow"><div class="b" style="font-size:17px">${esc(c.name)} ${c.code ? `<span class="code">${esc(c.code)}</span>` : ''}</div><div class="mut sm">${c.father_name ? 'Father/Husband: ' + esc(c.father_name) : ''}</div>
      <span class="pill ${c.plan_type === 'yearly' ? 'amb' : 'blue'}" style="margin-top:4px">${c.plan_type === 'yearly' ? 'Pays yearly — every ' + MONTHS[(+S.settings.yearly_month || 8) - 1] : 'Pays monthly'}</span></div>
      <div class="right"><div class="mut sm">Balance</div><div class="b money" style="font-size:19px;color:${d.balance > 0 ? 'var(--red)' : 'var(--g)'}">${rs(d.balance)}</div></div></div>
      <div class="kv">${c.phone ? `<b>Phone</b><span><a href="tel:${esc(c.phone)}">${esc(c.phone)}</a></span>` : ''}${c.cnic ? `<b>CNIC</b><span>${esc(c.cnic)}</span>` : ''}
      ${c.address || c.area ? `<b>Address</b><span>${esc([c.address, c.area].filter(Boolean).join(', '))}</span>` : ''}
      ${c.guarantor_name ? `<b>Guarantor</b><span>${esc(c.guarantor_name)} ${c.guarantor_phone ? '· <a href="tel:' + esc(c.guarantor_phone) + '">' + esc(c.guarantor_phone) + '</a>' : ''} ${c.guarantor_cnic ? '· ' + esc(c.guarantor_cnic) : ''}</span>` : ''}
      ${c.notes ? `<b>Notes</b><span>${esc(c.notes)}</span>` : ''}</div>
      <div class="btns" style="margin-top:12px">
        <button class="btn sm" onclick="go('#/new?c=${c.id}')">+ New bill</button>
        <button class="btn sm ghost" onclick="go('#/old/one?code=${encodeURIComponent(c.code || '')}')">+ Old bill</button>
        <button class="btn sm ghost" onclick='customerSheet(window._cust.customer)'>Edit</button>
        <button class="btn sm ghost" onclick="printStatement()">Print khata</button>
        ${c.phone ? `<a class="btn sm wa" target="_blank" href="${waLink(c.phone, `Assalam o Alaikum ${c.name}, ${S.settings.business_name} mein aap ka total baqaya Rs ${Math.round(d.balance).toLocaleString('en-PK')} hai. Shukriya.`)}">WhatsApp balance</a>` : ''}
        ${isOwner() && !d.sales.length ? `<button class="btn sm red" onclick="delCustomer(${c.id})">Delete</button>` : ''}
      </div>
    </div>
    <h3 style="margin:14px 2px 8px;font-size:15px">Bills (${d.sales.length})</h3>
    ${d.sales.length ? `<div class="list">${d.sales.map((s) => billRow(s)).join('')}</div>` : '<div class="list"><div class="empty">No bills yet</div></div>'}
    </div><div>
    <h3 class="first" style="margin:14px 2px 8px;font-size:15px">Khata (ledger)</h3>
    ${ledgerRows(d.ledger.map((e) => ({ date: e.date, desc: e.desc, ref: e.ref, plus: e.debit, minus: e.credit, balance: e.balance })), 'Bill', 'Paid')}</div></div>`, { back: true, sub: active.length ? `${active.length} active bill(s)` : 'No active bills' });
}
async function delCustomer(id) { if (!confirm('Delete this customer?')) return; try { await api('/customers/' + id, { method: 'DELETE' }); go('#/customers'); } catch (e) { toast(e.message, 1); } }
function billRow(s) {
  const pct = s.total ? Math.min(100, Math.round(((s.total_paid ?? s.paid) / s.total) * 100)) : 0;
  const next = s.schedule ? s.schedule.find((x) => x.remaining > 0) : null;
  const bal = s.balance;
  return `<div class="item" onclick="go('#/bill/${s.id}')"><div class="grow">
    <div class="t">${s.bill_no} <span class="pill ${s.plan_type === 'yearly' ? 'amb' : 'blue'}">${s.plan_type === 'yearly' ? 'Yearly' : 'Monthly'}</span> ${bal <= 0 ? '<span class="pill">Completed</span>' : ''}</div>
    <div class="d">${s.package_name ? esc(s.package_name) + ' · ' : ''}${s.items ? s.items.map((i) => esc(i.name)).join(', ') : ''}</div>
    <div class="d">${fd(s.sale_date)}${next ? ' · next ' + fd(next.due_date) : ''}</div>
    <div class="progress"><i style="width:${pct}%"></i></div></div>
    <div class="right"><div class="b money">${rs(bal)}</div><div class="sm mut money">of ${rs(s.total)}</div></div></div>`;
}

function ledgerRows(rows, plusL, minusL) {
  if (!rows.length) return '<div class="list"><div class="empty">No entries</div></div>';
  return `<div class="list">${rows.map((e) => {
    const isPlus = e.plus > 0;
    const color = e.cash ? (isPlus ? 'var(--g2)' : 'var(--red)') : (isPlus ? 'var(--ink)' : 'var(--g2)');
    return `<div class="item" style="cursor:default"><div class="grow"><div class="t sm" style="font-size:14px">${esc(e.desc)}</div>
      <div class="d">${fd(e.date)}${e.ref ? ' · ' + esc(e.ref) : ''}</div></div>
      <div class="right"><div class="b money" style="color:${color}">${isPlus ? (e.cash ? '+ ' : '') : '− '}${rs(isPlus ? e.plus : e.minus)}</div>
      <div class="sm mut money">Bal ${rs(e.balance)}</div></div></div>`;
  }).join('')}</div>`;
}

// ---------- bills ----------
async function renderBills() {
  loading('All bills');
  const bills = await api('/sales');
  window._bills = bills;
  shell('All bills', `<div class="search"><input placeholder="Search bill no, customer…" oninput="filterBills(this.value)"></div><div id="blist">${billsList(bills)}</div>`, { back: true });
}
function billsList(b) {
  if (!b.length) return '<div class="list"><div class="empty">No bills</div></div>';
  return `<div class="list">${b.map((s) => `<div class="item" onclick="go('#/bill/${s.id}')"><div class="av">${initials(s.customer_name)}</div>
    <div class="grow"><div class="t">${esc(s.customer_name)} <span class="pill ${s.plan_type === 'yearly' ? 'amb' : 'blue'}">${s.plan_type}</span> ${s.balance <= 0 ? '<span class="pill">Done</span>' : s.overdue > 0 ? '<span class="pill red">Late</span>' : ''}</div>
    <div class="d">${s.bill_no} · ${fd(s.sale_date)}${s.next_due ? ' · next ' + fd(s.next_due) : ''}</div></div>
    <div class="right"><div class="b money">${rs(s.balance)}</div><div class="sm mut money">of ${rs(s.total)}</div></div></div>`).join('')}</div>`;
}
function filterBills(v) { v = v.toLowerCase(); $('#blist').innerHTML = billsList(window._bills.filter((s) => [s.bill_no, s.customer_name, s.customer_phone].join(' ').toLowerCase().includes(v))); }

const ST = { paid: ['Paid', ''], partial: ['Partly paid', 'amb'], 'partial-overdue': ['Partly paid · late', 'red'], overdue: ['Late', 'red'], due: ['Due this month', 'blue'], upcoming: ['Upcoming', 'grey'] };
async function renderBill(id) {
  loading('Bill');
  const s = await api('/sales/' + id);
  window._bill = s;
  const pct = s.total ? Math.round((s.total_paid / s.total) * 100) : 0;
  const overdue = s.schedule.filter((x) => x.due_date < today()).reduce((a, x) => a + x.remaining, 0);
  shell('Bill ' + s.bill_no, `<div class="cols"><div>
    <div class="card">
      <div class="row"><div class="grow"><a href="#/customer/${s.customer_id}" class="b" style="font-size:17px;text-decoration:none">${esc(s.customer_name)}</a> ${s.customer_code ? `<span class="code">${esc(s.customer_code)}</span>` : ''}
        <div class="mut sm">${esc(s.customer_phone || '')} · ${fd(s.sale_date)}</div></div>
        ${s.is_opening ? `<span class="pill grey" title="Added from old register">Old record${s.old_ref ? ' · ' + esc(s.old_ref) : ''}</span> ` : ''}<span class="pill ${s.plan_type === 'yearly' ? 'amb' : 'blue'}">${s.plan_type === 'yearly' ? 'Yearly — every ' + MONTHS[+s.first_due_date.slice(5, 7) - 1] : 'Monthly'}</span></div>
      <div class="g3" style="margin-top:12px">
        <div><div class="mut sm">Total</div><div class="b money">${rs(s.total)}</div></div>
        <div><div class="mut sm">Received</div><div class="b money" style="color:var(--g2)">${rs(s.total_paid)}</div></div>
        <div><div class="mut sm">Balance</div><div class="b money" style="color:${s.balance > 0 ? 'var(--red)' : 'var(--g)'}">${rs(s.balance)}</div></div>
      </div>
      <div class="progress"><i style="width:${pct}%"></i></div>
      <div class="mut sm" style="margin-top:4px">${pct}% paid${overdue ? ` · <b style="color:var(--red)">${rs(overdue)} overdue</b>` : ''}</div>
      <div class="btns" style="margin-top:12px">
        ${s.balance > 0 ? `<button class="btn" onclick="collectSheet(${s.id})">Collect qist</button>` : '<span class="pill" style="padding:8px 12px">✓ Fully paid</span>'}
        <button class="btn ghost" onclick="printBill()">Print bill</button>
        ${s.customer_phone && s.balance > 0 ? `<a class="btn wa" target="_blank" href="${waLink(s.customer_phone, billWaText(s))}">WhatsApp</a>` : ''}
      </div>
    </div>
    <div class="card"><h3>Items ${s.package_name ? `<span class="pill amb">${esc(s.package_name)}</span>` : ''}</h3>
      <table><tr><th>Item</th><th class="right">Qty</th><th class="right">Price</th><th class="right">Amount</th></tr>
      ${s.items.map((i) => `<tr><td>${esc(i.name)}</td><td class="right">${i.qty}</td><td class="right money">${rs(i.price)}</td><td class="right money">${rs(i.qty * i.price)}</td></tr>`).join('')}</table>
      <div style="margin-top:8px">
        <div class="sumline"><span>Cash price</span><span class="money">${rs(s.items_total)}</span></div>
        <div class="sumline"><span>Markup ${n(s.markup_pct)}%</span><span class="money">+ ${rs(s.markup_amt)}</span></div>
        ${n(s.discount) ? `<div class="sumline"><span>Discount</span><span class="money">− ${rs(s.discount)}</span></div>` : ''}
        <div class="sumline big"><span>Installment price</span><span class="money">${rs(s.total)}</span></div>
        <div class="sumline"><span>Advance</span><span class="money">${rs(s.advance)}</span></div>
        <div class="sumline"><span>${s.installments_count} × ${s.plan_type === 'yearly' ? 'yearly' : 'monthly'} qist</span><span class="money">${rs(s.installment_amt)}</span></div>
      </div>${s.notes ? `<div class="sm mut" style="margin-top:6px">Note: ${esc(s.notes)}</div>` : ''}
    </div>
    </div><div>
    <div class="card tbl-wrap"><h3>Installment schedule</h3>
      <table><tr><th>#</th><th>Due</th><th class="right">Qist</th><th class="right">Paid</th><th>Status</th></tr>
      ${s.schedule.map((x) => `<tr><td>${x.seq}</td><td style="white-space:nowrap">${fd(x.due_date)}</td><td class="right money">${rs(x.amount)}</td><td class="right money">${x.paid ? rs(x.paid) : '—'}</td><td><span class="pill ${ST[x.status][1]}">${ST[x.status][0]}</span></td></tr>`).join('')}</table></div>
    <div class="card tbl-wrap"><h3>Payments received</h3>
      ${s.payments.length ? `<table><tr><th>Date</th><th>Receipt</th><th class="right">Amount</th><th>By</th>${isOwner() ? '<th></th>' : ''}</tr>
      ${s.payments.map((p) => `<tr><td style="white-space:nowrap">${fd(p.paid_on)}</td><td class="sm">${p.receipt_no || ''} <span class="mut">${p.kind === 'advance' ? 'Advance' : ''} ${esc(p.method)}</span></td><td class="right money b">${rs(p.amount)}</td><td class="sm mut">${esc(p.received_by_name || '')}</td>
        ${isOwner() ? `<td class="right"><button class="btn sm ghost" onclick="printReceipt(${s.id},${p.id})">🖶</button> <button class="btn sm red" onclick="delPayment(${p.id})">×</button></td>` : ''}</tr>`).join('')}</table>` : '<div class="mut sm">No payments yet</div>'}
    </div>
    ${isOwner() ? `<button class="btn red full" onclick="delBill(${s.id})">Delete this bill</button>` : ''}
    </div></div>
  `, { back: true, sub: s.customer_name });
}
function billWaText(s) {
  const next = s.schedule.find((x) => x.remaining > 0);
  const od = s.schedule.filter((x) => x.due_date < today()).reduce((a, x) => a + x.remaining, 0);
  return fillTpl(S.settings.wa_template, { name: s.customer_name, amount: Math.round(od || (next ? next.remaining : 0)).toLocaleString('en-PK'), bill: s.bill_no, due: next ? fd(next.due_date) : '', balance: Math.round(s.balance).toLocaleString('en-PK'), business: S.settings.business_name });
}
async function delPayment(id) { if (!confirm('Delete this payment entry?')) return; try { await api('/payments/' + id, { method: 'DELETE' }); toast('Payment deleted'); render(); } catch (e) { toast(e.message, 1); } }
async function delBill(id) { if (!confirm('Delete this bill and all its payments? Stock will be returned.')) return; try { await api('/sales/' + id, { method: 'DELETE' }); toast('Bill deleted'); history.back(); } catch (e) { toast(e.message, 1); } }

// ---------- printing ----------
function prHead(title) {
  return `<div class="pr-head"><div><h1>${esc(S.settings.business_name)}</h1><div>${esc(S.settings.business_address || '')}</div><div>${esc(S.settings.business_phone || '')}</div></div><div style="text-align:right"><b style="font-size:16px">${title}</b><div>Printed ${fd(today())}</div></div></div>`;
}
function doPrint(html) { $('#print').innerHTML = html; setTimeout(() => window.print(), 50); }
function printBill() {
  const s = window._bill;
  doPrint(`${prHead('Installment Bill ' + s.bill_no)}
    <table style="margin-bottom:10px"><tr><td><b>Customer:</b> ${esc(s.customer_name)} [${esc(s.customer_code || '')}] ${s.father_name ? '(' + esc(s.father_name) + ')' : ''}</td><td><b>Date:</b> ${fd(s.sale_date)}</td></tr>
    <tr><td><b>Phone:</b> ${esc(s.customer_phone || '')} &nbsp; <b>CNIC:</b> ${esc(s.cnic || '')}</td><td><b>Plan:</b> ${s.plan_type === 'yearly' ? 'Yearly' : 'Monthly'} × ${s.installments_count}</td></tr>
    <tr><td colspan="2"><b>Address:</b> ${esc(s.address || '')} &nbsp; <b>Guarantor:</b> ${esc(s.guarantor_name || '')} ${esc(s.guarantor_phone || '')}</td></tr></table>
    <table><tr><th>Item</th><th>Qty</th><th>Price</th><th>Amount</th></tr>${s.items.map((i) => `<tr><td>${esc(i.name)}</td><td>${i.qty}</td><td>${rs(i.price)}</td><td>${rs(i.qty * i.price)}</td></tr>`).join('')}
    <tr><td colspan="3" align="right">Cash price</td><td>${rs(s.items_total)}</td></tr><tr><td colspan="3" align="right">Markup ${n(s.markup_pct)}%</td><td>${rs(s.markup_amt)}</td></tr>
    ${n(s.discount) ? `<tr><td colspan="3" align="right">Discount</td><td>-${rs(s.discount)}</td></tr>` : ''}
    <tr><td colspan="3" align="right"><b>Total installment price</b></td><td><b>${rs(s.total)}</b></td></tr><tr><td colspan="3" align="right">Advance received</td><td>${rs(s.advance)}</td></tr></table>
    <h3>Installment schedule</h3><table><tr><th>#</th><th>Due date</th><th>Amount</th><th>Paid</th><th>Signature</th></tr>${s.schedule.map((x) => `<tr><td>${x.seq}</td><td>${fd(x.due_date)}</td><td>${rs(x.amount)}</td><td>${x.paid ? rs(x.paid) : ''}</td><td></td></tr>`).join('')}</table>
    <div style="display:flex;justify-content:space-between;margin-top:50px"><span>Customer signature ____________</span><span>Guarantor signature ____________</span><span>For ${esc(S.settings.business_name)} ____________</span></div>`);
}
function printReceipt(saleId, payId) {
  const go2 = (s) => {
    const p = s.payments.find((x) => x.id === payId);
    const paidUpto = s.payments.filter((x) => x.id <= payId).reduce((a, x) => a + n(x.amount), 0);
    doPrint(`<div style="max-width:380px">${prHead('Receipt ' + (p.receipt_no || ''))}
      <table><tr><td>Customer</td><td><b>${esc(s.customer_name)}</b></td></tr><tr><td>Bill</td><td>${s.bill_no}</td></tr><tr><td>Date</td><td>${fd(p.paid_on)}</td></tr>
      <tr><td>Amount received</td><td><b>${rs(p.amount)}</b> (${esc(p.method)})</td></tr><tr><td>Total paid to date</td><td>${rs(paidUpto)}</td></tr><tr><td>Balance</td><td><b>${rs(s.total - paidUpto)}</b></td></tr>
      <tr><td>Received by</td><td>${esc(p.received_by_name || '')}</td></tr></table><p style="margin-top:30px">Signature ____________</p></div>`);
  };
  api('/sales/' + saleId).then(go2);
}
function printStatement() {
  const d = window._cust; const c = d.customer;
  doPrint(`${prHead('Customer Khata')}<p><b>${esc(c.name)}</b> [${esc(c.code || '')}] ${c.father_name ? '(' + esc(c.father_name) + ')' : ''} · ${esc(c.phone || '')} · ${esc(c.cnic || '')}<br>${esc([c.address, c.area].filter(Boolean).join(', '))}</p>
    <table><tr><th>Date</th><th>Detail</th><th>Debit</th><th>Credit</th><th>Balance</th></tr>${d.ledger.map((e) => `<tr><td>${fd(e.date)}</td><td>${esc(e.desc)}</td><td>${e.debit ? rs(e.debit) : ''}</td><td>${e.credit ? rs(e.credit) : ''}</td><td>${rs(e.balance)}</td></tr>`).join('')}
    <tr><td colspan="4" align="right"><b>Balance due</b></td><td><b>${rs(d.balance)}</b></td></tr></table>`);
}

// ---------- more ----------
function renderMore() {
  const it = (h, i, t, d) => `<div class="item" onclick="go('${h}')"><div class="av">${i}</div><div class="grow"><div class="t">${t}</div><div class="d">${d}</div></div><span class="mut">›</span></div>`;
  shell('More', `
    <div class="list">
      ${it('#/bills', '▤', 'All bills', 'Every installment bill with balance')}
      ${it('#/old', '⟲', 'Add old customers', 'Customers who bought before the app: old code, goods, qist paid')}
      ${isOwner() ? it('#/inventory', '▦', 'Inventory khata', 'Stock in / out, stock value, every product’s ledger') : ''}
      ${isOwner() ? it('#/purchase', '⇩', 'Stock in (purchase)', 'Record goods bought from a supplier') : ''}
      ${isOwner() ? it('#/suppliers', '⚑', 'Suppliers khata', 'What you owe each dealer / wholesaler') : ''}
      ${isOwner() ? it('#/packages', '♦', 'Packages (Jahez etc.)', 'Ready bundles customers can customise') : ''}
      ${isOwner() ? it('#/khata', '₨', 'Business khata', 'Cashbook, expenses, investment') : ''}
      ${isOwner() ? it('#/report', '▥', 'Monthly report', 'Sales, collections, expenses, profit') : ''}
      ${isOwner() ? it('#/staff', '☻', 'Staff & PINs', 'Owner and recovery staff logins') : ''}
      ${isOwner() ? it('#/settings', '⚙', 'Settings', 'Business info, yearly month, WhatsApp text') : ''}
    </div>
    <div class="card row"><div class="grow"><b>${esc(S.user.name)}</b><div class="mut sm">${S.user.role === 'owner' ? 'Owner' : 'Recovery staff'}</div></div><button class="btn ghost" onclick="logout()">Log out</button></div>
    <div class="mut sm" style="text-align:center">QistBook by PokitBio</div>`);
}

// ---------- inventory khata ----------
const KIND = { opening: ['Opening stock', 'grey'], purchase: ['Stock in', ''], sale: ['Sold', 'blue'], 'adjust-in': ['Adjust +', 'amb'], 'adjust-out': ['Adjust −', 'red'] };
async function renderInventory() {
  loading('Inventory khata');
  const inv = await api('/inventory');
  window._ps = inv.items; window._inv = inv;
  shell('Inventory khata', `
    <div class="stats">
      <div class="stat hero"><div class="l">Stock value (at cost)</div><div class="v money">${rs(inv.value_cost)}</div><div class="s">${inv.units} units in shop · sale value ${rs(inv.value_cash)}</div></div>
      <div class="stat"><div class="l">Products</div><div class="v">${inv.items.length}</div></div>
      <div class="stat amb"><div class="l">Low / out of stock</div><div class="v">${inv.low}</div></div>
    </div>
    <div class="btns" style="margin-bottom:12px"><button class="btn" onclick="go('#/purchase')">⇩ Stock in (purchase)</button><button class="btn ghost" onclick="productSheet()">+ New product</button><button class="btn ghost" onclick="go('#/suppliers')">Suppliers</button></div>
    <div class="search"><input placeholder="Search product, category…" oninput="filterInv(this.value)"></div>
    <div id="invList">${invList(inv.items)}</div>`, { back: true });
}
function invList(items) {
  if (!items.length) return '<div class="list"><div class="empty">No products — add your first item</div></div>';
  const cats = [...new Set(items.map((p) => p.category))];
  return cats.map((c) => `<h3 style="margin:10px 2px 8px;font-size:14px" class="mut">${esc(c)}</h3><div class="list">${items.filter((p) => p.category === c).map((p) => `
    <div class="item" onclick="go('#/stock/${p.id}')"><div class="grow"><div class="t">${esc(p.name)}</div>
      <div class="d">Cost ${rs(p.cost_price)} · Cash ${rs(p.cash_price)}${p.sold_month ? ` · sold ${p.sold_month} this month` : ''}${p.in_month ? ` · in ${p.in_month}` : ''}</div></div>
      <div class="right"><span class="pill ${p.stock <= 0 ? 'red' : p.stock <= 2 ? 'amb' : ''}">${p.stock} in stock</span><div class="sm mut money" style="margin-top:3px">${rs(Math.max(0, p.value_cost))}</div></div></div>`).join('')}</div>`).join('');
}
function filterInv(v) { v = v.toLowerCase(); $('#invList').innerHTML = invList(window._inv.items.filter((p) => (p.name + ' ' + p.category).toLowerCase().includes(v))); }

async function renderStock(id) {
  loading('Stock ledger');
  const d = await api(`/products/${id}/moves`);
  const p = d.product; window._prod = p;
  shell(p.name, `
    <div class="stats">
      <div class="stat hero"><div class="l">In stock now</div><div class="v">${p.stock} units</div><div class="s">Value at cost ${rs(Math.max(0, p.stock) * n(p.cost_price))} · cash price ${rs(p.cash_price)}</div></div>
      <div class="stat"><div class="l">Total in</div><div class="v" style="color:var(--g2)">${d.total_in}</div></div>
      <div class="stat red"><div class="l">Total out</div><div class="v">${d.total_out}</div></div>
    </div>
    <div class="btns" style="margin-bottom:12px"><button class="btn" onclick="go('#/purchase?p=${p.id}')">⇩ Stock in</button><button class="btn ghost" onclick="adjustSheet(${p.id})">± Adjust stock</button><button class="btn ghost" onclick="productSheet(window._prod)">Edit</button></div>
    <h3 style="margin:4px 2px 8px;font-size:15px">Stock ledger (newest first)</h3>
    ${d.moves.length ? `<div class="list">${d.moves.slice().reverse().map((m) => `<div class="item" style="cursor:${m.ref_type ? 'pointer' : 'default'}" ${m.ref_type === 'sale' ? `onclick="go('#/bill/${m.ref_id}')"` : ''}>
      <div class="grow"><div class="t sm" style="font-size:14px"><span class="pill ${KIND[m.kind] ? KIND[m.kind][1] : 'grey'}">${KIND[m.kind] ? KIND[m.kind][0] : esc(m.kind)}</span> ${esc(m.customer_name || m.supplier_name || m.note || '')}</div>
      <div class="d">${fd(m.move_date)}${m.ref_no ? ' · ' + esc(m.ref_no) : ''}${n(m.unit_cost) && m.qty > 0 ? ' · @ ' + rs(m.unit_cost) : ''}${m.by_name ? ' · ' + esc(m.by_name) : ''}</div></div>
      <div class="right"><div class="b" style="color:${m.qty > 0 ? 'var(--g2)' : 'var(--red)'}">${m.qty > 0 ? '+' : '−'}${Math.abs(m.qty)}</div><div class="sm mut">Bal ${m.balance}</div></div></div>`).join('')}</div>` : '<div class="list"><div class="empty">No stock movement yet</div></div>'}`, { back: true, sub: p.category });
}
function adjustSheet(pid) {
  openSheet(`<h2>Adjust stock</h2><p class="mut sm" style="margin-top:0">For damaged items, returns or count corrections. Enter a plus number to add, minus to remove.</p>
    <div class="g2"><label class="f"><span>Quantity (e.g. -1 or 2)</span><input id="ad_q" type="number"></label><label class="f"><span>Date</span><input id="ad_d" type="date" value="${today()}"></label></div>
    <label class="f"><span>Reason</span><input id="ad_n" list="adr" placeholder="e.g. Damaged"><datalist id="adr"><option>Damaged</option><option>Customer return</option><option>Count correction</option><option>Gift / sample</option></datalist></label>
    <button class="btn full" id="adSave">Save</button>`);
  $('#adSave').onclick = async () => { try { await api('/stock-adjust', { method: 'POST', body: { product_id: pid, qty: $('#ad_q').value, note: $('#ad_n').value, date: $('#ad_d').value } }); closeSheet(); toast('Stock updated'); render(); } catch (e) { toast(e.message, 1); } };
}

// ---------- stock in (purchase) ----------
const PU = { lines: [] };
async function renderPurchase() {
  loading('Stock in');
  const [sups, inv] = await Promise.all([api('/suppliers'), api('/inventory')]);
  window._ps = inv.items;
  const pre = new URLSearchParams(location.hash.split('?')[1] || '');
  PU.lines = [];
  if (pre.get('p')) { const pr = inv.items.find((x) => x.id === +pre.get('p')); if (pr) PU.lines.push({ product_id: pr.id, qty: 1, cost: pr.cost_price }); }
  const cats = [...new Set(inv.items.map((p) => p.category))];
  shell('Stock in (purchase)', `<div class="cols wide"><div>
    <div class="card"><h3>Supplier</h3>
      <div class="row"><select id="puSup" class="grow"><option value="">— Select supplier —</option>${sups.map((x) => `<option value="${x.id}" ${pre.get('s') == x.id ? 'selected' : ''}>${esc(x.name)}${x.balance ? ' (payable ' + rs(x.balance) + ')' : ''}</option>`).join('')}</select>
      <button class="btn ghost" onclick="supplierSheet(null,true)">+ New</button></div>
      <div class="g2" style="margin-top:10px"><label class="f"><span>Date</span><input id="puDate" type="date" value="${today()}"></label><label class="f"><span>Supplier invoice no.</span><input id="puInv" placeholder="optional"></label></div>
    </div>
    <div class="card"><h3>Items received</h3>
      <div class="row" style="margin-bottom:10px"><select id="puAdd" class="grow"><option value="">+ Add product…</option>${cats.map((c) => `<optgroup label="${esc(c)}">${inv.items.filter((p) => p.category === c).map((p) => `<option value="${p.id}">${esc(p.name)} (stock ${p.stock})</option>`).join('')}</optgroup>`).join('')}</select>
      <button class="btn ghost" onclick="productSheet(null,true)">New</button></div>
      <div class="cart-line mut sm" style="font-weight:600"><span>Product</span><span>Qty</span><span>Cost / unit</span><span></span></div>
      <div id="puLines"></div>
      <div class="sumline big"><span>Purchase total</span><span class="money" id="puTot">Rs 0</span></div>
    </div>
    </div><div class="sticky">
    <div class="card"><h3>Payment to supplier</h3>
      <div class="g2"><label class="f"><span>Paid now (Rs)</span><input id="puPaid" type="number" value="0"></label>
      <label class="f"><span>Method</span><select id="puMeth"><option>Cash</option><option>Bank Transfer</option><option>Cheque</option><option>JazzCash</option><option>Easypaisa</option></select></label></div>
      <div class="btns" style="margin:-4px 0 10px"><button class="btn sm ghost" onclick="$('#puPaid').value=Math.round(puTotal());paintPUDue()">Paid in full</button><button class="btn sm ghost" onclick="$('#puPaid').value=0;paintPUDue()">On credit (udhaar)</button></div>
      <div class="sm" id="puDue"></div>
      <label class="f" style="margin-top:8px"><span>Note</span><input id="puNote"></label>
      <label class="sm" style="display:flex;gap:8px;align-items:center"><input type="checkbox" id="puUpd" checked style="width:auto"> Update product cost price to this purchase rate</label>
    </div>
    <button class="btn full amb" id="puSave" style="padding:14px;font-size:15px">Save stock in</button></div></div>`, { back: true });
  $('#puAdd').onchange = (e) => { const pr = window._ps.find((x) => x.id === +e.target.value); if (pr) { const ex = PU.lines.find((l) => l.product_id === pr.id); ex ? ex.qty++ : PU.lines.push({ product_id: pr.id, qty: 1, cost: pr.cost_price }); } e.target.value = ''; paintPU(); };
  $('#puPaid').oninput = paintPUDue;
  $('#puSave').onclick = async () => {
    try {
      $('#puSave').disabled = true;
      const sid = $('#puSup').value;
      const r = await api('/purchases', { method: 'POST', body: { supplier_id: sid, purchase_date: $('#puDate').value, invoice_ref: $('#puInv').value, items: PU.lines, paid: $('#puPaid').value, method: $('#puMeth').value, note: $('#puNote').value, update_cost: $('#puUpd').checked } });
      toast(`${r.purchase_no} saved — stock added`); go('#/supplier/' + sid);
    } catch (e) { toast(e.message, 1); $('#puSave').disabled = false; }
  };
  paintPU();
}
const puTotal = () => PU.lines.reduce((a, l) => a + n(l.qty) * n(l.cost), 0);
function paintPUDue() { const due = puTotal() - n($('#puPaid').value); $('#puDue').innerHTML = due > 0 ? `Goes to supplier khata as payable: <b style="color:var(--red)">${rs(due)}</b>` : ''; }
function paintPU() {
  $('#puLines').innerHTML = PU.lines.length ? PU.lines.map((l, k) => { const pr = window._ps.find((x) => x.id === l.product_id) || {}; return `<div class="cart-line"><span class="sm">${esc(pr.name)}</span>
    <input type="number" value="${l.qty}" min="1" oninput="PU.lines[${k}].qty=+this.value;puRefresh()"><input type="number" value="${l.cost}" oninput="PU.lines[${k}].cost=+this.value;puRefresh()">
    <button class="x" onclick="PU.lines.splice(${k},1);paintPU()">×</button></div>`; }).join('') : '<div class="mut sm" style="padding:8px 0">Add the products you received.</div>';
  puRefresh();
}
function puRefresh() { $('#puTot').textContent = rs(puTotal()); paintPUDue(); }

// ---------- suppliers khata ----------
async function renderSuppliers() {
  loading('Suppliers');
  const sups = await api('/suppliers');
  shell('Suppliers khata', `
    <div class="card row"><div class="grow"><div class="mut sm">Total payable to suppliers</div><div class="b money" style="font-size:20px;color:var(--red)">${rs(sups.reduce((a, x) => a + x.balance, 0))}</div></div><button class="btn" onclick="go('#/purchase')">⇩ Stock in</button></div>
    ${sups.length ? `<div class="list">${sups.map((x) => `<div class="item" onclick="go('#/supplier/${x.id}')"><div class="av">${initials(x.name)}</div><div class="grow"><div class="t">${esc(x.name)}</div><div class="d">${esc(x.phone || '')} · bought ${rs(x.purchased + x.opening_balance)} · paid ${rs(x.paid)}</div></div>
      <div class="right"><div class="b money" style="color:${x.balance > 0 ? 'var(--red)' : 'var(--g)'}">${rs(x.balance)}</div><div class="sm mut">${x.balance > 0 ? 'payable' : 'clear'}</div></div></div>`).join('')}</div>` : '<div class="list"><div class="empty">No suppliers yet</div></div>'}`,
  { back: true, action: `<button class="act" onclick="supplierSheet()">+ Supplier</button>` });
}
function supplierSheet(x, fromPurchase) {
  x = x || {};
  openSheet(`<h2>${x.id ? 'Edit' : 'New'} supplier</h2>
    <label class="f"><span>Name (dealer / wholesaler)</span><input id="sp_name" value="${esc(x.name || '')}"></label>
    <div class="g2"><label class="f"><span>Phone</span><input id="sp_phone" type="tel" value="${esc(x.phone || '')}"></label><label class="f"><span>Old balance you owe (Rs)</span><input id="sp_open" type="number" value="${n(x.opening_balance)}"></label></div>
    <label class="f"><span>Address</span><input id="sp_addr" value="${esc(x.address || '')}"></label>
    <label class="f"><span>Notes</span><input id="sp_notes" value="${esc(x.notes || '')}"></label>
    <button class="btn full" id="spSave">Save</button>`);
  $('#spSave').onclick = async () => {
    try {
      const body = { id: x.id, name: $('#sp_name').value, phone: $('#sp_phone').value, opening_balance: $('#sp_open').value, address: $('#sp_addr').value, notes: $('#sp_notes').value };
      const r = await api('/suppliers', { method: 'POST', body }); closeSheet(); toast('Supplier saved');
      if (fromPurchase) { const sel = $('#puSup'); sel.insertAdjacentHTML('beforeend', `<option value="${r.id}">${esc(body.name)}</option>`); sel.value = r.id; } else render();
    } catch (e) { toast(e.message, 1); }
  };
}
async function renderSupplier(id) {
  loading('Supplier');
  const d = await api('/suppliers/' + id);
  const x = d.supplier; window._sup = x;
  shell(x.name, `<div class="cols"><div>
    <div class="card"><div class="mut sm">${esc(x.phone || '')}${x.address ? ' · ' + esc(x.address) : ''}</div>
      <div class="g3" style="margin-top:8px"><div><div class="mut sm">Bought</div><b class="money">${rs(x.purchased + x.opening_balance)}</b></div><div><div class="mut sm">Paid</div><b class="money" style="color:var(--g2)">${rs(x.paid)}</b></div><div><div class="mut sm">Payable</div><b class="money" style="color:${x.balance > 0 ? 'var(--red)' : 'var(--g)'}">${rs(x.balance)}</b></div></div>
      <div class="btns" style="margin-top:12px"><button class="btn" onclick="go('#/purchase?s=${x.id}')">⇩ Stock in</button><button class="btn amb" onclick="paySupplierSheet(${x.id}, ${x.balance})">Pay supplier</button>
      <button class="btn ghost" onclick='supplierSheet(window._sup)'>Edit</button>${x.phone ? `<a class="btn ghost" href="tel:${esc(x.phone)}">Call</a>` : ''}</div></div>
    <h3 style="margin:14px 2px 8px;font-size:15px">Purchases (${d.purchases.length})</h3>
    ${d.purchases.length ? `<div class="list">${d.purchases.slice().reverse().map((p) => `<div class="item" style="cursor:default"><div class="grow"><div class="t">${esc(p.purchase_no)}${p.invoice_ref ? ' <span class="mut sm">inv ' + esc(p.invoice_ref) + '</span>' : ''}</div>
      <div class="d" style="white-space:normal">${fd(p.purchase_date)} · ${p.items.map((i) => esc(i.name) + ' ×' + i.qty + ' @ ' + rs(i.cost)).join(', ')}</div></div><b class="money">${rs(p.total)}</b>
      <button class="btn sm red" onclick="delPurchase(${p.id})">×</button></div>`).join('')}</div>` : '<div class="list"><div class="empty">No purchases yet</div></div>'}
    </div><div>
    <h3 class="first" style="margin:14px 2px 8px;font-size:15px">Supplier khata</h3>
    ${ledgerRows(d.ledger.map((e) => ({ date: e.date, desc: e.desc, plus: e.plus, minus: e.minus, balance: e.balance })), 'Bought', 'Paid')}
</div></div>`, { back: true, sub: x.balance > 0 ? 'Payable ' + rs(x.balance) : 'Clear' });
}
function paySupplierSheet(sid, bal) {
  openSheet(`<h2>Pay supplier</h2>
    <div class="g2"><label class="f"><span>Amount</span><input id="ps_amt" type="number" value="${Math.max(0, Math.round(bal))}"></label><label class="f"><span>Date</span><input id="ps_date" type="date" value="${today()}"></label></div>
    <div class="g2"><label class="f"><span>Method</span><select id="ps_meth"><option>Cash</option><option>Bank Transfer</option><option>Cheque</option><option>JazzCash</option><option>Easypaisa</option></select></label><label class="f"><span>Note</span><input id="ps_note"></label></div>
    <button class="btn full" id="psSave">Save payment</button>`);
  $('#psSave').onclick = async () => { try { await api('/supplier-payments', { method: 'POST', body: { supplier_id: sid, amount: $('#ps_amt').value, paid_on: $('#ps_date').value, method: $('#ps_meth').value, note: $('#ps_note').value } }); closeSheet(); toast('Payment saved'); render(); } catch (e) { toast(e.message, 1); } };
}
async function delPurchase(id) { if (!confirm('Delete this purchase? Its stock will be removed and its payment reversed.')) return; try { await api('/purchases/' + id, { method: 'DELETE' }); toast('Purchase deleted'); render(); } catch (e) { toast(e.message, 1); } }

function productSheet(p, fromPurchase) {
  const isNew = !p;
  p = p || { category: 'Electronics', stock: 0 };
  const cats = ['Electronics', 'Mobiles', 'Bikes', 'Clothes', 'Furniture', 'Crockery', 'Other'];
  openSheet(`<h2>${isNew ? 'New' : 'Edit'} product</h2>
    <label class="f"><span>Name</span><input id="pf_name" value="${esc(p.name || '')}"></label>
    <div class="g2"><label class="f"><span>Category</span><input id="pf_cat" list="catl" value="${esc(p.category)}"><datalist id="catl">${cats.map((c) => `<option>${c}</option>`).join('')}</datalist></label>
    ${isNew && !fromPurchase ? `<label class="f"><span>Opening stock qty</span><input id="pf_stock" type="number" value="0"></label>` : `<div class="sm mut" style="align-self:end;padding-bottom:12px">${isNew ? 'Stock will come from this purchase' : 'Stock: ' + p.stock + ' — change it with Stock in or Adjust'}</div>`}</div>
    <div class="g2"><label class="f"><span>Cost price (purchase)</span><input id="pf_cost" type="number" value="${n(p.cost_price)}"></label>
    <label class="f"><span>Cash sale price</span><input id="pf_cash" type="number" value="${n(p.cash_price)}"></label></div>
    <button class="btn full" id="pfSave">Save</button>
    ${!isNew ? `<button class="btn red full" style="margin-top:8px" id="pfDel">Remove product</button>` : ''}`);
  $('#pfSave').onclick = async () => {
    try {
      const body = { id: p.id, name: $('#pf_name').value, category: $('#pf_cat').value, stock: $('#pf_stock') ? $('#pf_stock').value : 0, cost_price: $('#pf_cost').value, cash_price: $('#pf_cash').value };
      const r = await api('/products', { method: 'POST', body }); closeSheet(); toast('Product saved');
      if (fromPurchase) {
        const np = { id: r.id, name: body.name, category: body.category, cost_price: n(body.cost_price), cash_price: n(body.cash_price), stock: 0 };
        window._ps.push(np); PU.lines.push({ product_id: r.id, qty: 1, cost: np.cost_price });
        $('#puAdd').insertAdjacentHTML('beforeend', `<option value="${r.id}">${esc(np.name)} (stock 0)</option>`); paintPU();
      } else render();
    } catch (e) { toast(e.message, 1); }
  };
  if (!isNew) $('#pfDel').onclick = async () => { if (confirm('Remove product?')) { await api('/products/' + p.id, { method: 'DELETE' }); closeSheet(); go('#/inventory'); } };
}

// ---------- packages ----------
async function renderPackages() {
  loading('Packages');
  const [pk, ps] = await Promise.all([api('/packages'), api('/products')]);
  window._pk = pk; window._ps = ps;
  shell('Packages', `<p class="mut sm" style="margin:0 2px 10px">Ready-made bundles like Jahez packages. When making a bill, pick a package — then add or remove items as the customer wants.</p>
    ${pk.length ? pk.map((p) => `<div class="card" onclick='packageSheet(window._pk.find(x=>x.id===${p.id}))' style="cursor:pointer"><div class="row"><b class="grow">${esc(p.name)}</b><b class="money">${rs(p.total)}</b></div>
    <div class="mut sm">${esc(p.description)}</div><div class="sm" style="margin-top:6px">${p.items.map((i) => esc(i.name) + (i.qty > 1 ? ' ×' + i.qty : '')).join(' · ')}</div></div>`).join('') : '<div class="list"><div class="empty">No packages yet</div></div>'}`,
  { back: true, action: `<button class="act" onclick="packageSheet()">+ Package</button>` });
}
function packageSheet(p) {
  p = p || { name: '', description: '', items: [] };
  const items = p.items.map((i) => ({ product_id: i.product_id, qty: i.qty }));
  const paint = () => {
    $('#pkItems').innerHTML = items.map((i, k) => { const pr = window._ps.find((x) => x.id === i.product_id) || {}; return `<div class="cart-line" style="grid-template-columns:1fr 64px 90px 30px"><span class="sm">${esc(pr.name)}</span><input type="number" value="${i.qty}" onchange="this.closest('.sheet-card')._items[${k}].qty=+this.value;this.closest('.sheet-card')._paint()"><span class="sm money right">${rs(pr.cash_price * i.qty)}</span><button class="x" onclick="this.closest('.sheet-card')._items.splice(${k},1);this.closest('.sheet-card')._paint()">×</button></div>`; }).join('') || '<div class="mut sm">No items</div>';
    $('#pkTot').textContent = rs(items.reduce((a, i) => a + n((window._ps.find((x) => x.id === i.product_id) || {}).cash_price) * i.qty, 0));
  };
  openSheet(`<h2>${p.id ? 'Edit' : 'New'} package</h2>
    <label class="f"><span>Package name</span><input id="pk_name" value="${esc(p.name)}" placeholder="e.g. Jahez Package — Gold"></label>
    <label class="f"><span>Description</span><input id="pk_desc" value="${esc(p.description)}"></label>
    <select id="pkAdd" style="margin-bottom:10px"><option value="">+ Add product…</option>${window._ps.map((x) => `<option value="${x.id}">${esc(x.name)} — ${rs(x.cash_price)}</option>`).join('')}</select>
    <div id="pkItems"></div><div class="sumline big"><span>Package cash value</span><span id="pkTot"></span></div>
    <button class="btn full" id="pkSave" style="margin-top:10px">Save package</button>
    ${p.id ? '<button class="btn red full" style="margin-top:8px" id="pkDel">Remove package</button>' : ''}`);
  const card = $('#sheetCard'); card._items = items; card._paint = paint; paint();
  $('#pkAdd').onchange = (e) => { const id = +e.target.value; if (id) { const ex = items.find((i) => i.product_id === id); ex ? ex.qty++ : items.push({ product_id: id, qty: 1 }); } e.target.value = ''; paint(); };
  $('#pkSave').onclick = async () => { try { await api('/packages', { method: 'POST', body: { id: p.id, name: $('#pk_name').value, description: $('#pk_desc').value, items } }); closeSheet(); render(); } catch (e) { toast(e.message, 1); } };
  if (p.id) $('#pkDel').onclick = async () => { if (confirm('Remove package?')) { await api('/packages/' + p.id, { method: 'DELETE' }); closeSheet(); render(); } };
}

// ---------- business khata ----------
async function renderKhata(month) {
  month = month || today().slice(0, 7);
  loading('Business khata');
  const [y, m] = month.split('-').map(Number);
  const from = `${month}-01`, to = `${month}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`;
  const cb = await api(`/cashbook?from=${from}&to=${to}`);
  const prev = new Date(y, m - 2, 1), next = new Date(y, m, 1);
  const ym = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  shell('Business khata', `
    <div class="row" style="margin-bottom:10px"><button class="btn sm ghost" onclick="go('#/khata/${ym(prev)}')">‹</button><b class="grow" style="text-align:center">${fm(month)}</b><button class="btn sm ghost" onclick="go('#/khata/${ym(next)}')">›</button></div>
    <div class="stats">
      <div class="stat"><div class="l">Opening cash</div><div class="v money">${rs(cb.opening)}</div></div>
      <div class="stat"><div class="l">Money in</div><div class="v money" style="color:var(--g2)">${rs(cb.total_in)}</div></div>
      <div class="stat red"><div class="l">Money out</div><div class="v money">${rs(cb.total_out)}</div></div>
      <div class="stat blue"><div class="l">Closing cash</div><div class="v money">${rs(cb.closing)}</div></div>
    </div>
    <div class="btns" style="margin-bottom:12px"><button class="btn" onclick="expenseSheet('out')">− Add expense</button><button class="btn ghost" onclick="expenseSheet('in')">+ Other income / investment</button></div>
    <h3 style="margin:4px 2px 8px;font-size:15px">Cashbook</h3>${ledgerRows(cb.entries.map((e) => ({ date: e.date, desc: e.desc, minus: e.out, plus: e.in, balance: e.balance, cash: true })), 'In', 'Out')}
    <div id="expList"></div>`, { back: true });
  const ex = await api(`/expenses?from=${from}&to=${to}`);
  $('#expList').innerHTML = ex.length ? `<h3 style="margin:10px 2px 8px;font-size:15px">Expense & income entries</h3><div class="list">${ex.map((e) => `<div class="item"><div class="grow"><div class="t">${esc(e.category)}</div><div class="d">${fd(e.exp_date)}${e.note ? ' · ' + esc(e.note) : ''}</div></div><b class="money" style="color:${e.direction === 'in' ? 'var(--g2)' : 'var(--red)'}">${e.direction === 'in' ? '+' : '−'} ${rs(e.amount)}</b><button class="btn sm red" onclick="delExp(${e.id})">×</button></div>`).join('')}</div>` : '';
}
function expenseSheet(dir) {
  const cats = dir === 'out' ? ['Stock Purchase', 'Shop Rent', 'Staff Salary', 'Electricity Bill', 'Transport / Delivery', 'Recovery Fuel', 'Owner Withdrawal', 'Other'] : ['Owner Investment', 'Cash Sale', 'Loan Received', 'Other Income'];
  openSheet(`<h2>${dir === 'out' ? 'Add expense' : 'Add income / investment'}</h2>
    <label class="f"><span>Category</span><input id="ex_cat" list="exc" value="${cats[0]}"><datalist id="exc">${cats.map((c) => `<option>${c}</option>`).join('')}</datalist></label>
    <div class="g2"><label class="f"><span>Amount</span><input id="ex_amt" type="number"></label><label class="f"><span>Date</span><input id="ex_date" type="date" value="${today()}"></label></div>
    <label class="f"><span>Note</span><input id="ex_note"></label><button class="btn full" id="exSave">Save</button>`);
  $('#exSave').onclick = async () => { try { await api('/expenses', { method: 'POST', body: { category: $('#ex_cat').value, amount: $('#ex_amt').value, exp_date: $('#ex_date').value, note: $('#ex_note').value, direction: dir } }); closeSheet(); render(); } catch (e) { toast(e.message, 1); } };
}
async function delExp(id) { if (confirm('Delete entry?')) { await api('/expenses/' + id, { method: 'DELETE' }); render(); } }

// ---------- report ----------
async function renderReport(month) {
  month = month || today().slice(0, 7);
  loading('Report');
  const r = await api('/report?month=' + month);
  const [y, m] = month.split('-').map(Number);
  const ym = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  const coll = r.payments.reduce((a, p) => a + p.amt, 0);
  const adv = r.payments.filter((p) => p.kind === 'advance').reduce((a, p) => a + p.amt, 0);
  const expOut = r.expenses.filter((e) => e.direction === 'out').reduce((a, e) => a + e.amt, 0);
  const rate = r.expected ? Math.round(((r.expected - r.still_due) / r.expected) * 100) : 0;
  window._rep = r;
  shell('Monthly report', `
    <div class="row" style="margin-bottom:10px"><button class="btn sm ghost" onclick="go('#/report/${ym(new Date(y, m - 2, 1))}')">‹</button><b class="grow" style="text-align:center">${fm(month)}</b><button class="btn sm ghost" onclick="go('#/report/${ym(new Date(y, m, 1))}')">›</button></div>
    <div class="stats">
      <div class="stat"><div class="l">New sales</div><div class="v money">${rs(r.sales_total)}</div><div class="s">${r.sales.length} bills</div></div>
      <div class="stat"><div class="l">Markup earned on sales</div><div class="v money">${rs(r.markup_total)}</div><div class="s">Gross margin ${rs(r.sales_total - r.cost_total)}</div></div>
      <div class="stat blue"><div class="l">Cash collected</div><div class="v money">${rs(coll)}</div><div class="s">incl. advance ${rs(adv)}</div></div>
      <div class="stat red"><div class="l">Expenses</div><div class="v money">${rs(expOut)}</div><div class="s">+ paid to suppliers ${rs(r.supplier_paid)}</div></div>
    </div>
    <div class="card"><h3>Recovery performance</h3><div class="row"><div class="grow">Installments due this month: <b>${rs(r.expected)}</b><br>Still unpaid: <b style="color:var(--red)">${rs(r.still_due)}</b></div><div class="b" style="font-size:26px;color:var(--g2)">${rate}%</div></div><div class="progress"><i style="width:${rate}%"></i></div></div>
    <div class="card"><h3>Stock purchased</h3>${r.purchases.map((p) => `<div class="sumline"><span>${esc(p.purchase_no)} · ${esc(p.name)} <span class="mut sm">${fd(p.purchase_date)}</span></span><span class="money">${rs(p.total)}</span></div>`).join('') || '<div class="mut sm">No purchases</div>'}
      <div class="sumline big"><span>Total purchased</span><span class="money">${rs(r.purchases_total)}</span></div><div class="sumline"><span>Paid to suppliers this month</span><span class="money">${rs(r.supplier_paid)}</span></div></div>
    <div class="card"><h3>Collection by staff</h3>${r.by_staff.map((b) => `<div class="sumline"><span>${esc(b.name)} (${b.n})</span><span class="money">${rs(b.amt)}</span></div>`).join('') || '<div class="mut sm">—</div>'}</div>
    <div class="card"><h3>By payment method</h3>${Object.entries(r.payments.reduce((a, p) => (a[p.method] = (a[p.method] || 0) + p.amt, a), {})).map(([k, v]) => `<div class="sumline"><span>${esc(k)}</span><span class="money">${rs(v)}</span></div>`).join('') || '<div class="mut sm">—</div>'}</div>
    <div class="card"><h3>Expenses</h3>${r.expenses.map((e) => `<div class="sumline"><span>${esc(e.category)} ${e.direction === 'in' ? '<span class="pill">in</span>' : ''}</span><span class="money">${rs(e.amt)}</span></div>`).join('') || '<div class="mut sm">—</div>'}</div>
    <div class="card tbl-wrap"><h3>Bills made</h3><table><tr><th>Bill</th><th>Customer</th><th>Plan</th><th class="right">Total</th></tr>${r.sales.map((s) => `<tr><td>${s.bill_no}<div class="sm mut">${fd(s.sale_date)}</div></td><td>${esc(s.name)}${s.package_name ? `<div class="sm mut">${esc(s.package_name)}</div>` : ''}</td><td>${s.plan_type}</td><td class="right money">${rs(s.total)}</td></tr>`).join('') || '<tr><td colspan="4" class="mut">No bills</td></tr>'}</table></div>
    <button class="btn ghost full" onclick="printReport()">Print report</button>`, { back: true });
}
function printReport() {
  const r = window._rep;
  const coll = r.payments.reduce((a, p) => a + p.amt, 0);
  doPrint(`${prHead('Monthly Report — ' + fm(r.month))}
    <table><tr><td>New sales</td><td><b>${rs(r.sales_total)}</b> (${r.sales.length} bills)</td></tr><tr><td>Markup on sales</td><td>${rs(r.markup_total)}</td></tr><tr><td>Cash collected</td><td><b>${rs(coll)}</b></td></tr>
    <tr><td>Installments due this month</td><td>${rs(r.expected)}</td></tr><tr><td>Still unpaid</td><td>${rs(r.still_due)}</td></tr>
    ${r.expenses.map((e) => `<tr><td>${e.direction === 'in' ? 'Income' : 'Expense'}: ${esc(e.category)}</td><td>${rs(e.amt)}</td></tr>`).join('')}</table>
    <h3>Bills</h3><table><tr><th>Bill</th><th>Date</th><th>Customer</th><th>Plan</th><th>Total</th></tr>${r.sales.map((s) => `<tr><td>${s.bill_no}</td><td>${fd(s.sale_date)}</td><td>${esc(s.name)}</td><td>${s.plan_type}</td><td>${rs(s.total)}</td></tr>`).join('')}</table>`);
}

// ---------- staff ----------
async function renderStaff() {
  loading('Staff');
  const us = await api('/users');
  window._us = us;
  shell('Staff & PINs', `<div class="list">${us.map((u) => `<div class="item" onclick='staffSheet(window._us.find(x=>x.id===${u.id}))'><div class="av">${initials(u.name)}</div><div class="grow"><div class="t">${esc(u.name)} ${u.active ? '' : '<span class="pill grey">Disabled</span>'}</div><div class="d">${u.role === 'owner' ? 'Owner — full access' : 'Recovery staff — bills, customers, collection'} · PIN ${esc(u.pin)}</div></div></div>`).join('')}</div>`,
  { back: true, action: `<button class="act" onclick="staffSheet()">+ Staff</button>` });
}
function staffSheet(u) {
  u = u || { role: 'staff', active: true };
  openSheet(`<h2>${u.id ? 'Edit' : 'New'} user</h2>
    <label class="f"><span>Name</span><input id="us_name" value="${esc(u.name || '')}"></label>
    <div class="g2"><label class="f"><span>PIN (4–6 digits)</span><input id="us_pin" inputmode="numeric" value="${esc(u.pin || '')}"></label>
    <label class="f"><span>Role</span><select id="us_role"><option value="staff" ${u.role === 'staff' ? 'selected' : ''}>Recovery staff</option><option value="owner" ${u.role === 'owner' ? 'selected' : ''}>Owner</option></select></label></div>
    ${u.id ? `<label class="f"><span>Status</span><select id="us_act"><option value="1">Active</option><option value="0" ${u.active ? '' : 'selected'}>Disabled</option></select></label>` : ''}
    <button class="btn full" id="usSave">Save</button>`);
  $('#usSave').onclick = async () => { try { await api('/users', { method: 'POST', body: { id: u.id, name: $('#us_name').value, pin: $('#us_pin').value, role: $('#us_role').value, active: u.id ? $('#us_act').value === '1' : true } }); closeSheet(); render(); } catch (e) { toast(e.message, 1); } };
}

// ---------- settings ----------
function renderSettings() {
  const s = S.settings;
  const f = (k, l, t = 'text') => `<label class="f"><span>${l}</span><input id="st_${k}" type="${t}" value="${esc(s[k] || '')}"></label>`;
  shell('Settings', `<div class="card"><h3>Business</h3>${f('business_name', 'Business name')}${f('business_phone', 'Phone')}${f('business_address', 'Address')}${f('default_markup', 'Default markup %', 'number')}${f('code_prefix', 'Customer code prefix (new customers)')}</div>
    <div class="card"><h3>Yearly installment plan</h3><p class="mut sm" style="margin-top:0">Customers on the yearly plan pay once a year on this date.</p>
    <div class="g2"><label class="f"><span>Month</span><select id="st_yearly_month">${MONTHS.map((mm, i) => `<option value="${i + 1}" ${+s.yearly_month === i + 1 ? 'selected' : ''}>${mm}</option>`).join('')}</select></label>${f('yearly_day', 'Day of month', 'number')}</div></div>
    <div class="card"><h3>WhatsApp messages</h3><p class="mut sm" style="margin-top:0">Use {name} {amount} {bill} {due} {balance} {receipt} {business}</p>
    <label class="f"><span>Reminder</span><textarea id="st_wa_template" rows="3">${esc(s.wa_template)}</textarea></label>
    <label class="f"><span>Payment receipt</span><textarea id="st_receipt_template" rows="3">${esc(s.receipt_template)}</textarea></label></div>
    <button class="btn full" id="stSave">Save settings</button>`, { back: true });
  $('#stSave').onclick = async () => {
    const body = {}; ['business_name', 'business_phone', 'business_address', 'default_markup', 'code_prefix', 'yearly_month', 'yearly_day', 'wa_template', 'receipt_template'].forEach((k) => body[k] = $('#st_' + k).value);
    try { S.settings = await api('/settings', { method: 'PUT', body }); toast('Settings saved'); } catch (e) { toast(e.message, 1); }
  };
}

render();
