-- Run this whole file once in Supabase: SQL Editor > New query > Run.
create extension if not exists pgcrypto;

create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text not null default '',
  price_paise int not null check (price_paise >= 0),
  stock int not null default 0 check (stock >= 0),
  color text not null default '#0f4c5c',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists settings (
  id int primary key default 1 check (id = 1),
  store_name text not null default 'Placeholder Store',
  tagline text not null default 'Short tagline about what you sell goes here.',
  shipping_paise int not null default 7900 check (shipping_paise >= 0),
  default_carrier text not null default 'Carrier Name'
);
insert into settings default values on conflict do nothing;

create table if not exists admins (email text primary key);

create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  order_code text unique not null,
  customer_code text not null,
  name text not null,
  email text not null,
  phone text not null,
  address text not null,
  id_type text not null,
  id_last4 text not null check (id_last4 ~ '^[A-Za-z0-9]{4}$'),
  items jsonb not null,
  subtotal_paise int not null,
  shipping_paise int not null,
  total_paise int not null,
  payment_status text not null default 'pending' check (payment_status in ('pending','paid')),
  razorpay_order_id text unique,
  razorpay_payment_id text,
  status text not null default 'Placed' check (status in ('Placed','Packed','Shipped','Out for delivery','Delivered')),
  carrier text not null default '',
  tracking_no text not null default '',
  status_log jsonb not null default '[]',
  created_at timestamptz not null default now()
);

create or replace function is_admin() returns boolean
language sql security definer stable set search_path = public as $$
  select exists (select 1 from admins where lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')))
$$;

alter table products enable row level security;
alter table settings enable row level security;
alter table admins   enable row level security;
alter table orders   enable row level security;

create policy "public reads active products" on products for select using (active or is_admin());
create policy "admin manages products" on products for all using (is_admin()) with check (is_admin());
create policy "public reads settings" on settings for select using (true);
create policy "admin updates settings" on settings for update using (is_admin()) with check (is_admin());
create policy "admin manages orders" on orders for all using (is_admin()) with check (is_admin());
-- admins table has no policies on purpose: only is_admin() can read it.

create or replace function order_view(o orders) returns jsonb
language sql stable as $$
  select jsonb_build_object('order_code', o.order_code, 'customer_code', o.customer_code, 'status', o.status,
    'carrier', o.carrier, 'tracking_no', o.tracking_no, 'status_log', o.status_log, 'items', o.items,
    'total_paise', o.total_paise, 'id_type', o.id_type, 'id_last4', o.id_last4, 'name', o.name, 'address', o.address)
$$;

-- Customers track an order with order code + email. Paid orders only.
create or replace function track_order(p_code text, p_email text) returns jsonb
language sql security definer stable set search_path = public as $$
  select order_view(o) from orders o
  where o.order_code = upper(trim(p_code)) and lower(o.email) = lower(trim(p_email)) and o.payment_status = 'paid'
  limit 1
$$;
grant execute on function track_order(text, text) to anon, authenticated;

-- Called only by the verify-payment Edge Function (service role) after the signature check.
create or replace function finalize_order(p_razorpay_order_id text, p_payment_id text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare o orders; it jsonb;
begin
  update orders set payment_status = 'paid', razorpay_payment_id = p_payment_id,
    status_log = jsonb_build_array(jsonb_build_object('s', 'Placed', 't', to_char(now() at time zone 'Asia/Kolkata', 'DD Mon YYYY HH24:MI')))
  where razorpay_order_id = p_razorpay_order_id and payment_status = 'pending'
  returning * into o;
  if found then
    for it in select * from jsonb_array_elements(o.items) loop
      update products set stock = greatest(stock - (it ->> 'q')::int, 0) where id = (it ->> 'id')::uuid;
    end loop;
  else
    select * into o from orders where razorpay_order_id = p_razorpay_order_id and payment_status = 'paid';
  end if;
  if o.id is null then return null; end if;
  return order_view(o);
end $$;
revoke execute on function finalize_order(text, text) from public, anon, authenticated;
grant execute on function finalize_order(text, text) to service_role;

insert into products (name, description, price_paise, stock, color) values
 ('Product One',   'One line description of product one.',   149900, 25, '#0f4c5c'),
 ('Product Two',   'One line description of product two.',   199900, 40, '#9a3b3b'),
 ('Product Three', 'One line description of product three.', 249900, 12, '#3d6b3d'),
 ('Product Four',  'One line description of product four.',  299900, 30, '#6b4a8f'),
 ('Product Five',  'One line description of product five.',  349900,  8, '#b5651d'),
 ('Product Six',   'One line description of product six.',   499900, 15, '#2f5d8a');

-- After creating your admin user (see SetUp.md), run:
-- insert into admins (email) values ('you@example.com');
