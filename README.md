# QistBook — Installment (Qist) Business Manager

A mobile-first web app for shops that sell electronics, bikes, clothes, furniture and Jahez packages on installments.

## What it does
- **Bills on qist:** pick items or a ready package (e.g. Jahez Basic / Premium), then add or remove items as the customer chooses. Set markup %, discount and advance. The app builds the full installment schedule.
- **Two ways to collect:**
  - **Monthly:** a qist every month.
  - **Yearly:** one qist every year on a fixed date (default **10 August**, which you can change in Settings).
- **Customer code:** every customer gets a code, either automatic (AQ-1001, AQ-1002…) or one you type yourself. Enter a code on the dashboard (or in the sidebar on a laptop) to see total, paid and remaining in rupees, how many qist are paid and how many are left, the next due date and any late amount. From there you can collect, open the bill or send the summary on WhatsApp.
- **Customer plan:** when adding a customer, choose whether they pay **every month** or **once a year, every August** (Aug 2026, Aug 2027, Aug 2028…). Their new bills use that plan automatically, and you can still change it on a bill if needed.
- **Old customers:** More → *Add old customers* (or **+ Old bill** on a customer's page) records customers who bought before the app. You enter their old code, goods bought, plan, total, advance, installments already paid and the next due date. Old records do not change current stock or today's cash.
- **Recovery screen:** shows what's due this month, what's overdue, the monthly plans, the yearly (August) plans and every active bill. Each row has buttons to collect, send a WhatsApp reminder or call the customer.
- **Collect qist:** saving a payment gives a receipt number. You can send the receipt on WhatsApp or print it. Payments go against the oldest unpaid installment first.
- **Customer khata:** customer details with CNIC and guarantor (zamin), every bill, and a full ledger with a running balance. The ledger can be printed.
- **Business khata:** a cashbook (opening, in, out, closing), plus expenses like rent, salary and stock purchase, and income like owner investment.
- **Monthly report:** sales, markup, gross margin, cash collected, recovery % against installments due, collection by staff and by payment method, and expenses. The report can be printed.
- **Inventory khata:** shows the total stock value (at cost and at sale price), stock for each product, and low-stock alerts. Each product has its own **stock ledger**: opening stock, stock in from purchases, items sold on bills, and adjustments for damage, returns or count corrections, with a running balance.
- **Stock in (purchase):** record goods received from a supplier with qty, cost and invoice number. Stock goes up automatically and the product's cost price is updated. Pay in full, part, or on credit (udhaar).
- **Suppliers khata:** shows what you owe each dealer or wholesaler, including any old balance. It lists every purchase and payment with a running balance, and has a Pay supplier button. Supplier payments go into the business cashbook automatically.
- Selling on a bill takes stock out, and deleting a bill or purchase reverses it, so the stock count always matches the ledger.
- **Packages**, **staff PIN logins** (Owner has full access; Recovery staff can make bills, see customers and collect), and **Settings** (business info, yearly month/day, WhatsApp message templates).
- Print views for the bill (with schedule and signature lines), the receipt, the customer khata and the monthly report.

Default PINs: **Owner 1234**, **Recovery staff 1111**. Change them in More → Staff.
On first login the owner can tap **Load demo data** on Home to fill the app with sample products, packages, customers and bills.

## Deploy (GitHub + Render + Neon)
1. **Neon:** create a project and copy the connection string (`postgresql://...sslmode=require`).
2. **GitHub:** create a repo (e.g. `qistbook`) and upload everything in this folder except `node_modules`.
3. **Render:** New → Web Service → connect the repo.
   - Build command: `npm install`
   - Start command: `npm start`
   - Environment variables:
     - `DATABASE_URL` = your Neon connection string
     - `APP_SECRET` = any long random text (used to sign logins)
     - `TZ` = `Asia/Karachi` (optional; this is already the default)
4. Open the Render URL and log in with 1234. The tables are created automatically on first start.

On a phone, open the URL in Chrome and choose **Add to Home screen** to use it like an app.

## Run locally
```
npm install
DATABASE_URL=postgresql://user:pass@localhost:5432/qist npm start
```
