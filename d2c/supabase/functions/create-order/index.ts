import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*", // lock this to your domain before going live
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const code = (p: string, n: number) => {
  const c = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return p + "-" + Array.from(crypto.getRandomValues(new Uint8Array(n)), (x) => c[x % 32]).join("");
};
const ID_TYPES = ["Aadhaar", "PAN", "Passport", "Driving licence", "Voter ID"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const b = await req.json();
    const str = (x: unknown, max: number) => (typeof x === "string" ? x.trim().slice(0, max) : "");
    const name = str(b.name, 100), email = str(b.email, 150).toLowerCase(), phone = str(b.phone, 20);
    const address = str(b.address, 300), idType = str(b.idType, 30), idLast4 = str(b.idLast4, 4);
    if (!name || !phone || !address) return json({ error: "Fill in name, phone and address." }, 400);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: "Enter a valid email." }, 400);
    if (!ID_TYPES.includes(idType) || !/^[A-Za-z0-9]{4}$/.test(idLast4)) return json({ error: "Enter the ID type and its last 4 characters." }, 400);
    if (!Array.isArray(b.items) || b.items.length < 1 || b.items.length > 20) return json({ error: "Your cart is empty." }, 400);

    const qty = new Map<string, number>();
    for (const i of b.items) {
      const q = Number(i?.q);
      if (typeof i?.id !== "string" || !Number.isInteger(q) || q < 1 || q > 10) return json({ error: "Invalid cart." }, 400);
      qty.set(i.id, (qty.get(i.id) ?? 0) + q);
    }

    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: prods, error: pe } = await sb.from("products").select("*").in("id", [...qty.keys()]).eq("active", true);
    if (pe || !prods || prods.length !== qty.size) return json({ error: "A product in your cart is no longer available." }, 400);
    const { data: st } = await sb.from("settings").select("*").eq("id", 1).single();

    let subtotal = 0;
    const items = [];
    for (const p of prods) {
      const q = qty.get(p.id)!;
      if (q > p.stock) return json({ error: `${p.name} has only ${p.stock} left.` }, 400);
      subtotal += p.price_paise * q; // price always comes from the database, never the browser
      items.push({ id: p.id, name: p.name, q, price_paise: p.price_paise });
    }
    const shipping = st?.shipping_paise ?? 0, total = subtotal + shipping;

    const keyId = Deno.env.get("RAZORPAY_KEY_ID")!, keySecret = Deno.env.get("RAZORPAY_KEY_SECRET")!;
    const orderCode = code("ORD", 6);
    const rz = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: { Authorization: "Basic " + btoa(`${keyId}:${keySecret}`), "Content-Type": "application/json" },
      body: JSON.stringify({ amount: total, currency: "INR", receipt: orderCode }),
    });
    if (!rz.ok) { console.error("Razorpay error", await rz.text()); return json({ error: "Could not start payment. Try again." }, 502); }
    const rzo = await rz.json();

    const { error: ie } = await sb.from("orders").insert({
      order_code: orderCode, customer_code: code("CUS", 5), name, email, phone, address,
      id_type: idType, id_last4: idLast4, items, subtotal_paise: subtotal, shipping_paise: shipping,
      total_paise: total, razorpay_order_id: rzo.id, carrier: st?.default_carrier ?? "",
    });
    if (ie) { console.error(ie); return json({ error: "Could not save your order. Try again." }, 500); }
    return json({ orderCode, razorpayOrderId: rzo.id, amount: total, keyId });
  } catch (e) {
    console.error(e);
    return json({ error: "Something went wrong. Try again." }, 500);
  }
});
