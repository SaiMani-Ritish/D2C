import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*", // lock this to your domain before going live
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const b = await req.json();
    const o = b.razorpay_order_id, p = b.razorpay_payment_id, s = b.razorpay_signature;
    if (![o, p, s].every((x) => typeof x === "string" && x)) return json({ error: "Missing payment details." }, 400);

    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(Deno.env.get("RAZORPAY_KEY_SECRET")!),
      { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${o}|${p}`));
    const hex = Array.from(new Uint8Array(mac), (x) => x.toString(16).padStart(2, "0")).join("");
    if (hex !== s) return json({ error: "Payment check failed. If money was deducted, contact support with your payment ID." }, 400);

    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data, error } = await sb.rpc("finalize_order", { p_razorpay_order_id: o, p_payment_id: p });
    if (error || !data) { console.error(error); return json({ error: "Payment received but the order could not be finalised. Contact support with your payment ID." }, 500); }
    return json({ order: data });
  } catch (e) {
    console.error(e);
    return json({ error: "Something went wrong." }, 500);
  }
});
