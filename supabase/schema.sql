-- ============================================================
-- MIEFLOW MULTI-USER FIX
-- ============================================================
-- Jalankan file ini SATU KALI di Supabase SQL Editor setelah
-- minimal satu akun Mieflow sudah terdaftar.
--
-- Hasil:
--   User A -> hanya data milik User A
--   User B -> hanya data milik User B
--   User baru -> dashboard kosong sampai membuat data sendiri
--
-- Data lama yang belum punya owner_id akan diberikan kepada
-- akun Supabase TERLAMA. Jika data lama seharusnya milik akun lain,
-- lihat bagian "PINDAHKAN DATA LAMA" di bawah.
-- ============================================================

create extension if not exists pgcrypto;

-- Buat tabel jika project masih kosong. Aman juga dijalankan pada project lama.
create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  color text not null default '#111827',
  created_at timestamptz not null default now(),
  owner_id uuid references auth.users(id) on delete cascade
);

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  price numeric(12,2) not null default 0 check(price>=0),
  cost numeric(12,2) not null default 0 check(cost>=0),
  stock integer not null default 0 check(stock>=0),
  image_url text,
  category_id uuid references public.categories(id) on delete set null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  owner_id uuid references auth.users(id) on delete cascade
);

create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text,
  email text,
  notes text,
  created_at timestamptz not null default now(),
  owner_id uuid references auth.users(id) on delete cascade
);

create table if not exists public.promotions (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text unique,
  discount_percent numeric(5,2) not null default 0 check(discount_percent between 0 and 100),
  active boolean not null default true,
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz not null default now(),
  owner_id uuid references auth.users(id) on delete cascade
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null unique,
  customer_id uuid references public.customers(id) on delete set null,
  status text not null default 'completed' check(status in('pending','completed','cancelled')),
  payment_method text not null default 'cash' check(payment_method in('cash','qris','card')),
  subtotal numeric(12,2) not null default 0,
  discount numeric(12,2) not null default 0,
  total numeric(12,2) not null default 0,
  amount_paid numeric(12,2) not null default 0,
  change_due numeric(12,2) not null default 0,
  created_at timestamptz not null default now(),
  cashier_id uuid references auth.users(id),
  owner_id uuid references auth.users(id) on delete cascade
);

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  product_name text not null,
  quantity integer not null check(quantity>0),
  unit_price numeric(12,2) not null default 0,
  line_total numeric(12,2) not null default 0,
  owner_id uuid references auth.users(id) on delete cascade
);

create table if not exists public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  quantity_delta integer not null,
  reason text not null,
  order_id uuid references public.orders(id) on delete set null,
  created_at timestamptz not null default now(),
  actor_id uuid references auth.users(id),
  owner_id uuid references auth.users(id) on delete cascade
);

create index if not exists products_category_idx on public.products(category_id);
create index if not exists orders_created_at_idx on public.orders(created_at desc);
create index if not exists order_items_order_idx on public.order_items(order_id);
create index if not exists stock_movements_product_idx on public.stock_movements(product_id,created_at desc);

-- ---------- Tambahkan owner_id ke semua tabel tenant ----------
alter table if exists public.categories add column if not exists owner_id uuid references auth.users(id) on delete cascade;
alter table if exists public.products add column if not exists owner_id uuid references auth.users(id) on delete cascade;
alter table if exists public.customers add column if not exists owner_id uuid references auth.users(id) on delete cascade;
alter table if exists public.promotions add column if not exists owner_id uuid references auth.users(id) on delete cascade;
alter table if exists public.orders add column if not exists owner_id uuid references auth.users(id) on delete cascade;
alter table if exists public.order_items add column if not exists owner_id uuid references auth.users(id) on delete cascade;
alter table if exists public.stock_movements add column if not exists owner_id uuid references auth.users(id) on delete cascade;

-- Pastikan kolom dasar tetap tersedia pada project lama.
alter table if exists public.products add column if not exists description text;
alter table if exists public.products add column if not exists price numeric(12,2) not null default 0;
alter table if exists public.products add column if not exists cost numeric(12,2) not null default 0;
alter table if exists public.products add column if not exists stock integer not null default 0;
alter table if exists public.products add column if not exists image_url text;
alter table if exists public.products add column if not exists category_id uuid;
alter table if exists public.products add column if not exists is_active boolean not null default true;
alter table if exists public.products add column if not exists created_at timestamptz not null default now();
alter table if exists public.products add column if not exists updated_at timestamptz not null default now();

create or replace function public.set_updated_at() returns trigger language plpgsql as $$ begin new.updated_at=now(); return new; end $$;
drop trigger if exists products_updated_at on public.products;
create trigger products_updated_at before update on public.products for each row execute function public.set_updated_at();

-- ---------- Backfill data lama ----------
-- Akun pertama/tertua dianggap sebagai pemilik data lama.
do $$
declare
  legacy_owner uuid;
begin
  select id into legacy_owner
  from auth.users
  order by created_at asc
  limit 1;

  if legacy_owner is not null then
    update public.categories set owner_id = legacy_owner where owner_id is null;
    update public.products set owner_id = legacy_owner where owner_id is null;
    update public.customers set owner_id = legacy_owner where owner_id is null;
    update public.promotions set owner_id = legacy_owner where owner_id is null;
    update public.orders set owner_id = coalesce(owner_id, cashier_id, legacy_owner) where owner_id is null;

    update public.order_items oi
    set owner_id = o.owner_id
    from public.orders o
    where oi.order_id = o.id and oi.owner_id is null;

    update public.stock_movements sm
    set owner_id = coalesce(o.owner_id, p.owner_id, legacy_owner)
    from public.products p
    left join public.orders o on o.id = sm.order_id
    where sm.product_id = p.id and sm.owner_id is null;
  end if;
end $$;

-- Jika ada order lama yang owner_id masih kosong, ambil dari cashier_id.
update public.orders
set owner_id = cashier_id
where owner_id is null and cashier_id is not null;

update public.order_items oi
set owner_id = o.owner_id
from public.orders o
where oi.order_id = o.id and oi.owner_id is null and o.owner_id is not null;

update public.stock_movements sm
set owner_id = coalesce(o.owner_id, p.owner_id)
from public.products p
left join public.orders o on o.id = sm.order_id
where sm.product_id = p.id and sm.owner_id is null;

-- ---------- Index ----------
create index if not exists categories_owner_idx on public.categories(owner_id);
create index if not exists products_owner_idx on public.products(owner_id);
create index if not exists customers_owner_idx on public.customers(owner_id);
create index if not exists promotions_owner_idx on public.promotions(owner_id);
create index if not exists orders_owner_idx on public.orders(owner_id, created_at desc);
create index if not exists order_items_owner_idx on public.order_items(owner_id);
create index if not exists stock_movements_owner_idx on public.stock_movements(owner_id, created_at desc);

-- Nama kategori boleh sama di toko yang berbeda.
do $$
declare
  c record;
begin
  for c in
    select conname
    from pg_constraint
    where conrelid = 'public.categories'::regclass
      and contype = 'u'
      and pg_get_constraintdef(oid) ilike '%(name)%'
  loop
    execute format('alter table public.categories drop constraint if exists %I', c.conname);
  end loop;
exception when undefined_table then
  null;
end $$;
create unique index if not exists categories_owner_name_unique on public.categories(owner_id, name);

-- ---------- RLS ----------
alter table public.categories enable row level security;
alter table public.products enable row level security;
alter table public.customers enable row level security;
alter table public.promotions enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.stock_movements enable row level security;

do $$
declare t text;
begin
  foreach t in array array['categories','products','customers','promotions','orders','order_items','stock_movements'] loop
    execute format('drop policy if exists "auth read" on public.%I',t);
    execute format('drop policy if exists "auth insert" on public.%I',t);
    execute format('drop policy if exists "auth update" on public.%I',t);
    execute format('drop policy if exists "auth delete" on public.%I',t);
    execute format('drop policy if exists "mieflow tenant select" on public.%I',t);
    execute format('drop policy if exists "mieflow tenant insert" on public.%I',t);
    execute format('drop policy if exists "mieflow tenant update" on public.%I',t);
    execute format('drop policy if exists "mieflow tenant delete" on public.%I',t);
    execute format('create policy "mieflow tenant select" on public.%I for select to authenticated using (owner_id = auth.uid())',t);
    execute format('create policy "mieflow tenant insert" on public.%I for insert to authenticated with check (owner_id = auth.uid())',t);
    execute format('create policy "mieflow tenant update" on public.%I for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid())',t);
    execute format('create policy "mieflow tenant delete" on public.%I for delete to authenticated using (owner_id = auth.uid())',t);
  end loop;
end $$;

-- ---------- Storage ----------
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('product-images','product-images',true,5242880,array['image/jpeg','image/png','image/webp','image/gif'])
on conflict(id) do update set public=true,file_size_limit=5242880,allowed_mime_types=array['image/jpeg','image/png','image/webp','image/gif'];

drop policy if exists "product images public read" on storage.objects;
drop policy if exists "product images auth upload" on storage.objects;
drop policy if exists "product images auth update" on storage.objects;
drop policy if exists "product images auth delete" on storage.objects;
drop policy if exists "mieflow product images auth upload" on storage.objects;
drop policy if exists "mieflow product images auth update" on storage.objects;
drop policy if exists "mieflow product images auth delete" on storage.objects;
create policy "product images public read" on storage.objects for select using(bucket_id='product-images');
create policy "mieflow product images auth upload" on storage.objects
  for insert to authenticated
  with check (bucket_id='product-images' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "mieflow product images auth update" on storage.objects
  for update to authenticated
  using (bucket_id='product-images' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id='product-images' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "mieflow product images auth delete" on storage.objects
  for delete to authenticated
  using (bucket_id='product-images' and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------- Atomic checkout, tenant-safe ----------
create or replace function public.create_sale(
  p_customer_id uuid,
  p_payment_method text,
  p_amount_paid numeric,
  p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_user uuid := auth.uid();
  v_order_id uuid;
  v_number text;
  v_subtotal numeric := 0;
  v_total numeric := 0;
  v_paid numeric := coalesce(p_amount_paid,0);
  v_change numeric := 0;
  item jsonb;
  v_product public.products%rowtype;
  v_qty int;
  v_price numeric;
  v_customer_owner uuid;
begin
  if v_user is null then raise exception 'Login diperlukan'; end if;
  if p_items is null or jsonb_array_length(p_items)=0 then raise exception 'Keranjang kosong'; end if;
  if p_payment_method not in ('cash','qris','card') then raise exception 'Metode pembayaran tidak valid'; end if;

  if p_customer_id is not null then
    select owner_id into v_customer_owner
    from public.customers
    where id=p_customer_id;
    if v_customer_owner is distinct from v_user then
      raise exception 'Pelanggan bukan milik akun ini';
    end if;
  end if;

  for item in select * from jsonb_array_elements(p_items) loop
    v_qty := (item->>'quantity')::int;
    if v_qty is null or v_qty <= 0 then raise exception 'Jumlah produk tidak valid'; end if;

    select * into v_product
    from public.products
    where id=(item->>'product_id')::uuid
      and owner_id=v_user
      and is_active=true
    for update;

    if not found then raise exception 'Produk tidak ditemukan pada akun ini atau nonaktif'; end if;
    if v_product.stock < v_qty then raise exception 'Stok % tidak mencukupi (tersisa %)',v_product.name,v_product.stock; end if;
    v_subtotal := v_subtotal + v_product.price*v_qty;
  end loop;

  v_total := v_subtotal;
  if p_payment_method='cash' and v_paid<v_total then raise exception 'Uang tunai kurang'; end if;
  if p_payment_method<>'cash' then v_paid:=v_total; end if;
  v_change:=greatest(v_paid-v_total,0);
  v_number:='MF-'||to_char(now(),'YYMMDDHH24MISS')||'-'||substr(replace(gen_random_uuid()::text,'-',''),1,4);

  insert into public.orders(owner_id,order_number,customer_id,status,payment_method,subtotal,total,amount_paid,change_due,cashier_id)
  values(v_user,v_number,p_customer_id,'completed',p_payment_method,v_subtotal,v_total,v_paid,v_change,v_user)
  returning id into v_order_id;

  for item in select * from jsonb_array_elements(p_items) loop
    select * into v_product
    from public.products
    where id=(item->>'product_id')::uuid
      and owner_id=v_user
    for update;
    v_qty:=(item->>'quantity')::int;
    v_price:=v_product.price;

    insert into public.order_items(owner_id,order_id,product_id,product_name,quantity,unit_price,line_total)
    values(v_user,v_order_id,v_product.id,v_product.name,v_qty,v_price,v_price*v_qty);

    update public.products
    set stock=stock-v_qty, updated_at=now()
    where id=v_product.id and owner_id=v_user;

    insert into public.stock_movements(owner_id,product_id,quantity_delta,reason,order_id,actor_id)
    values(v_user,v_product.id,-v_qty,'sale',v_order_id,v_user);
  end loop;

  return jsonb_build_object('id',v_order_id,'order_number',v_number,'total',v_total,'amount_paid',v_paid,'change_due',v_change);
end $$;

revoke all on function public.create_sale(uuid,text,numeric,jsonb) from public;
grant execute on function public.create_sale(uuid,text,numeric,jsonb) to authenticated;

grant usage on schema public to authenticated;
grant select,insert,update,delete on public.categories,public.products,public.customers,public.promotions,public.orders,public.order_items,public.stock_movements to authenticated;

notify pgrst, 'reload schema';

-- ============================================================
-- CEK SETELAH RUN
-- ============================================================
-- select id,email from auth.users order by created_at;
-- select owner_id,count(*) from public.products group by owner_id;
-- select owner_id,count(*) from public.categories group by owner_id;
-- select owner_id,count(*) from public.customers group by owner_id;
-- select owner_id,count(*) from public.orders group by owner_id;
-- ============================================================


-- FINAL FIX COMPATIBILITY MIGRATION
-- MIEFLOW FINAL FIX
-- Jalankan file ini di Supabase SQL Editor sekali.

alter table public.orders add column if not exists notes text;

-- Izinkan metode baru sambil tetap kompatibel dengan transaksi lama qris/card.
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conrelid='public.orders'::regclass and conname='orders_payment_method_check'
  ) then
    alter table public.orders drop constraint orders_payment_method_check;
  end if;
end $$;

alter table public.orders
  add constraint orders_payment_method_check
  check (payment_method in ('cash','ewallet','atm','qris','card'));

create or replace function public.create_sale(
  p_customer_id uuid,
  p_payment_method text,
  p_amount_paid numeric,
  p_items jsonb,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_user uuid := auth.uid();
  v_order_id uuid;
  v_number text;
  v_subtotal numeric := 0;
  v_total numeric := 0;
  v_paid numeric := coalesce(p_amount_paid,0);
  v_change numeric := 0;
  item jsonb;
  v_product public.products%rowtype;
  v_qty int;
  v_price numeric;
  v_customer_owner uuid;
begin
  if v_user is null then raise exception 'Login diperlukan'; end if;
  if p_items is null or jsonb_array_length(p_items)=0 then raise exception 'Keranjang kosong'; end if;
  if p_payment_method not in ('cash','ewallet','atm') then raise exception 'Metode pembayaran tidak valid'; end if;

  if p_customer_id is not null then
    select owner_id into v_customer_owner from public.customers where id=p_customer_id;
    if v_customer_owner is distinct from v_user then raise exception 'Pelanggan bukan milik akun ini'; end if;
  end if;

  for item in select * from jsonb_array_elements(p_items) loop
    v_qty := (item->>'quantity')::int;
    if v_qty is null or v_qty <= 0 then raise exception 'Jumlah produk tidak valid'; end if;
    select * into v_product from public.products
      where id=(item->>'product_id')::uuid and owner_id=v_user and is_active=true for update;
    if not found then raise exception 'Produk tidak ditemukan pada akun ini atau nonaktif'; end if;
    if v_product.stock < v_qty then raise exception 'Stok % tidak mencukupi (tersisa %)',v_product.name,v_product.stock; end if;
    v_subtotal := v_subtotal + v_product.price*v_qty;
  end loop;

  v_total := v_subtotal;
  if p_payment_method='cash' and v_paid<v_total then raise exception 'Uang tunai kurang'; end if;
  if p_payment_method<>'cash' then v_paid:=v_total; end if;
  v_change:=greatest(v_paid-v_total,0);
  v_number:='MF-'||to_char(now(),'YYMMDDHH24MISS')||'-'||substr(replace(gen_random_uuid()::text,'-',''),1,4);

  insert into public.orders(owner_id,order_number,customer_id,status,payment_method,subtotal,total,amount_paid,change_due,cashier_id,notes)
  values(v_user,v_number,p_customer_id,'completed',p_payment_method,v_subtotal,v_total,v_paid,v_change,v_user,nullif(trim(coalesce(p_note,'')),''))
  returning id into v_order_id;

  for item in select * from jsonb_array_elements(p_items) loop
    select * into v_product from public.products where id=(item->>'product_id')::uuid and owner_id=v_user for update;
    v_qty:=(item->>'quantity')::int;
    v_price:=v_product.price;
    insert into public.order_items(owner_id,order_id,product_id,product_name,quantity,unit_price,line_total)
    values(v_user,v_order_id,v_product.id,v_product.name,v_qty,v_price,v_price*v_qty);
    update public.products set stock=stock-v_qty, updated_at=now() where id=v_product.id and owner_id=v_user;
    insert into public.stock_movements(owner_id,product_id,quantity_delta,reason,order_id,actor_id)
    values(v_user,v_product.id,-v_qty,'sale',v_order_id,v_user);
  end loop;

  return jsonb_build_object('id',v_order_id,'order_number',v_number,'total',v_total,'amount_paid',v_paid,'change_due',v_change,'notes',nullif(trim(coalesce(p_note,'')),''));
end $$;

revoke all on function public.create_sale(uuid,text,numeric,jsonb,text) from public;
grant execute on function public.create_sale(uuid,text,numeric,jsonb,text) to authenticated;
notify pgrst, 'reload schema';
