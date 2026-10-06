# D2C Store Setup Guide (Supabase + Razorpay, INR)

This guide takes a developer from zero to a working store with test payments, then to production.

## 1. What you have

```
SetUp.md
supabase/
  schema.sql                      Tables, security rules, tracking and payment functions, sample products
  functions/create-order/         Prices the cart on the server and creates the Razorpay order
  functions/verify-payment/       Checks Razorpay's signature, marks the order paid, reduces stock
web/
  index.html                      Storefront: products, cart, checkout, order tracking
  admin.html                      Owner area: products, settings, orders, tracking numbers
  config.js                       Your Supabase URL and anon key (you edit this)
  common.js, style.css            Shared helpers, INR formatting, light/dark toggle, styles
```

How an order flows:

1. Customer fills checkout and clicks Pay.
2. `create-order` re-reads prices and stock from the database, adds shipping, creates a Razorpay order and saves an unpaid order.
3. Razorpay Checkout opens in the browser (UPI, cards, net banking).
4. After payment, the browser sends Razorpay's IDs and signature to `verify-payment`.
5. `verify-payment` recomputes the signature with your secret key. If it matches, the order becomes paid, stock drops and the order timeline starts.
6. Customer tracks the order with order ID + email. You update status, carrier and tracking number in the admin page.

The browser never sets prices and never sees the Razorpay secret or the Supabase service key.

## 2. Prerequisites

- A free Supabase account (https://supabase.com)
- A Razorpay account (https://razorpay.com). Test mode works before KYC.
- Node.js 18+ (for the Supabase CLI and a local web server)

## 3. Create the Supabase project

1. In Supabase, click New project. Choose a region close to your customers (for India, Mumbai if available) and save the database password.
2. Open Project Settings > API. Copy the Project URL and the `anon` public key.

## 4. Create the database

1. Open SQL Editor > New query.
2. Paste all of `supabase/schema.sql` and click Run. It should finish with "Success".
3. Open Table Editor. You should see `products` (6 rows), `settings` (1 row), `orders`, `admins`.

If you run the file twice you will get "policy already exists" errors. Only run it once on a fresh project.

## 5. Create your admin login

1. Open Authentication > Users > Add user > Create new user. Enter your email and a strong password. Tick Auto Confirm User.
2. In SQL Editor run (use the same email):

```sql
insert into admins (email) values ('you@example.com');
```

Only emails in the `admins` table can see orders or edit products. A signed-in user who is not listed sees nothing.

In Authentication > Providers > Email, turn off "Allow new users to sign up" (Authentication > Sign In / Providers, depending on your dashboard version) so strangers cannot create accounts.

## 6. Get Razorpay test keys

1. Log in to the Razorpay Dashboard and switch to Test Mode.
2. Go to Account & Settings > API Keys > Generate Test Key.
3. Save the Key ID (starts with `rzp_test_`) and the Key Secret. The secret is shown once.

## 7. Deploy the two Edge Functions

From the project root (the folder that contains `supabase/`):

```bash
npm install -g supabase            # or use: npx supabase <command>
supabase login
supabase link --project-ref YOUR_PROJECT_REF     # the ref is the part before .supabase.co
supabase secrets set RAZORPAY_KEY_ID=rzp_test_xxxxxxxx RAZORPAY_KEY_SECRET=xxxxxxxx
supabase functions deploy create-order
supabase functions deploy verify-payment
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are provided to functions automatically. You do not set them.

Check Edge Functions in the dashboard: both should show as active. Logs there are your first stop when something fails.

## 8. Configure and run the web app

1. Edit `web/config.js` and paste your Project URL and anon key.
2. Serve the `web` folder over http (opening the file directly can break things):

```bash
npx serve web
```

3. Open http://localhost:3000 for the shop and http://localhost:3000/admin.html for the admin page.

## 9. Test a payment

1. Add a product, click Checkout, fill the form. Use any 4 letters or digits for "ID last 4".
2. Click Pay. In Razorpay's test window use one of:
   - Card: `4111 1111 1111 1111`, any future expiry, any CVV, any OTP if asked
   - UPI: `success@razorpay` (use `failure@razorpay` to test a failed payment)
3. You should see "Order placed" with an order ID (ORD-XXXXXX) and customer ID (CUS-XXXXX).
4. Open the admin page. The order appears under Paid orders and stock has dropped.
5. Change the status to Shipped, enter a carrier and tracking number.
6. On the shop, open Track order, enter the order ID and email. The timeline and tracking number show.

## 10. Using the admin page

- **Store settings:** store name, tagline, shipping fee in rupees, default carrier for new orders.
- **Products:** edit any field inline. Changes save when you leave the field. Untick Visible to hide a product (products are hidden, not deleted, so old orders keep their names). Add product creates a placeholder row.
- **Orders:** only paid orders are listed. Changing status fills in the timeline with a timestamp. Carrier and tracking number show to the customer straight away.

## 11. Going live checklist

1. Complete Razorpay KYC and switch to Live Mode. Generate live keys, then run `supabase secrets set` again with the live Key ID and secret and no redeploy is needed.
2. Host the `web` folder on any static host (Netlify, Vercel, Cloudflare Pages) over HTTPS.
3. In both functions, change `"Access-Control-Allow-Origin": "*"` to your real domain, then redeploy both.
4. Add a Razorpay webhook for `payment.captured`. Today an order is confirmed only if the customer's browser reaches `verify-payment`. If someone pays and closes the tab, the money is captured but the order stays unpaid. A webhook function that calls `finalize_order` closes this gap. Do this before real traffic.
5. Replace the placeholder products, store name, tagline and carrier. Add product photos (store image URLs in a new `image_url` column) when you are ready.
6. Add your legal pages (privacy policy, terms, refund policy) and GST details. Razorpay requires them for activation.
7. Enable email confirmations or order emails (Supabase Auth emails do not cover order emails; use a provider such as Resend from a function).

## 12. Data and privacy notes

- Only the ID type and last 4 characters are stored. Do not collect full Aadhaar or other government ID numbers. Indian rules restrict storing Aadhaar numbers.
- Card and UPI details never touch your code or database. Razorpay handles them.
- `orders` cannot be read by the public. Customers see only their own order through `track_order`, which needs the order ID and the email together.

## 13. Troubleshooting

| Problem | Likely cause and fix |
|---|---|
| "Open web/config.js..." message | Placeholder values still in `config.js` |
| Shop says it could not load the store | Wrong URL or anon key, or `schema.sql` not run |
| Pay button says "Could not start payment" | Razorpay secrets missing or wrong. Check `supabase secrets list` and function logs |
| "Payment check failed" | Key ID and secret belong to different modes (test vs live) |
| Admin says "not an admin" | The email in `admins` differs from the login email |
| Admin tables are empty | Not signed in as an admin, or no paid orders yet |
| CORS error in browser console | Function origin changed. Check `Access-Control-Allow-Origin` and redeploy |
| Paid but order shows unpaid | Customer closed the tab early. Fix with the webhook in section 11 |
