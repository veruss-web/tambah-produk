'use client';
import { useEffect,useMemo,useRef,useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence,motion } from 'framer-motion';
import { BarChart3,Box,Check,ChevronDown,ChevronRight,CalendarDays,CircleDollarSign,CreditCard,Edit3,LayoutDashboard,LogOut,Menu,Moon,Package,Plus,Search,Settings,ShoppingBag,Sparkles,Sun,Tags,Trash2,TrendingUp,Users,WalletCards,X,UploadCloud,ImageIcon,Printer,Mail,LockKeyhole,UserRound,Eye,EyeOff,ShieldCheck,CheckCircle2,ArrowRight,AlertTriangle,PackageOpen,Boxes,MapPin,Clock3,MoreHorizontal,SlidersHorizontal,RefreshCw,Bell,Maximize2,Minimize2,CupSoda,Sandwich,Popcorn,CakeSlice,Gift,Coffee,Soup,Bottle } from 'lucide-react';
import { ensureFreshSession, friendlySupabaseError, isSupabaseConfigured, runWithAuthRetry, supabase } from '../lib/supabase';

type Page='Overview'|'POS'|'Orders'|'Analytics'|'Products'|'Categories'|'Promotions'|'Customers'|'Inventory'|'Settings';
type Category={id:string;name:string;color:string;created_at?:string;owner_id?:string};
type Product={id:string;name:string;description:string|null;price:number;cost:number;stock:number;image_url:string|null;category_id:string|null;is_active:boolean;owner_id?:string;categories?:Category|null};
type Customer={id:string;name:string;phone:string|null;email:string|null;notes:string|null;owner_id?:string};
type Order={id:string;order_number:string;customer_id?:string|null;status:string;payment_method:string;subtotal:number;discount:number;total:number;amount_paid:number;change_due:number;notes?:string|null;created_at:string;owner_id?:string;customers?:Customer|null};
type OrderItem={id:string;order_id:string;product_id?:string|null;product_name:string;quantity:number;unit_price:number;line_total:number;owner_id?:string};
type CartItem=Product&{qty:number};
type AppNotification={id:string;type:'danger'|'warning'|'success'|'info';title:string;detail:string;time:string;page:Page;targetId?:string|null;is_read?:boolean;created_at?:string};
const nav:[string,Page,any][]= [['Overview','Overview',LayoutDashboard],['Kasir','POS',ShoppingBag],['Riwayat Transaksi','Orders',WalletCards],['Analisis','Analytics',BarChart3],['Produk','Products',Package],['Kategori','Categories',Tags],['Pelanggan','Customers',Users],['Inventory','Inventory',Box]];
const money=(n:number)=>new Intl.NumberFormat('id-ID',{style:'currency',currency:'IDR',maximumFractionDigits:0}).format(n||0);
type CustomerTarget={name:string;qty:number};
const normalizeProductName=(value:string)=>{
 const numberWords:Record<string,string>={
  nol:'0',satu:'1',dua:'2',tiga:'3',empat:'4',lima:'5',enam:'6',tujuh:'7',delapan:'8',sembilan:'9',sepuluh:'10',
  sebelas:'11',duabelas:'12',tigabelas:'13',empatbelas:'14',limabelas:'15',enambelas:'16',tujuhbelas:'17',delapanbelas:'18',sembilanbelas:'19',
  'dua puluh':'20','tiga puluh':'30','empat puluh':'40','lima puluh':'50','enam puluh':'60','tujuh puluh':'70','delapan puluh':'80','sembilan puluh':'90'
 };
 let text=String(value||'').toLowerCase().replace(/[^a-z0-9\s]/g,' ').replace(/\s+/g,' ').trim();
 // Samakan penulisan angka Indonesia agar "level tiga" dan "level 3" dianggap produk yang sama.
 Object.entries(numberWords).sort((a,b)=>b[0].length-a[0].length).forEach(([word,digit])=>{
  text=text.replace(new RegExp(`\\b${word.replace(/ /g,'\\s+')}\\b`,'g'),digit);
 });
 return text.replace(/\s+/g,' ').trim();
};
const parseCustomerTargets=(customer:Customer):CustomerTarget[]=>{
 const text=String(customer.notes||'').replace(/\r/g,'').trim();
 if(!text)return [];
 const lines=text.split(/\n|[,;]+/).map(x=>x.trim()).filter(Boolean);
 const out:CustomerTarget[]=[];
 const add=(name:string,qty:number)=>{
  const clean=name.replace(/^(pesan|pesanan|target|order)\s*/i,'').trim();
  if(!clean||!qty)return;
  const key=normalizeProductName(clean);
  const existing=out.find(x=>normalizeProductName(x.name)===key);
  if(existing)existing.qty+=qty; else out.push({name:clean,qty});
 };
 lines.forEach(line=>{
  // Ambil ANGKA TERAKHIR sebagai jumlah pesanan. Angka yang berada
  // di dalam nama produk tetap menjadi bagian dari nama, misalnya:
  // "Mie Level 3 10" => nama "Mie Level 3", qty 10.
  const cleanLine=line.replace(/^(pesan|pesanan|target|order)\s*/i,'').trim();
  const finalQty=cleanLine.match(/^(.+?)\s+(?:x\s*)?(\d+)\s*(?:mie|porsi|pcs|buah|item)?$/i);
  if(finalQty){
   add(finalQty[1].trim(),Number(finalQty[2]));
   return;
  }
  // Bentuk alternatif: "Mie Level 3 x 10".
  const xQty=cleanLine.match(/^(.+?)\s+x\s*(\d+)\s*$/i);
  if(xQty){
   add(xQty[1].trim(),Number(xQty[2]));
   return;
  }
  // Jika tidak ada jumlah di akhir, jangan menebak angka dari tengah nama produk.
 });
 return out;
};
const getCustomerFulfillment=(customerId:string,targets:CustomerTarget[],orders:Order[],orderItems:OrderItem[],products:Product[]=[] )=>{
 const completedItems=orders.filter(o=>o.customer_id===customerId&&o.status==='completed').flatMap(o=>orderItems.filter(i=>i.order_id===o.id));
 return targets.map(target=>{
  const wanted=normalizeProductName(target.name);
  // Target pelanggan boleh dibuat SEBELUM menu dibuat.
  // Setelah menu tersedia, pencocokan WAJIB memakai product_id agar transaksi
  // tidak pernah masuk ke produk lain yang hanya memiliki nama mirip.
  const product=products.find(p=>normalizeProductName(p.name)===wanted);
  const fulfilled=completedItems.filter(i=>{
   if(product) return i.product_id===product.id;
   // Belum ada menu: hanya dukung transaksi lama yang memang menyimpan nama
   // produk persis. Ini tidak boleh dipakai untuk mencocokkan nama yang mirip.
   return !i.product_id && normalizeProductName(i.product_name)===wanted;
  }).reduce((sum,i)=>sum+Number(i.quantity||0),0);
  return {...target,name:product?.name||target.name,fulfilled:Math.min(fulfilled,target.qty),productExists:!!product,productId:product?.id||null};
 });
};
const isCustomerOrderComplete=(customer:Customer,orders:Order[],orderItems:OrderItem[],products:Product[]=[] )=>{
 const targets=parseCustomerTargets(customer);
 if(!targets.length)return orders.some(o=>o.customer_id===customer.id&&o.status==='completed');
 return getCustomerFulfillment(customer.id,targets,orders,orderItems,products).every(x=>x.fulfilled>=x.qty);
};

// Ubah informasi ini sesuai data toko Anda. Informasi akan tampil pada struk thermal 58 mm dan 80 mm.
const RECEIPT_STORE={
 name:'Warung Mie',
 address:'Alamat toko • Kota Anda',
 phone:'',
 footer:'Terima kasih atas kunjungan Anda. Selamat menikmati!'
};
async function uploadImageDataUrl(dataUrl:string){
 const response=await fetch(dataUrl);
 const blob=await response.blob();
 const userId=(await ensureFreshSession())?.user.id;
 if(!userId) throw new Error('Sesi login tidak ditemukan.');
 const path=`${userId}/products/${crypto.randomUUID()}.webp`;
 const result=await runWithAuthRetry(()=>supabase.storage.from('product-images').upload(path,blob,{contentType:'image/webp',upsert:false,cacheControl:'3600'}));
 if(result.error) throw result.error;
 const publicUrl=supabase.storage.from('product-images').getPublicUrl(path).data.publicUrl;
 if(!publicUrl) throw new Error('URL foto tidak tersedia.');
 return publicUrl;
}


export default function Home(){
 const [session,setSession]=useState<any>(null),[authLoading,setAuthLoading]=useState(true);
 useEffect(()=>{
  if(!isSupabaseConfigured){setAuthLoading(false);return;}
  supabase.auth.getSession().then(({data})=>{setSession(data.session);setAuthLoading(false)});
  const {data}=supabase.auth.onAuthStateChange((_e,s)=>setSession(s));
  return()=>data.subscription.unsubscribe();
 },[]);
 if(!isSupabaseConfigured)return <ConfigError/>;
 if(authLoading)return <div className="auth-screen"><div className="spinner"/> Memuat Mieflow…</div>;
 if(!session)return <Login/>;
 return <Dashboard session={session}/>;
}

function ConfigError(){return <div className="auth-screen"><div className="login-card"><div className="brand-logo big">M</div><span className="eyebrow">MIEFLOW POS</span><h1>Konfigurasi belum lengkap</h1><p>Deployment Vercel berhasil dibuat, tetapi environment variable Supabase belum dipasang. Tambahkan <b>NEXT_PUBLIC_SUPABASE_URL</b> dan <b>NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY</b> di Vercel, lalu lakukan redeploy.</p><div className="error">Vercel → Project → Settings → Environment Variables</div></div></div>}

function Login(){
 const [mode,setMode]=useState<'login'|'signup'>('login');
 const [name,setName]=useState('');
 const [email,setEmail]=useState('');
 const [password,setPassword]=useState('');
 const [confirm,setConfirm]=useState('');
 const [showPassword,setShowPassword]=useState(false);
 const [loading,setLoading]=useState(false);
 const [error,setError]=useState('');
 const [success,setSuccess]=useState('');
 const [signedUp,setSignedUp]=useState(false);
 const passwordScore=[password.length>=8,/\d/.test(password),/[A-Z]/.test(password),/[^A-Za-z0-9]/.test(password)].filter(Boolean).length;
 const submit=async(e:any)=>{
  e.preventDefault();setLoading(true);setError('');setSuccess('');
  if(mode==='signup'){
   if(name.trim().length<2){setError('Nama minimal 2 karakter.');setLoading(false);return}
   if(password.length<8){setError('Password minimal 8 karakter.');setLoading(false);return}
   if(password!==confirm){setError('Konfirmasi password belum sama.');setLoading(false);return}
   const {data,error}=await supabase.auth.signUp({email:email.trim(),password,options:{data:{full_name:name.trim(),role:'cashier'}}});
   if(error)setError(error.message);
   else if(data.session){setSuccess('Akun berhasil dibuat. Selamat datang di Mieflow.');}
   else {setSignedUp(true);setSuccess('Akun berhasil dibuat. Cek email untuk konfirmasi sebelum masuk.');}
  }else{
   const {data,error}=await supabase.auth.signInWithPassword({email:email.trim(),password});
   if(error)setError(error.message);
   else if(!data.session)setError('Login berhasil tetapi sesi belum tersedia. Coba masuk lagi.');
  }
  setLoading(false);
 };
 const switchMode=(next:'login'|'signup')=>{setMode(next);setError('');setSuccess('');setSignedUp(false);setPassword('');setConfirm('')};
 if(signedUp)return <div className="auth-screen auth-modern"><div className="auth-glow glow-one"/><div className="auth-glow glow-two"/><div className="auth-layout"><AuthBrand/><motion.div className="auth-panel success-panel" initial={{opacity:0,y:18}} animate={{opacity:1,y:0}}><div className="success-icon"><CheckCircle2 size={32}/></div><span className="eyebrow">AKUN SIAP</span><h1>Konfirmasi email</h1><p>Kami sudah mengirim email konfirmasi ke <b>{email}</b>. Buka email tersebut, lalu kembali ke Mieflow untuk masuk.</p><div className="info-card"><Mail size={18}/><div><b>Belum menerima email?</b><small>Periksa folder Spam/Promosi atau tunggu beberapa menit.</small></div></div><button className="primary wide" onClick={()=>switchMode('login')}>Kembali ke halaman masuk <ArrowRight size={17}/></button></motion.div></div></div>;
 return <div className="auth-screen auth-modern"><div className="auth-glow glow-one"/><div className="auth-glow glow-two"/><div className="auth-layout"><AuthBrand/><motion.form className="auth-panel" initial={{opacity:0,y:18}} animate={{opacity:1,y:0}} transition={{duration:.35}} onSubmit={submit}>
   <div className="auth-panel-head"><div><span className="eyebrow">MIEFLOW POS</span><h1>{mode==='login'?'Selamat datang kembali':'Buat akun baru'}</h1><p>{mode==='login'?'Masuk untuk mengelola toko dan transaksi.':'Daftarkan email untuk akses Admin/Kasir.'}</p></div><div className="secure-badge"><ShieldCheck size={15}/> Secure</div></div>
   <div className="auth-tabs"><button type="button" className={mode==='login'?'active':''} onClick={()=>switchMode('login')}>Masuk</button><button type="button" className={mode==='signup'?'active':''} onClick={()=>switchMode('signup')}>Daftar akun</button></div>
   {error&&<div className="error auth-error"><span>{error}</span></div>}{success&&<div className="success-banner"><CheckCircle2 size={17}/><span>{success}</span></div>}
   {mode==='signup'&&<AuthField icon={UserRound} label="Nama lengkap" value={name} onChange={setName} placeholder="Contoh: Budi Santoso" required/>}
   <AuthField icon={Mail} label="Email" type="email" value={email} onChange={setEmail} placeholder="nama@contoh.com" required/>
   <AuthField icon={LockKeyhole} label="Password" type={showPassword?'text':'password'} value={password} onChange={setPassword} placeholder={mode==='signup'?'Minimal 8 karakter':'Masukkan password'} required trailing={<button type="button" className="field-action" onClick={()=>setShowPassword(!showPassword)} aria-label={showPassword?'Sembunyikan password':'Tampilkan password'}>{showPassword?<EyeOff size={17}/>:<Eye size={17}/>}</button>}/>
   {mode==='signup'&&<><div className="password-meter"><div><span>Kekuatan password</span><b>{passwordScore<2?'Lemah':passwordScore<4?'Sedang':'Kuat'}</b></div><i><em style={{width:`${Math.max(8,passwordScore*25)}%`}}/></i><small>Gunakan 8+ karakter, angka, huruf besar, dan simbol.</small></div><AuthField icon={LockKeyhole} label="Ulangi password" type={showPassword?'text':'password'} value={confirm} onChange={setConfirm} placeholder="Ketik ulang password" required/></>}
   {mode==='login'&&<div className="auth-options"><span>Gunakan akun Supabase terdaftar</span><button type="button" onClick={()=>{setMode('signup');setError('')}}>Belum punya akun?</button></div>}
   {mode==='signup'&&<label className="terms"><input type="checkbox" required/> <span>Saya setuju akun ini digunakan untuk operasional Mieflow.</span></label>}
   <button className="auth-submit" disabled={loading}>{loading?<><span className="mini-spinner"/> Memproses…</>:mode==='login'?<>Masuk ke dashboard <ArrowRight size={17}/></>:<>Buat akun Mieflow <ArrowRight size={17}/></>}</button>
   <div className="auth-foot"><span>🔒 Data autentikasi diamankan oleh Supabase</span></div>
 </motion.form></div></div>
}
function AuthBrand(){return <div className="auth-brand"><div className="brand-logo auth-logo">M</div><span className="eyebrow light">BUSINESS POS</span><h2>Operasional toko,<br/><em>lebih rapi.</em></h2><p>Kelola penjualan, stok, pelanggan, dan transaksi dalam satu dashboard yang cepat dan modern.</p><div className="auth-points"><div><CheckCircle2 size={17}/><span>Kasir terpusat & real-time</span></div><div><CheckCircle2 size={17}/><span>Inventory lebih mudah dipantau</span></div><div><CheckCircle2 size={17}/><span>Akses aman berbasis akun</span></div></div><small className="auth-version">MIEFLOW • BUSINESS POS</small></div>}
function AuthField({icon:Icon,label,value,onChange,type='text',placeholder='',required=false,trailing}:any){return <label className="auth-field"><span>{label}</span><div><Icon size={17}/><input required={required} type={type} value={value??''} onChange={e=>onChange(e.target.value)} placeholder={placeholder}/>{trailing}</div></label>}

function CustomerPicker({customers,value,onChange}:{customers:Customer[];value:string;onChange:(value:string)=>void}){
 const [open,setOpen]=useState(false);
 const [search,setSearch]=useState('');
 const [mounted,setMounted]=useState(false);
 const triggerRef=useRef<HTMLButtonElement|null>(null);
 const menuRef=useRef<HTMLDivElement|null>(null);
 const selected=customers.find(c=>c.id===value);
 const filtered=customers.filter(c=>`${c.name} ${c.phone||''} ${c.email||''}`.toLowerCase().includes(search.trim().toLowerCase()));
 useEffect(()=>{if(value&&!customers.some(c=>c.id===value))onChange('')},[value,customers,onChange]);
 useEffect(()=>{setMounted(true)},[]);
 useEffect(()=>{
  if(!open)return;
  const close=(e:PointerEvent)=>{const target=e.target as Node;if(triggerRef.current?.contains(target)||menuRef.current?.contains(target))return;setOpen(false)};
  const key=(e:KeyboardEvent)=>{if(e.key==='Escape')setOpen(false)};
  document.addEventListener('pointerdown',close);document.addEventListener('keydown',key);
  return()=>{document.removeEventListener('pointerdown',close);document.removeEventListener('keydown',key)};
 },[open]);
 useEffect(()=>{if(!open)setSearch('')},[open]);
 const choose=(id:string)=>{onChange(id);setOpen(false)};
 const menu=open?<><div className="customer-picker-overlay" onPointerDown={()=>setOpen(false)} aria-hidden="true"/><div ref={menuRef} className="customer-picker-menu customer-picker-portal" role="dialog" aria-label="Pilih pelanggan">
  <div className="customer-picker-head"><div><span>PILIH PELANGGAN</span><b>{customers.length+1} pilihan</b></div><button type="button" onClick={()=>setOpen(false)} aria-label="Tutup"><X size={17}/></button></div>
  <label className="customer-picker-search"><Search size={16}/><input autoFocus value={search} onChange={e=>setSearch(e.target.value)} placeholder="Cari nama atau nomor telepon..."/></label>
  <div className="customer-picker-list">
   <button type="button" className={!value?'active':''} onClick={()=>choose('')} role="option" aria-selected={!value}><span className="customer-picker-avatar general"><Users size={17}/></span><span><b>Pelanggan umum</b><small>Transaksi tanpa data pelanggan</small></span>{!value&&<Check size={17}/>}</button>
   {filtered.map(c=><button type="button" key={c.id} className={value===c.id?'active':''} onClick={()=>choose(c.id)} role="option" aria-selected={value===c.id}><span className="customer-picker-avatar">{(c.name||'?').slice(0,1).toUpperCase()}</span><span><b>{c.name}</b><small>{c.phone||c.email||'Data kontak belum diisi'}</small></span>{value===c.id&&<Check size={17}/>}</button>)}
   {!filtered.length&&<div className="customer-picker-empty"><Search size={22}/><b>Pelanggan tidak ditemukan</b><span>Coba nama atau nomor telepon lain.</span></div>}
  </div>
 </div></>:null;
 return <div className={`customer-picker ${open?'open':''}`}>
  <button ref={triggerRef} type="button" className="customer-picker-trigger" onClick={()=>setOpen(v=>!v)} aria-expanded={open} aria-haspopup="dialog"><div><span className={`customer-picker-avatar ${!selected?'general':''}`}>{selected?(selected.name||'?').slice(0,1).toUpperCase():'U'}</span><span className="customer-picker-selected"><b>{selected?.name||'Pelanggan umum'}</b><small>{selected?.phone||'Transaksi tanpa data pelanggan'}</small></span></div><ChevronDown size={17}/></button>
  {mounted&&menu&&createPortal(menu,document.body)}
 </div>
}
function Dashboard({session}:{session:any}){
 const [page,setPage]=useState<Page>('Overview'),[dark,setDark]=useState(false),[mobile,setMobile]=useState(false),[products,setProducts]=useState<Product[]>([]),[categories,setCategories]=useState<Category[]>([]),[customers,setCustomers]=useState<Customer[]>([]),[orders,setOrders]=useState<Order[]>([]),[orderItems,setOrderItems]=useState<OrderItem[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState(''),[toast,setToast]=useState(''),[modal,setModal]=useState<any>(null),[editing,setEditing]=useState<any>(null),[query,setQuery]=useState(''),[notificationsOpen,setNotificationsOpen]=useState(false),[notificationFilter,setNotificationFilter]=useState<'all'|'unread'|'transactions'|'stock'|'activity'>('all'),[activityNotifications,setActivityNotifications]=useState<AppNotification[]>([]),[readNotificationIds,setReadNotificationIds]=useState<string[]>([]),[notificationFlash,setNotificationFlash]=useState<any>(null),[isFullscreen,setIsFullscreen]=useState(false),[selectedOrder,setSelectedOrder]=useState<Order|null>(null),[selectedNotification,setSelectedNotification]=useState<any>(null),[deleteConfirm,setDeleteConfirm]=useState<any>(null);
 useEffect(()=>{
  if(typeof document==='undefined') return;
  document.body.style.overflow=mobile?'hidden':'';
  return()=>{document.body.style.overflow='';};
 },[mobile]);

 const load=async()=>{
  setLoading(true); setError('');
  try {
   const sessionNow=await ensureFreshSession();
   if(!sessionNow){setError('Sesi login tidak ditemukan. Silakan masuk kembali.');return;}

   // Produk adalah data inti. Modul lain tidak boleh membuat halaman Products ikut mati.
   const productsResult=await runWithAuthRetry(()=>supabase.from('products').select('*').eq('owner_id',sessionNow.user.id).order('created_at',{ascending:false}));
   if(productsResult.error) throw productsResult.error;
   setProducts((productsResult.data||[]) as Product[]);

   // Data pendukung dimuat terpisah dan boleh kosong jika modulnya belum dibuat.
   const [categoriesResult,customersResult,ordersResult,orderItemsResult]=await Promise.all([
    runWithAuthRetry(()=>supabase.from('categories').select('*').eq('owner_id',sessionNow.user.id).order('name')),
    runWithAuthRetry(()=>supabase.from('customers').select('*').eq('owner_id',sessionNow.user.id).order('created_at',{ascending:false})),
    runWithAuthRetry(()=>supabase.from('orders').select('*').eq('owner_id',sessionNow.user.id).order('created_at',{ascending:false}).limit(1000)),
    runWithAuthRetry(()=>supabase.from('order_items').select('*').eq('owner_id',sessionNow.user.id).limit(5000))
   ]);
   const categoryRows=(categoriesResult.data||[]) as Category[];
   const customerRows=(customersResult.data||[]) as Customer[];
   const orderRows=(ordersResult.data||[]) as Order[];
   const orderItemRows=(orderItemsResult.data||[]) as OrderItem[];
   setCategories(categoryRows);
   setCustomers(customerRows);
   const categoryMap=new Map(categoryRows.map(x=>[x.id,x]));
   const customerMap=new Map(customerRows.map(x=>[x.id,x]));
   setProducts(current=>current.map(x=>({...x,categories:x.category_id?categoryMap.get(x.category_id)||null:null})));
   setOrders(orderRows.map(x=>({...x,customers:x.customer_id?customerMap.get(x.customer_id)||null:null})));
   setOrderItems(orderItemRows);

   const optionalErrors=[categoriesResult.error,customersResult.error,ordersResult.error,orderItemsResult.error].filter(Boolean);
   if(optionalErrors.length){
    // Products tetap usable; modul pendukung yang belum siap tidak memblokir CRUD produk.
    console.warn('Mieflow optional modules:', optionalErrors);
   }
  } catch(err:any){setError(friendlySupabaseError(err));}
  finally{setLoading(false);}
 };
 useEffect(()=>{
  const loadNotifications=async()=>{
   try{
    const result=await runWithAuthRetry(()=>supabase.from('notifications').select('*').eq('owner_id',session.user.id).order('created_at',{ascending:false}).limit(100));
    if(result.error){console.warn('Notifications belum tersedia di database:',result.error.message);setActivityNotifications([]);setReadNotificationIds([]);return;}
    const rows=(result.data||[]).map((n:any)=>({id:n.id,type:n.type,title:n.title,detail:n.detail,time:n.created_at?new Date(n.created_at).toLocaleString('id-ID'):'Baru saja',page:n.page as Page,targetId:n.target_id,is_read:n.is_read,created_at:n.created_at}));
    setActivityNotifications(rows);
    setReadNotificationIds(rows.filter((n:any)=>n.is_read).map((n:any)=>n.id));
   }catch(err){console.warn('Gagal memuat notifikasi',err);}
  };
  loadNotifications();
 },[session.user.id]);
 useEffect(()=>{load()},[]);
 useEffect(()=>{
  if(!session?.user?.id) return;
  let active=true;
  const channel=supabase.channel(`mieflow-live-${session.user.id}`)
   .on('postgres_changes',{event:'*',schema:'public',table:'orders',filter:`owner_id=eq.${session.user.id}`},payload=>{
    if(!active)return;
    const row=payload.new as Order;
    if(payload.eventType==='INSERT'||payload.eventType==='UPDATE'){
      const customerRow=row.customer_id?customers.find(c=>c.id===row.customer_id)||null:null;
      setOrders(prev=>{
        const next={...row,customers:customerRow};
        const exists=prev.some(o=>o.id===row.id);
        return exists?prev.map(o=>o.id===row.id?{...o,...next}:o):[next,...prev];
      });
    }else if(payload.eventType==='DELETE'){
      setOrders(prev=>prev.filter(o=>o.id!==payload.old?.id));
      setOrderItems(prev=>prev.filter(i=>i.order_id!==payload.old?.id));
    }
   })
   .on('postgres_changes',{event:'*',schema:'public',table:'order_items',filter:`owner_id=eq.${session.user.id}`},payload=>{
    if(!active)return;
    const row=payload.new as OrderItem;
    if(payload.eventType==='INSERT'){
      setOrderItems(prev=>prev.some(i=>i.id===row.id)?prev:[...prev,row]);
    }else if(payload.eventType==='UPDATE'){
      setOrderItems(prev=>prev.map(i=>i.id===row.id?{...i,...row}:i));
    }else if(payload.eventType==='DELETE'){
      setOrderItems(prev=>prev.filter(i=>i.id!==payload.old?.id));
    }
   })
   .subscribe(status=>{ if(status==='CHANNEL_ERROR'||status==='TIMED_OUT') console.warn('Realtime pelanggan tidak tersedia:',status); });
  return()=>{active=false;supabase.removeChannel(channel);};
 },[session?.user?.id,customers]);
 useEffect(()=>{if(typeof document==='undefined')return;const sync=()=>setIsFullscreen(Boolean(document.fullscreenElement));document.addEventListener('fullscreenchange',sync);return()=>document.removeEventListener('fullscreenchange',sync)},[]);useEffect(()=>{if(toast){const t=setTimeout(()=>setToast(''),2500);return()=>clearTimeout(t)}},[toast]);useEffect(()=>{if(!notificationFlash)return;const t=setTimeout(()=>setNotificationFlash(null),4500);return()=>clearTimeout(t)},[notificationFlash]);
 const revenue=orders.filter(o=>o.status==='completed').reduce((a,o)=>a+Number(o.total),0),today=new Date().toDateString(),todayOrders=orders.filter(o=>new Date(o.created_at).toDateString()===today&&o.status==='completed');
 const notifications=useMemo(()=>{
   const items:{id:string;type:'danger'|'warning'|'success'|'info';title:string;detail:string;time:string;page:Page}[]=[];
   items.push(...activityNotifications.map(n=>({...n,targetId:n.targetId||n.id?.replace(/^order-/,'')})));
   products.filter(p=>p.stock<=0).slice(0,4).forEach(p=>items.push({id:`out-${p.id}`,targetId:p.id,type:'danger',title:'Stok habis',detail:`${p.name} sudah tidak tersedia.`,time:'Perlu tindakan',page:'Inventory'}));
   products.filter(p=>p.stock>0&&p.stock<=5).slice(0,4).forEach(p=>items.push({id:`low-${p.id}`,targetId:p.id,type:'warning',title:'Stok menipis',detail:`${p.name} tersisa ${p.stock} unit.`,time:'Perlu perhatian',page:'Inventory'}));
   orders.filter(o=>o.status==='completed').slice(0,5).forEach(o=>items.push({id:`order-${o.id}`,targetId:o.id,type:'success',title:'Pembayaran berhasil',detail:`#${o.order_number} • ${money(Number(o.total))}`,time:new Date(o.created_at).toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit'}),page:'Orders'}));
   const seen=new Set<string>();
   return items.filter(x=>{if(seen.has(x.id))return false;seen.add(x.id);return true}).sort((a,b)=>String(b.time).localeCompare(String(a.time))).slice(0,15);
 },[products,orders,activityNotifications]);
 const unreadNotifications=notifications.filter(n=>!readNotificationIds.includes(n.id)).length;
 const pushNotification=async(n:any)=>{const draft={type:n.type||'info',title:n.title,detail:n.detail,time:n.time||'Baru saja',page:n.page,targetId:n.targetId||null};setNotificationFlash(draft);setNotificationsOpen(false);try{const r=await runWithAuthRetry(()=>supabase.from('notifications').insert({owner_id:session.user.id,type:draft.type,title:draft.title,detail:draft.detail,page:draft.page,target_id:draft.targetId,is_read:false}).select('*').single());if(r.error)throw r.error;const row=r.data;const item={...draft,id:row.id,is_read:false,created_at:row.created_at,time:new Date(row.created_at).toLocaleString('id-ID')};setActivityNotifications(prev=>[item,...prev].slice(0,100));}catch(err){console.warn('Notifikasi tidak tersimpan ke database:',err);}};
 const markNotificationsRead=async()=>{const ids=notifications.map(n=>n.id);setReadNotificationIds(ids);const customIds=activityNotifications.filter(n=>!n.is_read).map(n=>n.id);if(customIds.length){const r=await runWithAuthRetry(()=>supabase.from('notifications').update({is_read:true}).in('id',customIds).eq('owner_id',session.user.id));if(r.error)console.warn(r.error);setActivityNotifications(prev=>prev.map(n=>({...n,is_read:true})));}};
 const remove=async(table:string,id:string)=>{
   const label=table==='products'?'produk':table==='categories'?'kategori':'pelanggan';
   const item=table==='products'?products.find(x=>x.id===id):table==='customers'?customers.find(x=>x.id===id):categories.find(x=>x.id===id);
   setDeleteConfirm({table,id,label,name:item?.name||label});
 };
 const confirmRemove=async()=>{
   if(!deleteConfirm)return;
   const {table,id,label,name}=deleteConfirm;
   setDeleteConfirm(null);
   try{
    await ensureFreshSession();
    const sessionNow=await ensureFreshSession();
    if(!sessionNow) throw new Error('Sesi login sudah berakhir. Silakan login kembali.');
    const res=await runWithAuthRetry(()=>supabase.from(table).delete().eq('id',id).eq('owner_id',sessionNow.user.id));
    if(res.error)throw res.error;
    if(table==='products') setProducts(items=>items.filter(x=>x.id!==id));
    if(table==='categories') setCategories(items=>items.filter(x=>x.id!==id));
    if(table==='customers') setCustomers(items=>items.filter(x=>x.id!==id));
    pushNotification({type:'danger',title:`${label[0].toUpperCase()+label.slice(1)} dihapus`,detail:`${name} berhasil dihapus dari data Mieflow.`,time:'Baru saja',page:table==='products'?'Products':table==='categories'?'Categories':'Customers'});
    setToast(`${label[0].toUpperCase()+label.slice(1)} berhasil dihapus`);
   }catch(err:any){setError(friendlySupabaseError(err))}
 };
 const save=async(type:string,data:any)=>{
  try{
   const sessionNow=await ensureFreshSession();
   if(!sessionNow) throw new Error('Sesi login sudah berakhir. Silakan login kembali.');
   let res:any;
   // Harus dideklarasikan di scope save(), karena dipakai juga setelah cabang product/category/customer.
   // Sebelumnya Categories/Customers memicu ReferenceError: imageWarning is not defined.
   let imageWarning='';
   if(type==='product'){
    const name=String(data.name||'').trim(); const price=Number(data.price); const cost=Number(data.cost||0); const stock=Number(data.stock||0);
    if(name.length<2)throw new Error('Nama produk minimal 2 karakter.');
    if(!Number.isFinite(price)||price<0)throw new Error('Harga jual tidak valid.');
    if(!Number.isFinite(cost)||cost<0)throw new Error('Harga modal tidak valid.');
    if(!Number.isFinite(stock)||stock<0)throw new Error('Stok tidak valid.');
    let imageUrl=data.image_url||null;
    // Jika foto masih berupa preview lokal, upload otomatis saat produk disimpan.
    // Jadi pengguna cukup memilih Gallery lalu menekan Simpan sekali.
    if(typeof imageUrl==='string' && imageUrl.startsWith('data:image/')){
      try{ imageUrl=await uploadImageDataUrl(imageUrl); }
      catch(uploadErr:any){ imageWarning=' Produk tetap disimpan tanpa foto karena Storage belum siap.'; imageUrl=null; console.warn(uploadErr); }
    }
    const payload={owner_id:sessionNow.user.id,name,description:data.description?String(data.description).trim():null,price,cost,stock:Math.floor(stock),image_url:imageUrl,category_id:data.category_id||null,is_active:Boolean(data.is_active)};
    if(editing){
      res=await runWithAuthRetry(()=>supabase.from('products').update(payload).eq('id',editing.id).select('*').single());
    }else{
      res=await runWithAuthRetry(()=>supabase.from('products').insert(payload).select('*').single());
    }
   }else if(type==='category'){
    const categoryPayload={...data,owner_id:sessionNow.user.id};
    res=editing?await runWithAuthRetry(()=>supabase.from('categories').update(categoryPayload).eq('id',editing.id).eq('owner_id',sessionNow.user.id).select().single()):await runWithAuthRetry(()=>supabase.from('categories').insert(categoryPayload).select().single());
   }else{
    const customerPayload={...data,owner_id:sessionNow.user.id};
    res=editing?await runWithAuthRetry(()=>supabase.from('customers').update(customerPayload).eq('id',editing.id).eq('owner_id',sessionNow.user.id).select().single()):await runWithAuthRetry(()=>supabase.from('customers').insert(customerPayload).select().single());
   }
   if(res.error)throw res.error;
   if(type==='product'){
    const saved=res.data as Product;
    // Sinkronkan relasi kategori langsung ke state lokal setelah produk dibuat/diubah.
    // POS menggunakan p.categories?.name untuk membentuk filter kategori.
    // Tanpa ini, produk baru memang tersimpan di Supabase tetapi belum muncul
    // pada kategori di menu Kasir sampai halaman di-refresh.
    const selectedCategory = saved.category_id ? categories.find((c:Category)=>c.id===saved.category_id) || null : null;
    const normalizedSaved: Product = {...saved, categories:selectedCategory};
    setProducts(items=>editing?items.map(x=>x.id===saved.id?normalizedSaved:x):[normalizedSaved,...items]);
   }
   const wasEditing=Boolean(editing);
   const savedName=String(res.data?.name||data.name||'');
   if(!wasEditing) pushNotification({type:'info',title:'Produk ditambahkan',detail:`${savedName} berhasil ditambahkan ke katalog.`,time:'Baru saja',page:'Products'});
   setToast((wasEditing?'Perubahan produk disimpan':'Produk berhasil ditambahkan')+imageWarning);setModal(null);setEditing(null);
   if(type!=='product'){
    const savedName=String(res.data?.name||data.name||'');
    if(type==='category'){
      const savedCategory=res.data as Category;
      setCategories(items=>editing?items.map(x=>x.id===savedCategory.id?savedCategory:x):[...items,savedCategory].sort((a,b)=>a.name.localeCompare(b.name)));
    }
    if(!editing) pushNotification({type:'info',title:type==='category'?'Kategori ditambahkan':'Pelanggan ditambahkan',detail:type==='category'?`${savedName} berhasil ditambahkan ke kategori.`:`${savedName} berhasil ditambahkan ke pelanggan.`,time:'Baru saja',page:type==='category'?'Categories':'Customers'});
    await load();
   }
  }catch(err:any){setError(friendlySupabaseError(err));}
 };
 const go=(p:Page)=>{setPage(p);setQuery('');setMobile(false)};
 const openOrder=(order:Order)=>{setSelectedOrder(order);setNotificationsOpen(false);go('Orders')};
 const handleNotificationClick=(n:any)=>{
   // Tetap di halaman saat ini. Detail transaksi dibuka sebagai modal premium.
   setReadNotificationIds(prev=>prev.includes(n.id)?prev:[...prev,n.id]);
   setNotificationsOpen(false);
   setSelectedNotification({...n});
 };
 const searchPlaceholders:any={Overview:'Cari produk, pelanggan, atau transaksi…',POS:'Cari produk untuk kasir…',Orders:'Cari nomor order, pelanggan, atau status…',Analytics:'Cari data analisis…',Products:'Cari produk, kategori, atau stok…',Categories:'Cari kategori…',Customers:'Cari nama, telepon, atau email…',Inventory:'Cari produk atau kategori…',Settings:'Cari pengaturan…'};
 const filteredProducts=products.filter(p=>{const q=query.trim().toLowerCase();const hay=[p.name,p.description||'',p.categories?.name||'',String(p.stock),String(p.price)].join(' ').toLowerCase();return !q||hay.includes(q)});
 const pendingKasirCustomers=useMemo(()=>customers.filter(c=>!isCustomerOrderComplete(c,orders,orderItems,products)),[customers,orders,orderItems,products]);
 const q=query.trim();
 const pageContent=q&&(page==='Overview'||page==='Analytics'||page==='Settings')?<GlobalSearchResults query={q} products={products} customers={customers} categories={categories} orders={orders} go={go} money={money}/>:loading?<div className="loading"><div className="spinner"/> Memuat data toko…</div>:page==='Overview'?<Overview revenue={revenue} orders={todayOrders.length} products={products} allOrders={orders} go={go} money={money}/>:page==='POS'?<POS products={products} categories={categories} customers={pendingKasirCustomers} query={query} onDone={(receipt:any,soldItems:CartItem[],newOrderItems:OrderItem[]=[])=>{
  // Jangan reload seluruh dashboard setelah pembayaran. Reload membuat layar
  // berkedip/menampilkan "Memuat data toko" dan terasa seperti refresh.
  // Sinkronkan hanya data yang berubah secara lokal: stok dan transaksi baru.
  if(receipt?.id){
   const customerRow=customers.find(c=>c.id===receipt.customer_id)||null;
   setOrders(prev=>[{
    ...receipt,
    owner_id:session.user.id,
    status:'completed',
    payment_method:receipt.payment_method||'cash',
    subtotal:Number(receipt.subtotal??receipt.total??0),
    discount:0,
    total:Number(receipt.total??0),
    amount_paid:Number(receipt.amount_paid??receipt.total??0),
    change_due:Number(receipt.change_due??0),
    created_at:receipt.created_at||new Date().toISOString(),
    customers:customerRow
   },...prev.filter(o=>o.id!==receipt.id)] as Order[]);
  }
  if(Array.isArray(newOrderItems)&&newOrderItems.length){
   setOrderItems(prev=>[...prev.filter(i=>!newOrderItems.some(n=>n.id===i.id)),...newOrderItems]);
  }
  if(Array.isArray(soldItems)&&soldItems.length){
   const qtyMap=new Map(soldItems.map(x=>[x.id,x.qty]));
   setProducts(prev=>prev.map(p=>qtyMap.has(p.id)?{...p,stock:Math.max(0,p.stock-(qtyMap.get(p.id)||0))}:p));
  }
  pushNotification({id:receipt?.id?`order-${receipt.id}`:undefined,type:'success',title:'Pembayaran berhasil',detail:`#${receipt?.order_number||'Transaksi'} • ${money(Number(receipt?.total||0))}`,time:'Baru saja',page:'Orders',targetId:receipt?.id||receipt?.order_number});
  setToast('Pembayaran berhasil');
}}/>:page==='Products'?<Products products={filteredProducts} onEdit={(x:any)=>{setEditing(x);setModal('product')}} onDelete={(id:string)=>remove('products',id)}/>:page==='Categories'?<Categories categories={categories} query={query} onEdit={(x:any)=>{setEditing(x);setModal('category')}} onDelete={(id:string)=>remove('categories',id)}/>:page==='Customers'?<Customers customers={customers} orders={orders} orderItems={orderItems} products={products} query={query} onEdit={(x:any)=>{setEditing(x);setModal('customer')}} onDelete={(id:string)=>remove('customers',id)}/>:page==='Orders'?<Orders orders={orders} orderItems={orderItems} query={query} onOpen={openOrder}/>:page==='Inventory'?<Inventory products={products} query={query} onStockChange={(id:string,stock:number)=>setProducts(prev=>prev.map(p=>p.id===id?{...p,stock}:p))} onAdd={()=>{setEditing(null);setModal('product')}} onDelete={(id:string)=>remove('products',id)}/>:page==='Analytics'?<Analytics orders={orders} orderItems={orderItems} products={products} categories={categories}/>:<div className="surface big-empty"><Sparkles size={28}/><h2>{page}</h2><p>Modul ini aman untuk dikembangkan setelah alur POS utama berjalan.</p></div>;

 return <main className={dark?'shell dark':'shell'}><AnimatePresence>{mobile&&<motion.button className="backdrop" initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} onClick={()=>setMobile(false)}/>}</AnimatePresence><aside className={mobile?'sidebar open':'sidebar'}><div className="brand"><div className="brand-logo">M</div><div><b>MIEFLOW</b><small>BUSINESS POS</small></div><button className="mobile-close" onClick={()=>setMobile(false)}><X/></button></div><div className="store-card"><span className="live-dot"/><div><b>Warung Mie</b><small>Online • Secure</small></div></div><nav>{nav.map(([label,key,Icon])=><button key={key} className={page===key?'active':''} onClick={()=>go(key)}><Icon size={18}/><span>{label}</span></button>)}</nav><div className="side-bottom"><button onClick={()=>go('Settings')}><Settings size={18}/>Pengaturan</button><button className="logout" onClick={()=>supabase.auth.signOut()}><LogOut size={18}/>Keluar</button><div className="user"><div>{(session.user.email||'A')[0].toUpperCase()}</div><span><b>{session.user.email}</b><small>Authenticated</small></span></div></div></aside>
 <section className="main">{notificationFlash&&<AnimatePresence><motion.div className="notification-flash" initial={{opacity:0,y:-18,scale:.96}} animate={{opacity:1,y:0,scale:1}} exit={{opacity:0,y:-12,scale:.97}} transition={{duration:.22}} role="status"><div className={`notification-flash-icon ${notificationFlash.type}`}>{notificationFlash.type==='danger'?'!':notificationFlash.type==='warning'?'!':notificationFlash.type==='success'?'✓':'i'}</div><div className="notification-flash-copy"><span>{notificationFlash.type==='success'?'PAYMENT CONFIRMED':'NOTIFIKASI BARU'}</span><b>{notificationFlash.title}</b><small>{notificationFlash.detail}</small><button className="notification-flash-action" onClick={()=>setNotificationFlash(null)}>Mengerti <CheckCircle2 size={13}/></button></div><button className="notification-flash-close" onClick={()=>setNotificationFlash(null)} aria-label="Tutup notifikasi"><X size={15}/></button></motion.div></AnimatePresence>}<header className={`${page==='POS'?'topbar pos-topbar':'topbar'}${page==='Overview'?' overview-topbar':''}`}><button className="hamb" onClick={()=>setMobile(true)}><Menu/></button><div className="crumb">{page==='POS'?<b>Kasir / POS</b>:<>Workspace <ChevronRight size={14}/><b>{displayPage(page)}</b></>}</div><div className="top-actions"><label className="global-search universal-search"><Search size={17}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder={searchPlaceholders[page]||'Cari data…'} aria-label={`Pencarian ${displayPage(page)}`}/><button type="button" className="global-search-clear" onClick={()=>setQuery('')} aria-label="Hapus pencarian" style={{display:query?'grid':'none'}}>×</button><kbd>Ctrl /</kbd></label><div className="notification-wrap"><button onClick={()=>setNotificationsOpen(v=>!v)} className="top-icon top-bell" aria-label="Notifikasi"><span>{unreadNotifications>99?"99+":unreadNotifications}</span><Bell size={19}/></button>{notificationsOpen&&<div className="notification-panel"><div className="notification-head"><div><b>Notifikasi</b><small>{notifications.length?`${notifications.length} aktivitas penting`:"Semua aman"}</small></div><button onClick={markNotificationsRead} disabled={!unreadNotifications}>Tandai dibaca</button></div><div className="notification-filters">{[['all','Semua'],['unread','Belum dibaca'],['transactions','Transaksi'],['stock','Stok'],['activity','Aktivitas']].map(([key,label])=><button key={key} className={notificationFilter===key?'active':''} onClick={()=>setNotificationFilter(key as any)}>{label}</button>)}</div><div className="notification-list">{notifications.filter(n=>notificationFilter==='all'||notificationFilter==='unread'?!readNotificationIds.includes(n.id):notificationFilter==='transactions'?n.page==='Orders':notificationFilter==='stock'?n.page==='Inventory':n.page!=='Orders'&&n.page!=='Inventory').map(n=><button key={n.id} className={`notification-item ${readNotificationIds.includes(n.id)?'read':''}`} onClick={()=>handleNotificationClick(n)}><i className={`notification-icon ${n.type}`}>{n.type==='danger'?'!':n.type==='warning'?'!':n.type==='success'?'✓':'i'}</i><span><b>{n.title}</b><small>{n.detail}</small><em>{n.time}</em></span><ChevronRight size={14} className="notification-arrow"/></button>).length?notifications.filter(n=>notificationFilter==='all'||notificationFilter==='unread'?!readNotificationIds.includes(n.id):notificationFilter==='transactions'?n.page==='Orders':notificationFilter==='stock'?n.page==='Inventory':n.page!=='Orders'&&n.page!=='Inventory').map(n=><button key={n.id} className={`notification-item ${readNotificationIds.includes(n.id)?'read':''}`} onClick={()=>handleNotificationClick(n)}><i className={`notification-icon ${n.type}`}>{n.type==='danger'?'!':n.type==='warning'?'!':n.type==='success'?'✓':'i'}</i><span><b>{n.title}</b><small>{n.detail}</small><em>{n.time}</em></span><ChevronRight size={14} className="notification-arrow"/></button>):<div className="notification-empty"><CheckCircle2 size={22}/><b>Tidak ada notifikasi</b><span>Tidak ada aktivitas pada filter ini.</span></div>}</div></div>}</div>{page==='Overview'&&<button className="pos-fullscreen overview-fullscreen" type="button" aria-label={isFullscreen?'Perkecil layar':'Perbesar layar'} title={isFullscreen?'Perkecil layar':'Perbesar layar'} onClick={async()=>{try{if(document.fullscreenElement){await document.exitFullscreen?.()}else{await document.documentElement.requestFullscreen?.()}}catch(e){console.warn('Fullscreen tidak tersedia',e)}}}>{isFullscreen?<Minimize2 size={17}/>:<Maximize2 size={17}/>}</button>}<div className="top-admin"><div className="top-admin-avatar">A</div><div><b>Admin</b><small>Owner</small></div><ChevronDown size={15}/></div></div></header><div className="content">{error&&<div className="error"><span>{error}</span><button onClick={()=>setError('')}><X size={16}/></button></div>}{page==='POS'?<div className="page-title pos-page-title"><div><h1>Kasir</h1><p>Buat pesanan dan kelola transaksi dengan mudah</p></div></div>:<div className="page-title"><div><span className="eyebrow">MIEFLOW / {new Date().toLocaleDateString('id-ID',{day:'2-digit',month:'short',year:'numeric'})}</span><h1>{page==='Overview'?'Command Center':displayPage(page)}</h1><p>{desc(page)}</p></div>{['Products','Categories','Customers'].includes(page)&&<button className="primary" onClick={()=>{setEditing(null);setModal(page==='Products'?'product':page==='Categories'?'category':'customer')}}><Plus size={17}/> Tambah</button>}</div>}{pageContent}</div></section>
 <AnimatePresence>{selectedOrder&&<OrderDetailModal order={selectedOrder} items={orderItems.filter(i=>i.order_id===selectedOrder.id)} onClose={()=>setSelectedOrder(null)} money={money}/>} {modal&&<Modal type={modal} initial={editing} categories={categories} onClose={()=>{setModal(null);setEditing(null)}} onSave={save}/>}</AnimatePresence>{selectedNotification&&<AnimatePresence><motion.div className="notification-detail-backdrop" initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} onClick={()=>setSelectedNotification(null)}><motion.section className="notification-detail-modal" initial={{opacity:0,y:18,scale:.97}} animate={{opacity:1,y:0,scale:1}} exit={{opacity:0,y:12,scale:.98}} onClick={e=>e.stopPropagation()}><div className={`notification-detail-icon ${selectedNotification.type||'info'}`}>{selectedNotification.type==='success'?'✓':selectedNotification.type==='danger'||selectedNotification.type==='warning'?'!':'i'}</div><button className="notification-detail-close" onClick={()=>setSelectedNotification(null)} aria-label="Tutup detail notifikasi"><X size={18}/></button><span className="notification-detail-eyebrow">{selectedNotification.type==='success'?'TRANSACTION CONFIRMED':'NOTIFICATION DETAIL'}</span><h2>{selectedNotification.title}</h2><p>{selectedNotification.detail}</p><div className="notification-detail-meta"><div><small>WAKTU</small><b>{selectedNotification.time||'Baru saja'}</b></div><div><small>STATUS</small><b>{selectedNotification.type==='success'?'Berhasil':'Tercatat'}</b></div></div><div className="notification-detail-note"><CheckCircle2 size={17}/><span>Notifikasi telah dibuka dan ditandai sebagai sudah dibaca. Anda tetap berada di halaman saat ini.</span></div><button className="notification-detail-action" onClick={()=>setSelectedNotification(null)}>Selesai <Check size={16}/></button></motion.section></motion.div></AnimatePresence>}{deleteConfirm&&<DeleteConfirmDialog data={deleteConfirm} onCancel={()=>setDeleteConfirm(null)} onConfirm={confirmRemove}/>}{toast&&<motion.div className="toast" initial={{y:20,opacity:0}} animate={{y:0,opacity:1}}><Check size={17}/>{toast}</motion.div>}</main>}
function displayPage(p:Page){return ({Overview:'Dashboard',POS:'Kasir',Orders:'Riwayat Transaksi',Analytics:'Analisis',Products:'Produk',Categories:'Kategori',Promotions:'Promosi',Customers:'Pelanggan',Inventory:'Inventory',Settings:'Pengaturan'} as any)[p]};
function desc(p:Page){return ({Overview:'Pusat kendali penjualan, stok, pelanggan, dan performa toko.',POS:'Kasir premium untuk transaksi cepat, rapi, dan aman.',Orders:'Riwayat seluruh transaksi yang tersimpan di Supabase.',Analytics:'Analisis omzet, transaksi, dan performa penjualan.',Products:'Kelola menu, harga, stok, foto, dan status produk.',Categories:'Atur kategori menu agar katalog lebih rapi.',Promotions:'Kelola program promo dan penawaran toko.',Customers:'Database pelanggan lengkap dengan kontak dan catatan.',Inventory:'Pantau stok dan lakukan penyesuaian dengan cepat.',Settings:'Pengaturan operasional toko.'} as any)[p]}
function Overview({revenue,orders,products,allOrders,go,money}:any){
 const [range,setRange]=useState<7|30>(7);
 const [productFilter,setProductFilter]=useState('all');
 const [productSort,setProductSort]=useState<'name'|'price'|'stock'>('name');
 const [productSortOpen,setProductSortOpen]=useState(false);
 const completed=(allOrders as Order[]).filter(o=>o.status==='completed');
 const now=new Date();
 const start=new Date(now);start.setDate(now.getDate()-(range-1));start.setHours(0,0,0,0);
 const points=Array.from({length:range},(_,i)=>{const d=new Date(start);d.setDate(start.getDate()+i);const dayOrders=completed.filter(o=>{const x=new Date(o.created_at);return x.toDateString()===d.toDateString()});return {date:d,label:d.toLocaleDateString('id-ID',{day:'2-digit',month:'short'}),value:dayOrders.reduce((a,o)=>a+Number(o.total),0),count:dayOrders.length}});
 const max=Math.max(...points.map(x=>x.value),1);
 const chartWidth=760,chartHeight=250,padX=34,padY=24;
 const bars=points.map((x,i)=>{const slot=(chartWidth-padX*2)/points.length;const bw=Math.max(8,slot*.52);const h=(x.value/max)*(chartHeight-padY*2-24);return {...x,x:padX+i*slot+(slot-bw)/2,y:chartHeight-padY-h,w:bw,h}});
 const activeCats=Array.from(new Set(products.map((p:Product)=>p.categories?.name).filter(Boolean))) as string[];
 const filtered=products.filter((p:Product)=>p.is_active&&p.stock>=0&& (productFilter==='all'||p.categories?.name===productFilter)).sort((a:Product,b:Product)=>productSort==='price'?Number(b.price)-Number(a.price):productSort==='stock'?b.stock-a.stock:a.name.localeCompare(b.name)).slice(0,6);
 return <div className="overview-page">
   <section className="overview-hero">
    <div className="overview-hero-copy"><span className="hero-kicker"><Sparkles size={13}/> MIEFLOW • BUSINESS OVERVIEW</span><h2>Ringkasan penjualan<br/><em>hari ini.</em></h2><p>Pantau omzet, transaksi, menu aktif, dan stok dalam satu tampilan yang cepat.</p><button className="hero-btn" onClick={()=>go('POS')}>Buka POS <ChevronRight size={16}/></button></div>
    <div className="profit-card"><span>Profit amount</span><strong>{money(revenue)}</strong><small><b>Live</b> dari transaksi selesai</small><div className="profit-spark"><svg viewBox="0 0 360 92" preserveAspectRatio="none"><path d="M0 72 C40 42,58 66,96 52 S150 60,180 45 S225 22,250 42 S300 76,324 26 S350 25,360 10" fill="none" stroke="rgba(255,255,255,.86)" strokeWidth="2"/><circle cx="250" cy="42" r="5" fill="#fff"/></svg></div></div>
   </section>
   <div className="kpis overview-kpis">
    <Kpi label="Omzet" value={money(revenue)} detail="Semua transaksi selesai" icon={CircleDollarSign}/><Kpi label="Transaksi hari ini" value={orders} detail="Selesai hari ini" icon={CreditCard}/><Kpi label="Total produk" value={products.length} detail={`${products.filter((p:Product)=>p.is_active).length} menu aktif`} icon={Package}/><Kpi label="Stok rendah" value={products.filter((p:Product)=>p.stock<5).length} detail="Perlu perhatian" icon={Box}/>
   </div>
   <div className="overview-grid">
    <section className="surface sales-panel">
      <div className="overview-section-head"><div><span className="section-label">PERFORMA</span><h2>Product Sale</h2><p>Omzet berdasarkan transaksi selesai.</p></div><div className="range-tabs"><button className={range===7?'active':''} onClick={()=>setRange(7)}>7 Hari</button><button className={range===30?'active':''} onClick={()=>setRange(30)}>30 Hari</button></div></div>
      <div className="bar-chart"><svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} preserveAspectRatio="none" role="img" aria-label="Grafik penjualan"><defs><linearGradient id="barGradient" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#ff6a3d"/><stop offset="100%" stopColor="#ff9b2f"/></linearGradient></defs>{[0,.25,.5,.75,1].map((g,i)=><line key={i} x1={padX} x2={chartWidth-padX} y1={padY+(chartHeight-padY*2-24)*g} y2={padY+(chartHeight-padY*2-24)*g} stroke="currentColor" opacity=".08"/>)}{bars.map((b,i)=><g key={i}><rect x={b.x} y={b.y} width={b.w} height={Math.max(2,b.h)} rx="7" fill="url(#barGradient)" opacity={b.value?1:.16}/><title>{b.label}: {money(b.value)}</title></g>)}</svg><div className="chart-labels">{points.filter((_,i)=>range===7||i%5===0||i===points.length-1).map(x=><span key={x.label}>{x.label}</span>)}</div></div>
      <div className="chart-legend"><span><i/>Omzet</span><span><i className="soft"/>Transaksi</span></div>
    </section>
    <section className="surface sales-stats-panel"><div className="overview-section-head compact"><div><span className="section-label">RINGKASAN</span><h2>Sales Statistics</h2></div><span className="live-badge"><i/>Live</span></div><div className="stat-total">{money(completed.reduce((a,o)=>a+Number(o.total),0))}<small>Total omzet</small></div><div className="line-chart"><svg viewBox="0 0 420 190" preserveAspectRatio="none"><defs><linearGradient id="areaGradient" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#ff6a3d" stopOpacity=".26"/><stop offset="100%" stopColor="#ff6a3d" stopOpacity="0"/></linearGradient></defs><path d="M0 140 C45 80,75 112,112 94 S175 52,210 84 S265 135,300 92 S360 65,420 76 L420 190 L0 190 Z" fill="url(#areaGradient)"/><path d="M0 140 C45 80,75 112,112 94 S175 52,210 84 S265 135,300 92 S360 65,420 76" fill="none" stroke="#ff6a3d" strokeWidth="4" strokeLinecap="round"/></svg></div><div className="stats-footer"><span>Transaksi <b>{completed.length}</b></span><span>Rata-rata <b>{money(completed.length?completed.reduce((a,o)=>a+Number(o.total),0)/completed.length:0)}</b></span></div></section>
   </div>
   <section className="surface product-overview"><div className="overview-section-head"><div><span className="section-label">PRODUCT CATALOG</span><h2>Product Overview</h2><p>Menu aktif, harga, dan kondisi stok secara ringkas.</p></div><div className="product-controls"><div className="mini-tabs"><button className={productFilter==='all'?'active':''} onClick={()=>setProductFilter('all')}>All</button>{activeCats.slice(0,3).map((c:string)=><button key={c} className={productFilter===c?'active':''} onClick={()=>setProductFilter(c)}>{c}</button>)}</div><button type="button" className="product-sort-trigger" onClick={()=>setProductSortOpen(true)} aria-haspopup="dialog" aria-expanded={productSortOpen}><span>{productSort==='price'?'Harga tertinggi':productSort==='stock'?'Stok terbanyak':'Nama'}</span><ChevronDown size={15}/></button></div></div>{productSortOpen&&<div className="product-sort-overlay" role="presentation" onClick={()=>setProductSortOpen(false)}><div className="product-sort-sheet" role="dialog" aria-modal="true" aria-labelledby="product-sort-title" onClick={e=>e.stopPropagation()}><div className="product-sort-head"><div><span className="eyebrow">URUTKAN PRODUK</span><h3 id="product-sort-title">Tampilkan produk</h3><p>Pilih urutan produk yang ingin ditampilkan.</p></div><button type="button" className="product-sort-close" onClick={()=>setProductSortOpen(false)} aria-label="Tutup"><X size={19}/></button></div><div className="product-sort-options">{[['name','Nama','Urutkan berdasarkan nama produk'],['price','Harga tertinggi','Produk dengan harga paling tinggi lebih dahulu'],['stock','Stok terbanyak','Produk dengan stok paling banyak lebih dahulu']].map(([value,title,desc])=>{const active=productSort===value;return <button type="button" key={value} className={`product-sort-option ${active?'active':''}`} onClick={()=>{setProductSort(value as any);setProductSortOpen(false)}}><span className="product-sort-option-icon">{value==='name'?'A':value==='price'?'Rp':'#'}</span><span className="product-sort-option-copy"><b>{title}</b><small>{desc}</small></span><span className="product-sort-check">{active&&<Check size={17}/>}</span></button>})}</div></div></div>}<div className="product-overview-list">{filtered.map((p:Product,i:number)=><button className="overview-product-row" key={p.id} onClick={()=>go('Products')}><span className="rank">{i+1}.</span><div className="overview-product-image">{p.image_url?<img src={p.image_url} alt=""/>:<span>🍜</span>}</div><div className="overview-product-name"><b>{p.name}</b><small>{p.categories?.name||'Tanpa kategori'}</small></div><span className="overview-product-price">{money(Number(p.price))}</span><span className={`overview-stock ${p.stock<5?'low':''}`}>{p.stock} stok</span><ChevronRight size={16}/></button>)}{!filtered.length&&<Empty text="Belum ada produk aktif."/>}</div></section>
 </div>
}

function Kpi({label,value,detail,icon:Icon,tone='violet'}:any){return <motion.div className={`kpi analytics-kpi-card ${tone}`} whileHover={{y:-4,scale:1.01}} transition={{type:'spring',stiffness:280,damping:20}}><div className="kpi-top"><span>{label}</span><i><Icon size={18}/></i></div><strong>{value}</strong><small>{detail}</small></motion.div>}
function Head({title,icon:Icon}:any){return <div className="surface-head"><div><span>LIVE DATA</span><h2>{title}</h2></div><Icon size={18}/></div>}
function GlobalSearchResults({query,products,customers,categories,orders,go,money}:any){
 const q=String(query||'').trim().toLowerCase();
 const productHits=(products as Product[]).filter((p:Product)=>{
  const hay=[p.name,p.description||'',p.categories?.name||'',String(p.stock),String(p.price)].join(' ').toLowerCase();
  return !q||hay.includes(q);
 }).slice(0,6);
 const customerHits=(customers as Customer[]).filter((c:Customer)=>{
  const hay=[c.name,c.phone||'',c.email||'',c.notes||''].join(' ').toLowerCase();
  return !q||hay.includes(q);
 }).slice(0,6);
 const categoryHits=(categories as Category[]).filter((c:Category)=>{
  const hay=[c.name,c.color||''].join(' ').toLowerCase();
  return !q||hay.includes(q);
 }).slice(0,6);
 const orderHits=(orders as Order[]).filter((o:Order)=>{
  const hay=[o.order_number,o.status,o.payment_method,o.customers?.name||'',o.customers?.phone||'',String(o.total),new Date(o.created_at).toLocaleString('id-ID')].join(' ').toLowerCase();
  return !q||hay.includes(q);
 }).slice(0,6);
 const total=productHits.length+customerHits.length+categoryHits.length+orderHits.length;
 return (
  <div className="global-results">
   <div className="surface global-results-head">
    <div>
     <span className="section-label">GLOBAL SEARCH</span>
     <h2>Hasil pencarian untuk “{query}”</h2>
     <p>{total?`${total} hasil relevan ditemukan di Mieflow.`:'Tidak ada data yang cocok.'}</p>
    </div>
    <button className="secondary" onClick={()=>go('Products')}><Package size={15}/> Lihat produk</button>
   </div>
   <div className="global-results-grid">
    {productHits.length>0 && (
     <section className="surface global-result-card">
      <div className="global-result-title"><Package size={16}/><b>Produk</b><span>{productHits.length}</span></div>
      {productHits.map((p:Product)=>(
       <button key={p.id} className="global-result-row" onClick={()=>go('Products')}>
        <div className="global-result-avatar">{p.image_url?<img src={p.image_url} alt=""/>:<span>🍜</span>}</div>
        <div><b>{p.name}</b><small>{p.categories?.name||'Tanpa kategori'} • Stok {p.stock}</small></div>
        <strong>{money(Number(p.price))}</strong>
        <ChevronRight size={15}/>
       </button>
      ))}
     </section>
    )}
    {customerHits.length>0 && (
     <section className="surface global-result-card">
      <div className="global-result-title"><Users size={16}/><b>Pelanggan</b><span>{customerHits.length}</span></div>
      {customerHits.map((c:Customer)=>(
       <button key={c.id} className="global-result-row" onClick={()=>go('Customers')}>
        <div className="global-result-avatar customer">{(c.name||'?').slice(0,1).toUpperCase()}</div>
        <div><b>{c.name}</b><small>{c.phone||c.email||'Kontak belum diisi'}</small></div>
        <ChevronRight size={15}/>
       </button>
      ))}
     </section>
    )}
    {orderHits.length>0 && (
     <section className="surface global-result-card">
      <div className="global-result-title"><WalletCards size={16}/><b>Transaksi</b><span>{orderHits.length}</span></div>
      {orderHits.map((o:Order)=>(
       <button key={o.id} className="global-result-row" onClick={()=>go('Orders')}>
        <div className="global-result-avatar order">#</div>
        <div><b>#{o.order_number}</b><small>{o.customers?.name||'Pelanggan umum'} • {o.status}</small></div>
        <strong>{money(Number(o.total))}</strong>
        <ChevronRight size={15}/>
       </button>
      ))}
     </section>
    )}
    {categoryHits.length>0 && (
     <section className="surface global-result-card">
      <div className="global-result-title"><Tags size={16}/><b>Kategori</b><span>{categoryHits.length}</span></div>
      {categoryHits.map((c:Category)=>(
       <button key={c.id} className="global-result-row" onClick={()=>go('Categories')}>
        <div className="global-result-avatar category"><i style={{background:c.color}}/></div>
        <div><b>{c.name}</b><small>{c.color}</small></div>
        <ChevronRight size={15}/>
       </button>
      ))}
     </section>
    )}
    {!total && (
     <div className="surface global-no-results">
      <Search size={28}/>
      <b>Data tidak ditemukan</b>
      <span>Coba nama produk, pelanggan, nomor transaksi, kategori, atau kata kunci lain.</span>
     </div>
    )}
   </div>
  </div>
 );
}
function Products({products,onEdit,onDelete}:any){
 const [category,setCategory]=useState('Semua');
 const categories=useMemo(()=>Array.from(new Set(products.map((p:Product)=>p.categories?.name).filter(Boolean))) as string[],[products]);
 const visible=category==='Semua'?products:products.filter((p:Product)=>p.categories?.name===category);
 return <div className="product-catalog-page">
  <section className="product-catalog-hero">
   <div><span className="section-label">MIEFLOW MARKETPLACE</span><h2>Katalog Produk</h2><p>Tampilan katalog premium untuk mengelola menu, stok, harga, dan foto produk dengan lebih nyaman.</p></div>
   <div className="catalog-summary"><div><b>{products.length}</b><small>Total produk</small></div><div><b>{products.filter((p:Product)=>p.is_active).length}</b><small>Produk aktif</small></div><div><b>{products.filter((p:Product)=>p.stock<5).length}</b><small>Stok menipis</small></div></div>
  </section>
  <section className="catalog-toolbar"><div className="catalog-tabs"><button className={category==='Semua'?'active':''} onClick={()=>setCategory('Semua')}>Semua <span>{products.length}</span></button>{categories.map(c=><button key={c} className={category===c?'active':''} onClick={()=>setCategory(c)}>{c}</button>)}</div><div className="catalog-count"><Package size={16}/>{visible.length} produk ditampilkan</div></section>
  {visible.length?<section className="product-catalog-grid">{visible.map((p:Product,i:number)=><motion.article key={p.id} className="catalog-product-card" initial={{opacity:0,y:12}} animate={{opacity:1,y:0}} transition={{delay:Math.min(i*.025,.3)}} whileHover={{y:-5}}>
   <div className="catalog-product-media">{p.image_url?<img src={p.image_url} alt={p.name}/>:<span>🍜</span>}<div className="catalog-media-top"><em>{p.categories?.name||'Menu'}</em><span className={p.is_active?'online':'offline'}>{p.is_active?'Aktif':'Nonaktif'}</span></div><div className="catalog-stock-float">{p.stock<5?<AlertTriangle size={13}/>:<Boxes size={13}/>} {p.stock} stok</div></div>
   <div className="catalog-product-body"><div className="catalog-product-copy"><h3>{p.name}</h3><p>{p.description||'Belum ada deskripsi untuk produk ini.'}</p></div><div className="catalog-price-row"><div><small>Harga jual</small><b>{money(Number(p.price))}</b></div><div className="catalog-card-actions"><button type="button" onClick={()=>onEdit(p)} aria-label={`Edit ${p.name}`}><Edit3 size={16}/></button><button type="button" onClick={()=>onDelete(p.id)} aria-label={`Hapus ${p.name}`}><Trash2 size={16}/></button></div></div></div>
  </motion.article>)}</section>:<div className="surface catalog-empty"><PackageOpen size={30}/><b>Produk tidak ditemukan</b><p>Tidak ada produk pada kategori ini atau sesuai pencarian.</p></div>}
 </div>
}
function Categories({categories,query,onEdit,onDelete}:any){const q=(query||'').trim().toLowerCase();const filtered=categories.filter((c:Category)=>!q||c.name.toLowerCase().includes(q)||c.color.toLowerCase().includes(q));return <div className="surface table-surface"><Head title="Kategori" icon={Tags}/><TableHead cols={['Nama','Warna','Dibuat','']}/>{filtered.map((c:Category)=><div className="row category-row" key={c.id}><div><span className="color-dot" style={{background:c.color}}/><b>{c.name}</b></div><code>{c.color}</code><span>{c.created_at?new Date(c.created_at).toLocaleDateString('id-ID'):'—'}</span><Actions onEdit={()=>onEdit(c)} onDelete={()=>onDelete(c.id)}/></div>)}</div>}
function Customers({customers,orders,orderItems,products=[],query,onEdit,onDelete}:any){
 const [localSearch,setLocalSearch]=useState('');
 const [tab,setTab]=useState<'all'|'completed'|'returning'|'pending'>('all');
 // Target pesanan dibaca dari catatan pelanggan, contoh: "Pesan mie 20", "Pesan 20 mie", atau "target 20".

 const customerStats=useMemo(()=>{
  const map=new Map<string,{orders:number;spend:number;last:string|null;qty:number}>();
  orders.forEach((o:Order)=>{if(!o.customer_id||o.status!=='completed')return;const item=map.get(o.customer_id)||{orders:0,spend:0,last:null,qty:0};item.orders+=1;item.spend+=Number(o.total)||0;if(!item.last||new Date(o.created_at)>new Date(item.last))item.last=o.created_at;const items=orderItems.filter((i:OrderItem)=>i.order_id===o.id);item.qty+=items.reduce((sum,i)=>sum+Number(i.quantity||0),0);map.set(o.customer_id,item)});
  return map;
 },[orders,orderItems]);
 const statusFor=(c:Customer)=>isCustomerOrderComplete(c,orders,orderItems,products)?'completed':'pending';
 const completedCount=customers.filter((c:Customer)=>statusFor(c)==='completed').length;
 const pendingCount=customers.filter((c:Customer)=>statusFor(c)==='pending').length;
 const returningCount=customers.filter((c:Customer)=>(customerStats.get(c.id)?.orders||0)>=2).length;
 const customerOrders=orders.filter((o:Order)=>!!o.customer_id&&o.status==='completed');
 const customerRevenue=customerOrders.reduce((a,o)=>a+Number(o.total||0),0);
 const averageSpend=customerRevenue/Math.max(1,customers.filter(c=>customerStats.has(c.id)).length);
 const monthLabels=Array.from({length:6},(_,i)=>{const d=new Date();d.setMonth(d.getMonth()-(5-i));return d.toLocaleDateString('id-ID',{month:'short'}).replace('.','')});
 const monthValues=monthLabels.map((_,i)=>{const d=new Date();d.setMonth(d.getMonth()-(5-i));const y=d.getFullYear(),m=d.getMonth();return customerOrders.filter((o:Order)=>{const x=new Date(o.created_at);return x.getFullYear()===y&&x.getMonth()===m}).reduce((a,o)=>a+Number(o.total||0),0)});
 const maxMonth=Math.max(...monthValues,1);
 const searchText=(localSearch||query||'').trim().toLowerCase();const filtered=customers.filter((c:Customer)=>{const s=customerStats.get(c.id);const returning=(s?.orders||0)>=2;const match=!searchText||[c.name,c.phone,c.email,c.notes].some((value)=>String(value||'').toLowerCase().includes(searchText));const status=tab==='completed'?statusFor(c)==='completed':tab==='returning'?returning:tab==='pending'?statusFor(c)==='pending':true;return match&&status}).sort((a:Customer,b:Customer)=>(customerStats.get(b.id)?.spend||0)-(customerStats.get(a.id)?.spend||0));
 return <div className="customer-page">
  <section className="customer-intro"><div><span className="section-label">CUSTOMER INTELLIGENCE</span><h2>Analisis Pelanggan</h2><p>Pahami pelanggan paling aktif, nilai transaksi, dan pola pembelian untuk keputusan yang lebih tepat.</p></div><div className="customer-live"><i/> Data pelanggan real-time</div></section>
  <section className="customer-kpis"><div className="customer-kpi"><div className="customer-kpi-icon blue"><Users size={18}/></div><span>Total pelanggan</span><b>{customers.length.toLocaleString('id-ID')}</b><small>Database pelanggan</small></div><div className="customer-kpi"><div className="customer-kpi-icon green"><TrendingUp size={18}/></div><span>Pelanggan selesai</span><b>{completedCount.toLocaleString('id-ID')}</b><small>Memiliki transaksi selesai</small></div><div className="customer-kpi"><div className="customer-kpi-icon violet"><WalletCards size={18}/></div><span>Transaksi pelanggan</span><b>{customerOrders.length.toLocaleString('id-ID')}</b><small>Total order ber-pelanggan</small></div><div className="customer-kpi"><div className="customer-kpi-icon orange"><CircleDollarSign size={18}/></div><span>Customer revenue</span><b>{money(customerRevenue)}</b><small>Rata-rata {money(averageSpend)}</small></div></section>
  <section className="customer-grid"><div className="surface customer-chart-card"><div className="customer-card-head"><div><span>REVENUE</span><h3>Penjualan dari pelanggan</h3></div><span className="customer-period">6 bulan</span></div><div className="customer-chart"><div className="customer-yaxis"><span>{money(maxMonth)}</span><span>{money(maxMonth*.5)}</span><span>Rp 0</span></div><div className="customer-bars">{monthValues.map((v,i)=><div className="customer-bar-col" key={i}><div className="customer-bar-track"><motion.div initial={{height:0}} animate={{height:`${Math.max(6,(v/maxMonth)*100)}%`}} transition={{duration:.55,delay:i*.05}} className="customer-bar"/></div><small>{monthLabels[i]}</small></div>)}</div></div><div className="customer-chart-footer"><span><i/> Revenue pelanggan</span><b>{money(customerRevenue)}</b></div></div><div className="surface customer-insight-card"><div className="customer-card-head"><div><span>INSIGHT</span><h3>Customer performance</h3></div><Sparkles size={18}/></div><div className="customer-insights"><div><span>Returning customers</span><b>{returningCount}</b><small>{customers.length?Math.round(returningCount/customers.length*100):0}% dari database</small></div><div><span>Avg. customer value</span><b>{money(averageSpend)}</b><small>berdasarkan transaksi tercatat</small></div><div><span>Top customer</span><b>{filtered[0]?.name||'—'}</b><small>{filtered[0]&&customerStats.get(filtered[0].id)?money(customerStats.get(filtered[0].id).spend):'Belum ada transaksi'}</small></div></div></div></section>
  <section className="surface customer-table-card customer-directory-premium"><div className="customer-table-head"><div><span className="section-label">CUSTOMER DIRECTORY</span><h3>Semua pelanggan</h3><p>Setiap pesanan ditampilkan lengkap berdasarkan produk dan progres pemenuhannya.</p></div><div className="customer-directory-live"><i/> Real-time</div></div><div className="customer-toolbar"><label className="customer-search"><Search size={18}/><input value={localSearch} onChange={e=>setLocalSearch(e.target.value)} placeholder="Cari nama, telepon, atau email…"/></label><div className="customer-tabs"><button className={tab==='all'?'active':''} onClick={()=>setTab('all')}>Semua <b>{customers.length}</b></button><button className={tab==='completed'?'active':''} onClick={()=>setTab('completed')}>Selesai <b>{completedCount}</b></button><button className={tab==='pending'?'active':''} onClick={()=>setTab('pending')}>Pending <b>{pendingCount}</b></button><button className={tab==='returning'?'active':''} onClick={()=>setTab('returning')}>Returning <b>{returningCount}</b></button></div></div><div className="customer-cards-list">{filtered.map((c:Customer)=>{const s=customerStats.get(c.id)||{orders:0,spend:0,last:null,qty:0};const targets=parseCustomerTargets(c);const fulfillment=getCustomerFulfillment(c.id,targets,orders,orderItems,products);const done=isCustomerOrderComplete(c,orders,orderItems,products);const orderDate=s.last?new Date(s.last).toLocaleDateString('id-ID',{day:'2-digit',month:'short',year:'numeric'}):'Belum ada';return <article className={`customer-premium-card ${done?'is-complete':'is-pending'}`} key={c.id}><div className="customer-premium-main"><div className="customer-premium-identity"><div className="customer-avatar customer-avatar-large">{(c.name||'?').slice(0,1).toUpperCase()}</div><div className="customer-name-block"><div className="customer-name-line"><h4>{c.name}</h4><span className={`customer-status-badge ${done?'done':'pending'}`}><i/>{done?'Selesai':s.orders?'Pending':'Terdaftar'}</span></div><div className="customer-meta"><span>{s.orders} transaksi</span><span>Total {money(s.spend)}</span></div></div></div><div className="customer-order-details">{fulfillment.length?fulfillment.map((item:any)=><div className="customer-order-item" key={normalizeProductName(item.name)}><div className="customer-order-icon">{normalizeProductName(item.name).includes('es')?'🥤':normalizeProductName(item.name).includes('ayam')?'🍗':'🍜'}</div><div className="customer-order-copy"><div><b>{item.name}</b><span>{item.fulfilled}/{item.qty}</span></div><div className="customer-progress-track"><span style={{width:`${Math.min(100,(item.fulfilled/item.qty)*100)}%`}}/></div><small className={`customer-order-note ${!item.productExists?'not-created':''}`}>{!item.productExists?'Menu belum dibuat • buat menu ini di Produk':item.fulfilled>=item.qty?'Pesanan terpenuhi':`Kurang ${Math.max(0,item.qty-item.fulfilled)} pesanan`}</small></div><span className={`customer-order-check ${item.fulfilled>=item.qty?'complete':''}`}>{item.fulfilled>=item.qty?<Check size={13}/>:`${Math.round((item.fulfilled/item.qty)*100)}%`}</span></div>):<div className="customer-no-orders"><div className="customer-order-icon">▣</div><div><b>{s.orders?'Pesanan selesai':'Belum ada pesanan'}</b><small>{s.orders?'Semua target pesanan telah terpenuhi.':'Tambahkan pesanan untuk mulai melacak progres.'}</small></div></div>}</div><div className="customer-premium-contact"><div><span>Telepon</span><b>{c.phone||'—'}</b></div><div><span>Tanggal pesanan</span><b>{orderDate}</b></div><div><span>Email</span><small>{c.email||'Email belum diisi'}</small></div><Actions onEdit={()=>onEdit(c)} onDelete={()=>onDelete(c.id)}/></div></div></article>})}{!filtered.length&&<div className="customer-empty"><Users size={28}/><b>Tidak ada pelanggan yang cocok</b><span>Coba ubah kata kunci atau filter.</span></div>}</div><div className="customer-footer"><span>Menampilkan <b>{filtered.length}</b> dari <b>{customers.length}</b> pelanggan</span><span><Clock3 size={14}/> Status & progres dihitung dari seluruh pesanan selesai</span></div></section>
 </div>
}
function TableHead({cols}:{cols:string[]}){return <div className="table-head">{cols.map((c,i)=><span key={i}>{c}</span>)}</div>};function Actions({onEdit,onDelete}:any){return <div className="actions"><button onClick={onEdit}><Edit3 size={15}/></button><button onClick={onDelete}><Trash2 size={15}/></button></div>};function Empty({text}:{text:string}){return <div className="empty"><Package size={22}/><b>{text}</b></div>}
function POS({products,categories,customers,query,onDone}:{products:Product[];categories:Category[];customers:Customer[];query:string;onDone:(receipt:any,soldItems:CartItem[])=>void}){
 const [activeCategory,setActiveCategory]=useState('Semua');
 const [cart,setCart]=useState<CartItem[]>([]);
 const [customer,setCustomer]=useState('');
 const [customerOpen,setCustomerOpen]=useState(false);
 const [customerSearch,setCustomerSearch]=useState('');
 const [note,setNote]=useState('');
 const [payment,setPayment]=useState<'cash'|'ewallet'|'atm'>('cash');
 const [paid,setPaid]=useState('');
 const [saving,setSaving]=useState(false);
 const [receipt,setReceipt]=useState<any>(null);
 const [receiptPaper,setReceiptPaper]=useState<'58'|'80'>('80');
 const [paymentError,setPaymentError]=useState('');
 const menuCategories=['Semua',...categories.map(c=>c.name)];
 const q=(query||'').trim().toLowerCase();
 const customerQ=customerSearch.trim().toLowerCase();
 const visibleCustomers=customers.filter(c=>!customerQ||[c.name||'',c.phone||'',c.email||''].join(' ').toLowerCase().includes(customerQ));
 useEffect(()=>{if(customer&&!customers.some(c=>c.id===customer))setCustomer('')},[customer,customers]);
 const visibleProducts=products.filter(p=>p.is_active&&p.stock>0&&(activeCategory==='Semua'||p.categories?.name===activeCategory)&&(!q||[p.name,p.description||'',p.categories?.name||'',String(p.stock),String(p.price)].join(' ').toLowerCase().includes(q)));
 const total=cart.reduce((a,p)=>a+Number(p.price)*p.qty,0);
 const paymentOptions=[
  {value:'cash' as const,label:'Tunai',hint:'Pembayaran tunai secara langsung',icon:'Rp',tone:'cash'},
  {value:'ewallet' as const,label:'E-Wallet',hint:'Pembayaran melalui e-wallet',icon:'▰',tone:'dana'},
  {value:'atm' as const,label:'ATM',hint:'Pembayaran melalui kartu debit atau ATM',icon:'⌁',tone:'bank'}
 ];
 const add=(p:Product)=>{
  setPaymentError('');
  setCart(c=>c.some(x=>x.id===p.id)?c.map(x=>x.id===p.id?{...x,qty:Math.min(x.qty+1,p.stock)}:x):[...c,{...p,qty:1}]);
 };
 const checkout=async()=>{
  if(!cart.length||saving)return;
  setSaving(true);setPaymentError('');
  try{
   const amount=payment==='cash'?Number(paid||0):total;
   const result=await runWithAuthRetry(()=>supabase.rpc('create_sale',{p_customer_id:customer||null,p_payment_method:payment,p_amount_paid:amount,p_items:cart.map(x=>({product_id:x.id,quantity:x.qty})),p_note:note.trim()||null}));
   if(result.error)throw result.error;
   const soldItems=cart.map(x=>({...x}));
   const createdOrderId=result.data?.id;
   let newOrderItems:OrderItem[]=[];
   if(createdOrderId){
    const sessionNow=await ensureFreshSession();
    const itemResult=await runWithAuthRetry(()=>supabase.from('order_items').select('*').eq('order_id',createdOrderId).eq('owner_id',sessionNow!.user.id));
    if(!itemResult.error) newOrderItems=(itemResult.data||[]) as OrderItem[];
   }
   const receiptData={...result.data,customer_id:customer||null,payment_method:payment,notes:note.trim()||null,created_at:new Date().toISOString(),items:soldItems};setReceipt(receiptData);setCart([]);setPaid('');setNote('');onDone(receiptData,soldItems,newOrderItems);
  }catch(err:any){setPaymentError(friendlySupabaseError(err));}
  finally{setSaving(false)}
 };
 const change=Math.max(0,Number(paid||0)-total);
 const printReceipt=()=>{
  const receiptNode=document.querySelector(`.premium-receipt.thermal-${receiptPaper}`) as HTMLElement|null;
  if(!receiptNode){window.print();return;}
  const receiptClone=receiptNode.cloneNode(true) as HTMLElement;
  receiptClone.querySelector('.receipt-print-controls')?.remove();
  const paperWidth=receiptPaper==='58'?'58mm':'80mm';
  const printWindow=window.open('', '_blank');
  if(!printWindow){window.print();return;}
  printWindow.document.open();
  printWindow.document.write(`<!doctype html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>Struk ${receipt.order_number||''}</title><style>
   @page{size:${paperWidth} auto;margin:0}
   *{box-sizing:border-box}html,body{margin:0;padding:0;background:#fff;color:#000;font-family:Arial,Helvetica,sans-serif}body{width:${paperWidth};max-width:${paperWidth}}
   .premium-receipt{display:block;width:${paperWidth};max-width:${paperWidth};padding:${receiptPaper==='58'?'3mm':'4mm'};margin:0;background:#fff;color:#000;font-size:${receiptPaper==='58'?'8pt':'9pt'};overflow:hidden}
   .receipt-store-header{text-align:center;padding:1mm 0 2.5mm;border-bottom:.25mm dashed #555}.receipt-store-brand{font-size:${receiptPaper==='58'?'14pt':'16pt'};font-weight:900;letter-spacing:.04em;line-height:1.1}.receipt-store-address{margin-top:1.2mm;font-size:7pt;line-height:1.45;color:#222}.receipt-store-contact{margin-top:.8mm;font-size:6.5pt;color:#444}
   .receipt-document-title{text-align:center;font-size:7pt;font-weight:800;letter-spacing:.16em;padding:2.5mm 0 1.5mm}.receipt-transaction-info{display:grid;gap:1mm;padding-bottom:2mm;border-bottom:.2mm dashed #777}.receipt-info-row{display:flex;justify-content:space-between;gap:3mm;font-size:7pt}.receipt-info-row span{color:#444}.receipt-info-row b{text-align:right;font-size:7pt}.receipt-success{display:none}
   .receipt-items{margin-top:2mm;border:0}.receipt-items-head{display:flex;justify-content:space-between;padding:1.5mm 0;border-bottom:.25mm solid #000}.receipt-items-head span{font-size:8pt;font-weight:800}.receipt-items-head small{font-size:7pt;color:#333}.receipt-item-list{padding:0}.receipt-item{display:flex;justify-content:space-between;align-items:flex-start;gap:3mm;padding:2mm 0;border-bottom:.2mm dashed #999;break-inside:avoid}.receipt-item-info{min-width:0;display:grid;gap:1mm}.receipt-item-info b{font-size:8pt;white-space:normal;overflow:visible}.receipt-item-info small{font-size:7pt;color:#333}.receipt-item>strong{font-size:8pt;white-space:nowrap}
   .receipt-totals{margin-top:2mm;padding:1.5mm 0;border-top:.25mm solid #000;border-bottom:.25mm solid #000}.receipt-total-row{display:flex;justify-content:space-between;gap:3mm;padding:1mm 0;font-size:8pt}.receipt-total-row.grand{padding-top:2mm;font-size:10pt;font-weight:900}.receipt-total-row.grand b{font-size:${receiptPaper==='58'?'12pt':'14pt'}}.receipt-payment-detail{margin-top:2mm;display:grid;gap:1mm;padding-bottom:2mm;border-bottom:.2mm dashed #777}.receipt-payment-detail .receipt-info-row{font-size:7pt}
   .receipt-footer{text-align:center;padding-top:3mm;display:grid;gap:1.2mm}.receipt-footer b{font-size:8pt}.receipt-footer span{font-size:7pt;line-height:1.45;color:#222}.receipt-footer small{font-size:6pt;color:#555}.receipt-print-controls{display:none!important}
  </style></head><body>${receiptClone.outerHTML}</body></html>`);
  printWindow.document.close();
  const startPrint=()=>{printWindow.focus();setTimeout(()=>printWindow.print(),250)};
  if(printWindow.document.readyState==='complete')setTimeout(startPrint,120);else printWindow.onload=startPrint;
 };
 return <div className="pos-reference-page">
  <section className="pos-catalog">
   <div className="reference-category-head"><div><span>Menu Produk</span></div><div className="view-switch"><button className="active" type="button"><Boxes size={16}/></button><button type="button"><SlidersHorizontal size={16}/></button></div></div>
   <div className="reference-categories">{menuCategories.map((c,i)=><button type="button" key={c} className={activeCategory===c?'active':''} onClick={()=>setActiveCategory(c)}>{i===0?<ShoppingBag size={16}/>:<Package size={15}/>}<span>{c}</span></button>)}</div>
   {q&&<div className="pos-search-result-head"><div><span>HASIL PENCARIAN</span><h3>{visibleProducts.length?`${visibleProducts.length} produk ditemukan`:'Produk tidak ditemukan'}</h3><p>Menampilkan menu yang cocok dengan <b>“{query}”</b></p></div><div className="pos-search-query"><Search size={15}/><span>{query}</span><b>{visibleProducts.length}</b></div></div>}
   <div className={`reference-product-grid ${q?'is-searching':''}`}>{visibleProducts.map(p=><motion.div whileTap={{scale:.995}} className="reference-product-card" key={p.id}>
    <div className="reference-food-image">{p.image_url?<img src={p.image_url} alt={p.name}/>:<span>🍜</span>}<em>Stok {p.stock}</em></div>
    <div className="reference-product-info"><b>{p.name}</b><strong>{money(Number(p.price))}</strong><button type="button" onClick={(event)=>{add(p);event.currentTarget.blur()}} aria-label={`Tambah ${p.name} ke pesanan`}>＋&nbsp; Tambah Menu</button></div>
   </motion.div>)}</div>
   {!visibleProducts.length&&<div className="reference-product-empty pos-search-empty"><div className="pos-search-empty-icon"><Search size={24}/></div><b>Tidak ada produk yang cocok</b><span>Coba gunakan nama menu atau kategori lain.</span></div>}
  </section>

  <section className="reference-order-panel">
   <div className="reference-order-left">
    <div className="reference-order-head"><h2><ShoppingBag size={20}/> Pesanan ({cart.length})</h2></div>
    <div className="reference-order-items">
     {cart.map((p,index)=><div className="reference-order-item" key={p.id}>
      <span className="reference-order-number">{index+1}</span>
      <div className="reference-order-thumb">{p.image_url?<img src={p.image_url} alt=""/>:<span>🍜</span>}</div>
      <div className="reference-order-main"><b>{p.name}</b><small>{money(Number(p.price))}</small></div>
      <div className="reference-stepper"><button type="button" onClick={()=>setCart(c=>c.map(x=>x.id===p.id?{...x,qty:Math.max(1,x.qty-1)}:x))}>−</button><b>{p.qty}</b><button type="button" onClick={()=>add(p)}>+</button></div>
      <strong>{money(Number(p.price)*p.qty)}</strong>
      <button type="button" className="reference-order-remove" onClick={()=>setCart(c=>c.filter(x=>x.id!==p.id))}><Trash2 size={16}/></button>
     </div>)}
     {!cart.length&&<div className="reference-order-empty"><ShoppingBag size={24}/><b>Belum ada pesanan</b><span>Pilih produk di atas untuk menambah pesanan.</span></div>}
    </div>
    <div className="reference-order-fields">
     <div className="reference-field reference-customer-field">
      <span>Pelanggan</span>
      <CustomerPicker customers={customers} value={customer} onChange={setCustomer}/>
     </div>
     <label className="reference-field"><span>Catatan (Opsional)</span><input value={note} onChange={e=>setNote(e.target.value)} placeholder="Contoh: Tidak pakai cabe, extra pedas, dll"/></label>
    </div>
   </div>

   <div className="reference-payment-panel">
    <span className="payment-methods-label">Metode Pembayaran</span>
    <div className="reference-payment-options">{paymentOptions.map(option=><button type="button" key={option.value} className={payment===option.value?'active':''} onClick={()=>{setPayment(option.value);if(option.value!=='cash')setPaid('')}}>
     <i className={option.tone}>{option.icon}</i><span><b>{option.label}</b><small>{option.hint}</small></span><em>✓</em>
    </button>)}</div>
    {payment==='cash'&&<div className="reference-cash-area"><label>Nominal diterima</label><div className="reference-cash-input"><span>Rp</span><input type="number" min={total} value={paid} onChange={e=>setPaid(e.target.value)} placeholder={String(total||0)}/></div>{Number(paid)>0&&<small>Kembalian: <b>{money(change)}</b></small>}</div>}
    <div className="reference-secure"><ShieldCheck size={18}/><span>Semua pembayaran aman dan terpercaya</span></div>
    <div className="reference-payment-total"><div><span>Subtotal</span><b>{money(total)}</b></div><div className="grand"><span>Total pembayaran</span><strong>{money(total)}</strong></div></div>
    {paymentError&&<div className="error payment-error"><span>{paymentError}</span><button onClick={()=>setPaymentError('')}><X size={16}/></button></div>}
    <div className="reference-cart-actions reference-cart-actions-premium"><button type="button" className="reference-pay" disabled={!cart.length||saving||(payment==='cash'&&Number(paid)<total)} onClick={checkout}><ShoppingBag size={17}/> {saving?'Memproses…':'Bayar sekarang'}<kbd>F9</kbd></button></div>
    {receipt&&<div className={`receipt premium-receipt thermal-${receiptPaper}`}>
     <div className="receipt-store-header">
      <div className="receipt-store-brand">{RECEIPT_STORE.name}</div>
      <div className="receipt-store-address">{RECEIPT_STORE.address}</div>
      {RECEIPT_STORE.phone&&<div className="receipt-store-contact">Tel. {RECEIPT_STORE.phone}</div>}
     </div>
     <div className="receipt-document-title">BUKTI PEMBAYARAN</div>
     <div className="receipt-transaction-info">
      <div className="receipt-info-row"><span>No. Transaksi</span><b>#{receipt.order_number||receipt.id}</b></div>
      <div className="receipt-info-row"><span>Tanggal</span><b>{new Date(receipt.created_at||Date.now()).toLocaleString('id-ID',{dateStyle:'medium',timeStyle:'short'})}</b></div>
      <div className="receipt-info-row"><span>Pembayaran</span><b>{receipt.payment_method==='cash'?'Tunai':receipt.payment_method==='qris'||receipt.payment_method==='ewallet'?'E-Wallet':'ATM'}</b></div>
     </div>
     <div className="receipt-items">
      <div className="receipt-items-head"><span>ITEM PESANAN</span><small>{(receipt.items||[]).reduce((sum:any,item:any)=>sum+Number(item.qty||0),0)} item</small></div>
      <div className="receipt-item-list">{(receipt.items||[]).map((item:any,index:number)=><div className="receipt-item" key={`${item.id}-${index}`}><div className="receipt-item-info"><b>{item.name}</b><small>{item.qty} × {money(Number(item.price||0))}</small></div><strong>{money(Number(item.price||0)*Number(item.qty||0))}</strong></div>)}</div>
     </div>
     <div className="receipt-totals">
      <div className="receipt-total-row"><span>Subtotal</span><b>{money(Number(receipt.subtotal??receipt.total??0))}</b></div>
      <div className="receipt-total-row"><span>Dibayar</span><b>{money(Number(receipt.amount_paid??receipt.total??0))}</b></div>
      <div className="receipt-total-row grand"><span>TOTAL</span><b>{money(Number(receipt.total||0))}</b></div>
     </div>
     <div className="receipt-payment-detail">
      <div className="receipt-info-row"><span>Kembalian</span><b>{money(receipt.change_due||0)}</b></div>
      <div className="receipt-info-row"><span>Status</span><b className="receipt-paid">BERHASIL</b></div>
     </div>
     <div className="receipt-footer"><b>Terima kasih</b><span>{RECEIPT_STORE.footer}</span><small>Simpan struk ini sebagai bukti transaksi.</small></div>
     <div className="receipt-print-controls" aria-label="Pengaturan cetak thermal">
      <div className="receipt-paper-picker">
       <button type="button" className={receiptPaper==='58'?"active":""} onClick={()=>setReceiptPaper('58')}>58 mm</button>
       <button type="button" className={receiptPaper==='80'?"active":""} onClick={()=>setReceiptPaper('80')}>80 mm</button>
      </div>
      <button type="button" className="receipt-print-button" onClick={printReceipt}><Printer size={17}/> Cetak struk {receiptPaper}mm</button>
     </div>
    </div>}
   </div>
  </section>
 </div>
}
function Orders({orders,orderItems,query,onOpen}:any){
 const [method,setMethod]=useState('all');
 const [status,setStatus]=useState('all');
 const [range,setRange]=useState('all');
 const [rangeOpen,setRangeOpen]=useState(false);
 const [methodOpen,setMethodOpen]=useState(false);
 const [statusOpen,setStatusOpen]=useState(false);
 const [pageIndex,setPageIndex]=useState(1);
 const pageSize=10;
 const [sort,setSort]=useState('newest');
 const [sortOpen,setSortOpen]=useState(false);
 const [view,setView]=useState<'list'|'compact'>('list');
 const [localSearch,setLocalSearch]=useState('');
 const q=(localSearch.trim()||query||'').trim().toLowerCase();
 const paymentLabel=(v:string)=>v==='cash'?'Tunai':v==='qris'||v==='ewallet'?'E-Wallet':v==='card'||v==='atm'?'ATM':(v||'').toUpperCase();
 const paymentTone=(v:string)=>v==='cash'?'cash':v==='qris'||v==='ewallet'?'qris':v==='card'||v==='atm'?'card':'ewallet';
 useEffect(()=>{setPageIndex(1)},[q]);
 const base=orders.filter((o:Order)=>{
   const date=new Date(o.created_at);
   const hay=[
     o.order_number,o.id,o.status,o.payment_method,paymentLabel(o.payment_method),
     o.customers?.name||'',o.customers?.phone||'',o.customers?.email||'',
     String(o.total),date.toLocaleString('id-ID'),date.toLocaleDateString('id-ID'),
     date.toISOString(),date.toISOString().slice(0,10),
     date.toLocaleDateString('id-ID',{day:'2-digit',month:'long',year:'numeric'}),
     date.toLocaleDateString('id-ID',{day:'numeric',month:'long',year:'numeric'})
   ].join(' ').toLowerCase();
   return !q||hay.includes(q);
 });
 const now=Date.now();
 const filtered=base.filter((o:Order)=>{
   const methodOk=method==='all'||(method==='cash'&&o.payment_method==='cash')||(method==='ewallet'&&['qris','ewallet'].includes(o.payment_method))||(method==='atm'&&['card','atm'].includes(o.payment_method));
   const statusOk=status==='all'||(status==='success'?o.status==='completed':o.status===status);
   const age=now-new Date(o.created_at).getTime();
   const rangeOk=range==='all'||(range==='today'?age<86400000:range==='week'?age<604800000:range==='month'?age<2592000000:true);
   return methodOk&&statusOk&&rangeOk;
 }).sort((a:Order,b:Order)=>sort==='oldest'?new Date(a.created_at).getTime()-new Date(b.created_at).getTime():new Date(b.created_at).getTime()-new Date(a.created_at).getTime());
 const totalPages=Math.max(1,Math.ceil(filtered.length/pageSize));
 const safePage=Math.min(pageIndex,totalPages);
 const paged=filtered.slice((safePage-1)*pageSize,safePage*pageSize);
 const setMethodFilter=(value:string)=>{setMethod(value);setPageIndex(1);setMethodOpen(false)};
 const setStatusFilter=(value:string)=>{setStatus(value);setPageIndex(1);setStatusOpen(false)};
 const completed=base.filter((o:Order)=>o.status==='completed');
 const total=completed.reduce((sum:number,o:Order)=>sum+Number(o.total||0),0);
 const avg=completed.length?total/completed.length:0;
 const methods=completed.reduce((m:any,o:Order)=>{m[o.payment_method]=(m[o.payment_method]||0)+1;return m},{});
 const topMethod=Object.entries(methods).sort((a:any,b:any)=>b[1]-a[1])[0]?.[0]||'cash';
 const topPct=completed.length?Math.round(((methods[topMethod]||0)/completed.length)*100):0;
 const itemCount=(o:Order)=>orderItems.filter((i:OrderItem)=>i.order_id===o.id).reduce((sum:number,i:OrderItem)=>sum+Number(i.quantity||0),0);
 return <div className="orders-page orders-premium-page">
   <div className="orders-premium-head">
    <div className="orders-premium-title"><div className="orders-hero-icon"><WalletCards size={24}/></div><div><span className="eyebrow">TRANSACTION CENTER</span><h2>Riwayat Transaksi <Sparkles size={19}/></h2><p>Semua pembayaran tersimpan rapi, cepat dicari, dan siap dibuka kapan saja.</p></div></div>
   </div>
   <section className="orders-premium-kpis">
    <div className="orders-kpi violet"><i><CalendarDays size={19}/></i><span>Total Transaksi</span><b>{completed.length}</b><small>↑ Data transaksi tersimpan</small></div>
    <div className="orders-kpi green"><i><WalletCards size={19}/></i><span>Total Omzet</span><b>{money(total)}</b><small>↑ Pembayaran berhasil</small></div>
    <div className="orders-kpi blue"><i><TrendingUp size={19}/></i><span>Rata-rata Transaksi</span><b>{money(avg)}</b><small>Per transaksi selesai</small></div>
    <div className="orders-kpi orange"><i><CreditCard size={19}/></i><span>Metode Terbanyak</span><b>{paymentLabel(topMethod)}</b><small>{topPct}% dari total transaksi</small></div>
   </section>
   <section className="surface orders-premium-surface">
    <div className="orders-filter-bar">
      <button className="orders-filter-select orders-period-trigger" type="button" onClick={()=>setRangeOpen(true)} aria-haspopup="dialog" aria-expanded={rangeOpen}>
        <CalendarDays size={16}/><span>{range==='all'?'Semua waktu':range==='today'?'24 jam terakhir':range==='week'?'7 hari terakhir':'30 hari terakhir'}</span><ChevronDown size={14}/>
      </button>
      <button className="orders-filter-select orders-period-trigger" type="button" onClick={()=>setMethodOpen(true)}><CreditCard size={16}/><span>{method==='all'?'Semua Metode':method==='cash'?'Tunai':method==='ewallet'?'E-Wallet':'ATM'}</span><ChevronDown size={14}/></button>
      <button className="orders-filter-select orders-period-trigger" type="button" onClick={()=>setStatusOpen(true)}><CheckCircle2 size={16}/><span>{status==='all'?'Semua Status':'Berhasil'}</span><ChevronDown size={14}/></button>
      <label className="orders-filter-search"><Search size={16}/><input value={localSearch} onChange={e=>{setLocalSearch(e.target.value);setPageIndex(1)}} placeholder="Cari kode pembayaran, tanggal, pelanggan..." aria-label="Cari transaksi"/><button type="button" className="orders-search-clear" onClick={()=>{setLocalSearch('');setPageIndex(1)}} aria-label="Hapus pencarian" style={{display:localSearch?'grid':'none'}}>×</button></label>
    </div>
    <div className="orders-list-head"><div><h3>Daftar Transaksi</h3><p>{filtered.length} transaksi ditemukan</p></div><div className="orders-list-tools"><button type="button" className="orders-sort-trigger" onClick={()=>setSortOpen(true)} aria-haspopup="dialog" aria-expanded={sortOpen}><span>{sort==='oldest'?'Terlama':'Terbaru'}</span><ChevronDown size={13}/></button><div className="orders-view-toggle"><button className={view==='list'?'active':''} onClick={()=>setView('list')}><MoreHorizontal size={16}/></button><button className={view==='compact'?'active':''} onClick={()=>setView('compact')}><Box size={15}/></button></div></div></div>
    <div className={`orders-premium-list ${view==='compact'?'compact':''}`}>
      {paged.map((o:Order)=>{const d=new Date(o.created_at);return <button className="transaction-card" key={o.id} onClick={()=>onOpen(o)}>
        <span className="transaction-main-icon"><ShoppingBag size={20}/></span>
        <span className="transaction-info"><b>#{o.order_number}</b><small><CalendarDays size={13}/>{d.toLocaleDateString('id-ID',{day:'2-digit',month:'short',year:'numeric'})}<span>•</span><Clock3 size={13}/>{d.toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit'})}</small><strong>{o.customers?.name||'Pelanggan umum'}</strong><em>{o.customers?.phone||'Tanpa nomor telepon'}</em></span>
        <span className={`transaction-payment ${paymentTone(o.payment_method)}`}><i><CreditCard size={15}/></i>{paymentLabel(o.payment_method)}</span>
        <span className="transaction-total"><b>{money(Number(o.total||0))}</b><small>{itemCount(o)} item</small></span>
        <span className="transaction-success"><Check size={14}/>Berhasil</span><ChevronRight size={19} className="transaction-arrow"/>
      </button>})}
    </div>
    {!filtered.length&&<Empty text={q?'Transaksi tidak ditemukan.':'Belum ada transaksi pada filter ini.'}/>} 
    {filtered.length>0&&<div className="orders-pagination"><button disabled={safePage<=1} onClick={()=>setPageIndex(p=>Math.max(1,p-1))}>‹ Sebelumnya</button><div>{Array.from({length:Math.min(totalPages,5)},(_,i)=>{const page=totalPages<=5?i+1:Math.max(1,Math.min(totalPages-4,safePage-2))+i;return <button type="button" key={page} className={page===safePage?'active':''} onClick={()=>setPageIndex(page)}>{page}</button>})}{totalPages>5&&safePage<totalPages-2&&<span>…</span>}</div><button disabled={safePage>=totalPages} onClick={()=>setPageIndex(p=>Math.min(totalPages,p+1))}>Selanjutnya ›</button></div>}
   </section>
   {sortOpen&&<div className="orders-sort-overlay" role="presentation" onClick={()=>setSortOpen(false)}><div className="orders-sort-sheet" role="dialog" aria-modal="true" aria-labelledby="orders-sort-title" onClick={e=>e.stopPropagation()}><div className="orders-sort-head"><div><span className="eyebrow">URUTKAN TRANSAKSI</span><h3 id="orders-sort-title">Pilih urutan</h3><p>Tentukan transaksi yang ingin ditampilkan lebih dahulu.</p></div><button type="button" className="orders-period-close" onClick={()=>setSortOpen(false)} aria-label="Tutup"><X size={18}/></button></div><div className="orders-sort-options">{[['newest','Terbaru','Transaksi paling baru ditampilkan lebih dahulu'],['oldest','Terlama','Transaksi paling lama ditampilkan lebih dahulu']].map(([value,title,desc])=>{const active=sort===value;return <button type="button" key={value} className={`orders-sort-option ${active?'active':''}`} onClick={()=>{setSort(value);setPageIndex(1);setSortOpen(false)}}><span className="orders-sort-option-copy"><b>{title}</b><small>{desc}</small></span><span className="orders-period-check">{active&&<Check size={16}/>}</span></button>})}</div></div></div>}
   <AnimatePresence>
    {methodOpen&&<motion.div className="orders-period-overlay" initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} onClick={()=>setMethodOpen(false)}><motion.div className="orders-period-sheet" initial={{opacity:0,y:24,scale:.985}} animate={{opacity:1,y:0,scale:1}} exit={{opacity:0,y:18,scale:.99}} onClick={e=>e.stopPropagation()}><div className="orders-period-handle"/><div className="orders-period-head"><div><span className="eyebrow">PAYMENT METHOD</span><h3>Pilih metode pembayaran</h3><p>Filter transaksi berdasarkan metode pembayaran.</p></div><button type="button" className="orders-period-close" onClick={()=>setMethodOpen(false)}><X size={18}/></button></div><div className="orders-period-options">{[['all','Semua Metode','Semua pembayaran'],['cash','Tunai','Pembayaran tunai'],['ewallet','E-Wallet','Pembayaran dompet digital'],['atm','ATM','Pembayaran kartu atau ATM']].map(([value,title,desc])=>{const active=method===value;return <button type="button" key={value} className={`orders-period-option ${active?'active':''}`} onClick={()=>setMethodFilter(value)}><span className="orders-period-option-icon"><CreditCard size={18}/></span><span className="orders-period-option-copy"><b>{title}</b><small>{desc}</small></span><span className="orders-period-check">{active&&<Check size={16}/>}</span></button>})}</div><div className="orders-period-footer"><button type="button" onClick={()=>setMethodOpen(false)}>Selesai</button></div></motion.div></motion.div>}
    {statusOpen&&<motion.div className="orders-period-overlay" initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} onClick={()=>setStatusOpen(false)}><motion.div className="orders-period-sheet" initial={{opacity:0,y:24,scale:.985}} animate={{opacity:1,y:0,scale:1}} exit={{opacity:0,y:18,scale:.99}} onClick={e=>e.stopPropagation()}><div className="orders-period-handle"/><div className="orders-period-head"><div><span className="eyebrow">TRANSACTION STATUS</span><h3>Pilih status transaksi</h3><p>Filter riwayat berdasarkan status pembayaran.</p></div><button type="button" className="orders-period-close" onClick={()=>setStatusOpen(false)}><X size={18}/></button></div><div className="orders-period-options">{[['all','Semua Status','Seluruh transaksi'],['success','Berhasil','Pembayaran berhasil diselesaikan']].map(([value,title,desc])=>{const active=status===value;return <button type="button" key={value} className={`orders-period-option ${active?'active':''}`} onClick={()=>setStatusFilter(value)}><span className="orders-period-option-icon"><CheckCircle2 size={18}/></span><span className="orders-period-option-copy"><b>{title}</b><small>{desc}</small></span><span className="orders-period-check">{active&&<Check size={16}/>}</span></button>})}</div><div className="orders-period-footer"><button type="button" onClick={()=>setStatusOpen(false)}>Selesai</button></div></motion.div></motion.div>}
    {rangeOpen&&<motion.div className="orders-period-overlay" initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} onClick={()=>setRangeOpen(false)}>
      <motion.div className="orders-period-sheet" role="dialog" aria-modal="true" aria-labelledby="orders-period-title" initial={{opacity:0,y:24,scale:.985}} animate={{opacity:1,y:0,scale:1}} exit={{opacity:0,y:18,scale:.99}} transition={{duration:.22,ease:'easeOut'}} onClick={e=>e.stopPropagation()}>
        <div className="orders-period-handle" aria-hidden="true"/>
        <div className="orders-period-head">
          <div><span className="eyebrow">TRANSACTION FILTER</span><h3 id="orders-period-title">Pilih periode transaksi</h3><p>Tentukan rentang data yang ingin ditampilkan.</p></div>
          <button type="button" className="orders-period-close" onClick={()=>setRangeOpen(false)} aria-label="Tutup"><X size={18}/></button>
        </div>
        <div className="orders-period-options">
          {[
            ['all','Semua waktu','Seluruh riwayat transaksi'],
            ['today','24 jam terakhir','Aktivitas dalam satu hari terakhir'],
            ['week','7 hari terakhir','Ringkasan transaksi satu minggu'],
            ['month','30 hari terakhir','Analisis transaksi satu bulan']
          ].map(([value,title,desc])=>{
            const active=range===value;
            return <button type="button" key={value} className={`orders-period-option ${active?'active':''}`} onClick={()=>{setRange(value);setPageIndex(1);setRangeOpen(false)}}>
              <span className="orders-period-option-icon"><CalendarDays size={18}/></span>
              <span className="orders-period-option-copy"><b>{title}</b><small>{desc}</small></span>
              <span className="orders-period-check">{active&&<Check size={16}/>}</span>
            </button>
          })}
        </div>
        <div className="orders-period-footer"><button type="button" onClick={()=>setRangeOpen(false)}>Selesai</button></div>
      </motion.div>
    </motion.div>}
   </AnimatePresence>
 </div>
}
function OrderDetailModal({order,items,onClose,money}:{order:Order;items:OrderItem[];onClose:()=>void;money:(n:number)=>string}){return <motion.div className="modal-backdrop order-detail-backdrop" initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} onMouseDown={onClose}><motion.div className="order-detail-modal" initial={{y:22,scale:.98}} animate={{y:0,scale:1}} onMouseDown={e=>e.stopPropagation()}><div className="order-detail-head"><div><span>TRANSACTION DETAIL</span><h2>#{order.order_number}</h2><p>{new Date(order.created_at).toLocaleString('id-ID',{dateStyle:'full',timeStyle:'short'})}</p></div><button onClick={onClose}><X size={18}/></button></div><div className="order-detail-status"><div><CheckCircle2 size={18}/><span>Pembayaran berhasil</span></div><b>{order.status}</b></div><div className="order-detail-grid"><div className="order-detail-card"><span>PELANGGAN</span><b>{order.customers?.name||'Pelanggan umum'}</b><small>{order.customers?.phone||'Tanpa nomor telepon'}</small></div><div className="order-detail-card"><span>METODE BAYAR</span><b>{order.payment_method==='cash'?'Tunai':order.payment_method==='qris'||order.payment_method==='ewallet'?'E-Wallet':order.payment_method==='card'||order.payment_method==='atm'?'ATM':order.payment_method.toUpperCase()}</b><small>Dibayar {money(Number(order.amount_paid||order.total))}</small></div></div><div className="order-detail-items"><div className="order-detail-section-title"><div><span>ITEM TRANSAKSI</span><b>{items.reduce((a,i)=>a+Number(i.quantity),0)} item</b></div></div>{items.length?items.map(i=><div className="order-detail-item" key={i.id}><div className="order-detail-item-no">{i.quantity}×</div><div><b>{i.product_name}</b><small>{money(Number(i.unit_price))} / item</small></div><strong>{money(Number(i.line_total))}</strong></div>):<div className="order-detail-empty"><PackageOpen size={22}/><span>Detail item belum tersedia.</span></div>}</div>{order.notes&&<div className="order-detail-note"><span>CATATAN PESANAN</span><p>{order.notes}</p></div>}<div className="order-detail-total"><span>Subtotal</span><b>{money(Number(order.subtotal))}</b><span>Diskon</span><b>- {money(Number(order.discount||0))}</b><strong>Total pembayaran</strong><strong>{money(Number(order.total))}</strong><span>Kembalian</span><b>{money(Number(order.change_due||0))}</b></div><div className="order-detail-footer"><div><ShieldCheck size={16}/><span>Transaksi tersimpan aman di Mieflow</span></div><button className="secondary" onClick={onClose}>Tutup</button></div></motion.div></motion.div>}
function Inventory({products,query,onStockChange,onAdd,onDelete}:{products:Product[];query:string;onStockChange:(id:string,stock:number)=>void;onAdd:()=>void;onDelete:(id:string)=>void}){
 const [search,setSearch]=useState('');
 const [filter,setFilter]=useState<'all'|'good'|'low'|'out'>('all');
 const [filterOpen,setFilterOpen]=useState(false);
 const [busy,setBusy]=useState<string|null>(null);
 const [localStock,setLocalStock]=useState<Record<string,number>>({});
 const totalUnits=products.reduce((sum,p)=>sum+Math.max(0,Number(p.stock)||0),0);
 const low=products.filter(p=>p.stock>0&&p.stock<5);
 const out=products.filter(p=>p.stock<=0);
 const filtered=products.filter(p=>{
  const q=(search||query||'').trim().toLowerCase();
  const matches=!q||[p.name,p.description||'',p.categories?.name||'',String(p.stock),String(p.price)].join(' ').toLowerCase().includes(q);
  const status=filter==='good'?p.stock>=5:filter==='low'?p.stock>0&&p.stock<5:filter==='out'?p.stock<=0:true;
  return matches&&status;
 });
 const adjust=async(p:Product,d:number)=>{
  try{
   setBusy(p.id);
   const sessionNow=await ensureFreshSession();
   if(!sessionNow)throw new Error('Sesi login sudah berakhir. Silakan login kembali.');
   const current=localStock[p.id]??p.stock;
   const next=Math.max(0,current+d);
   const res=await runWithAuthRetry(()=>supabase.from('products').update({stock:next}).eq('id',p.id).eq('owner_id',sessionNow.user.id));
   if(res.error)throw res.error;
   const movement=await runWithAuthRetry(()=>supabase.from('stock_movements').insert({owner_id:sessionNow.user.id,product_id:p.id,quantity_delta:d,reason:'manual adjustment'}));
   if(movement.error)throw movement.error;
   setLocalStock(prev=>({...prev,[p.id]:next}));
   onStockChange(p.id,next);
  }catch(err:any){alert(friendlySupabaseError(err))}finally{setBusy(null)}
 };
 const statusOf=(stock:number)=>stock<=0?'Out of stock':stock<5?'Low stock':'Good';
 const statusClass=(stock:number)=>stock<=0?'out':stock<5?'low':'good';
 return <div className="inventory-page">
  <div className="inventory-hero">
   <div><span className="eyebrow">STOCK CONTROL</span><h1>Inventory Management</h1><p>Pantau ketersediaan produk dan lakukan penyesuaian stok dengan cepat.</p></div>
   <div className="inventory-hero-actions"><button className="primary inventory-add" onClick={onAdd}><Plus size={16}/> Tambah produk</button></div>
  </div>
  <div className="inventory-kpis">
   <InventoryKpi icon={Boxes} tone="teal" label="Total items" value={totalUnits.toLocaleString('id-ID')} detail={`${products.length} produk terdaftar`}/>
   <InventoryKpi icon={AlertTriangle} tone="amber" label="Low stock" value={low.length} detail="Perlu perhatian"/>
   <InventoryKpi icon={PackageOpen} tone="rose" label="Out of stock" value={out.length} detail="Tidak tersedia"/>
   <InventoryKpi icon={CheckCircle2} tone="green" label="Good stock" value={products.filter(p=>p.stock>=5).length} detail="Stok aman"/>
  </div>
  <section className="surface inventory-overview">
   <div className="inventory-section-head"><div><span className="section-label">INVENTORY OVERVIEW</span><h2>Daftar persediaan</h2><p>Kelola stok setiap produk dari satu tempat.</p></div><div className="inventory-health"><i/> Sistem stok aktif</div></div>
   <div className="inventory-toolbar"><label className="inventory-search"><Search size={16}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Cari produk atau kategori..."/></label><div className="inventory-filters"><button className={filter==='all'?'active':''} onClick={()=>setFilter('all')}>Semua <b>{products.length}</b></button><button className={filter==='low'?'active':''} onClick={()=>setFilter('low')}>Low stock <b>{low.length}</b></button><button className={filter==='out'?'active':''} onClick={()=>setFilter('out')}>Out of stock <b>{out.length}</b></button></div><button className="inventory-filter-btn" type="button" onClick={()=>setFilterOpen(v=>!v)}><SlidersHorizontal size={15}/> Filter</button></div>
   {filterOpen&&<div className="inventory-mobile-filter"><button className={filter==='all'?'active':''} onClick={()=>{setFilter('all');setFilterOpen(false)}}>Semua</button><button className={filter==='good'?'active':''} onClick={()=>{setFilter('good');setFilterOpen(false)}}>Stok aman</button><button className={filter==='low'?'active':''} onClick={()=>{setFilter('low');setFilterOpen(false)}}>Stok menipis</button><button className={filter==='out'?'active':''} onClick={()=>{setFilter('out');setFilterOpen(false)}}>Habis</button></div>}
   <div className="inventory-table-wrap"><div className="inventory-table-head"><span>Produk</span><span>Stok</span><span>Kategori</span><span>Status</span><span>Update</span><span>Aksi</span></div>
    {filtered.map(p=><div className="inventory-row" key={p.id}>
     <div className="inventory-product"><div className="inventory-thumb">{p.image_url?<img src={p.image_url} alt=""/>:<Package size={21}/>}</div><div><b>{p.name}</b><small>{p.description||'Produk Mieflow'}</small></div></div>
     <div className="inventory-qty"><strong className={statusClass(p.stock)}>{p.stock}</strong><span>unit</span></div>
     <div className="inventory-category"><span><i/><b>{p.categories?.name||'Tanpa kategori'}</b></span></div>
     <div><span className={`inventory-status ${statusClass(p.stock)}`}><i/>{statusOf(p.stock)}</span></div>
     <div className="inventory-updated"><Clock3 size={14}/><span>Baru saja</span></div>
     <div className="inventory-actions"><button disabled={busy===p.id||(localStock[p.id]??p.stock)<=0} onClick={()=>adjust({...p,stock:localStock[p.id]??p.stock},-1)} aria-label={`Kurangi stok ${p.name}`}>−</button><span>{busy===p.id?'...':(localStock[p.id]??p.stock)}</span><button disabled={busy===p.id} onClick={()=>adjust({...p,stock:localStock[p.id]??p.stock},1)} aria-label={`Tambah stok ${p.name}`}>+</button><button type="button" className="inventory-more inventory-delete" aria-label={`Hapus ${p.name}`} title={`Hapus ${p.name}`} onClick={()=>onDelete(p.id)}><Trash2 size={17}/></button></div>
    </div>)}
    {!filtered.length&&<div className="inventory-empty"><PackageOpen size={30}/><b>Produk tidak ditemukan</b><span>Coba kata kunci atau filter yang berbeda.</span></div>}
   </div>
   <div className="inventory-footer"><span>Menampilkan <b>{filtered.length}</b> dari <b>{products.length}</b> produk</span><span className="inventory-footer-note"><MapPin size={14}/> Stok tersinkron dengan POS</span></div>
  </section>
 </div>
}
function InventoryKpi({icon:Icon,tone,label,value,detail}:{icon:any;tone:string;label:string;value:any;detail:string}){return <div className={`inventory-kpi ${tone}`}><div className="inventory-kpi-top"><span className="inventory-kpi-icon"><Icon size={18}/></span><span>{label}</span></div><strong>{value}</strong><small>{detail}</small></div>}
function Analytics({orders,orderItems,products,categories}:any){
 const iso=(d:Date)=>{const x=new Date(d);return `${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,'0')}-${String(x.getDate()).padStart(2,'0')}`};
 const [from,setFrom]=useState(()=>{const d=new Date();d.setDate(d.getDate()-6);return iso(d)}),[to,setTo]=useState(()=>iso(new Date()));
 const [preset,setPreset]=useState('7'),[presetOpen,setPresetOpen]=useState(false),[activePoint,setActivePoint]=useState<number|null>(null),[activeBar,setActiveBar]=useState<number|null>(null);
 const applyPreset=(days:string)=>{setPreset(days);const d=new Date();d.setDate(d.getDate()-(Number(days)-1));setFrom(iso(d));setTo(iso(new Date()))};
 const rangeStart=new Date(`${from}T00:00:00`),rangeEnd=new Date(`${to}T23:59:59`);
 const filtered=orders.filter((o:Order)=>o.status==='completed'&&new Date(o.created_at)>=rangeStart&&new Date(o.created_at)<=rangeEnd);
 const total=filtered.reduce((a:number,o:Order)=>a+Number(o.total||0),0),avg=filtered.length?total/filtered.length:0;
 const customerSet=new Set(filtered.map((o:Order)=>o.customer_id).filter(Boolean));
 const previousStart=new Date(rangeStart);previousStart.setDate(previousStart.getDate()-Math.max(1,Math.ceil((rangeEnd.getTime()-rangeStart.getTime())/86400000)));const previousEnd=new Date(rangeStart);previousEnd.setMilliseconds(-1);
 const previous=orders.filter((o:Order)=>o.status==='completed'&&new Date(o.created_at)>=previousStart&&new Date(o.created_at)<=previousEnd);
 const previousTotal=previous.reduce((a:number,o:Order)=>a+Number(o.total||0),0);
 const growth=(current:number,old:number)=>old?((current-old)/old)*100:null;
 const revenueGrowth=growth(total,previousTotal),orderGrowth=growth(filtered.length,previous.length);
 const days=Math.max(1,Math.round((rangeEnd.getTime()-rangeStart.getTime())/86400000)+1);
 const pointCount=days<=90?days:Math.min(90,days);
 const points=Array.from({length:pointCount},(_,i)=>{const d=new Date(rangeStart);d.setDate(d.getDate()+(pointCount===1?0:Math.round(i*(days-1)/(pointCount-1))));const key=iso(d);const rows=filtered.filter((o:Order)=>iso(new Date(o.created_at))===key);return {label:d.toLocaleDateString('id-ID',{day:'2-digit',month:'short'}).replace('.',''),value:rows.reduce((a,o)=>a+Number(o.total||0),0),count:rows.length}});
 const maxRevenue=Math.max(...points.map(x=>x.value),1),maxOrders=Math.max(...points.map(x=>x.count),1);
 const itemMap=new Map<string,{name:string;qty:number;sales:number;categoryId:string|null}>();
 orderItems.forEach((it:OrderItem)=>{if(!filtered.some(o=>o.id===it.order_id))return;const key=it.product_id||it.product_name;const old=itemMap.get(key)||{name:it.product_name,qty:0,sales:0,categoryId:null};old.qty+=Number(it.quantity||0);old.sales+=Number(it.line_total||0);itemMap.set(key,old)});
 products.forEach((p:Product)=>{const item=itemMap.get(p.id);if(item)item.categoryId=p.category_id||null});
 const topItems=[...itemMap.values()].sort((a,b)=>b.sales-a.sales).slice(0,5);
 const bestDay=[...points].sort((a,b)=>b.value-a.value)[0];
 const delta=(v:number|null)=>v===null?'Belum ada pembanding':`${v>=0?'↑':'↓'} ${Math.abs(v).toFixed(1)}% vs periode sebelumnya`;
 const W=1000,H=320,PX=24,PY=26,BASE=H-38,plotW=W-PX*2,plotH=BASE-PY;
 const coords=points.map((p,i)=>({x:points.length===1?W/2:PX+i*(plotW/(points.length-1)),y:BASE-(p.value/maxRevenue)*plotH}));
 const smoothPath=(arr:{x:number;y:number}[])=>{if(!arr.length)return '';if(arr.length===1)return `M ${arr[0].x} ${arr[0].y}`;let d=`M ${arr[0].x} ${arr[0].y}`;for(let i=0;i<arr.length-1;i++){const p0=arr[i-1]||arr[i],p1=arr[i],p2=arr[i+1],p3=arr[i+2]||p2;const c1x=p1.x+(p2.x-p0.x)/6,c1y=p1.y+(p2.y-p0.y)/6,c2x=p2.x-(p3.x-p1.x)/6,c2y=p2.y-(p3.y-p1.y)/6;d+=` C ${c1x} ${c1y}, ${c2x} ${c2y}, ${p2.x} ${p2.y}`;}return d};
 const linePath=smoothPath(coords),areaPath=`${linePath} L ${coords[coords.length-1]?.x||W/2} ${BASE} L ${coords[0]?.x||W/2} ${BASE} Z`;
 const visibleLabel=(i:number)=>points.length<=7||i===0||i===points.length-1||i%Math.ceil(points.length/5)===0;
 return <div className="analytics analytics-dashboard">
  <section className="analytics-hero">
   <div className="analytics-hero-copy"><div className="analytics-title-row"><span className="analytics-overline"><span/> BUSINESS INTELLIGENCE</span><span className="analytics-live"><i/> Data tersinkron</span></div><h2>Analisis performa,<br/><em>lebih jelas.</em></h2><p>Pantau tren omzet, transaksi, dan produk terbaik dari data penjualan aktual.</p></div>
   <div className="analytics-filter-panel"><div className="analytics-filter-label"><CalendarDays size={17}/><span>Periode analisis</span></div><div className="date-filter"><label>Dari<input type="date" value={from} onChange={e=>{setFrom(e.target.value);setPreset('')}}/></label><span>→</span><label>Sampai<input type="date" value={to} onChange={e=>{setTo(e.target.value);setPreset('')}}/></label><button type="button" className="orders-filter-select orders-period-trigger analytics-preset-trigger" onClick={()=>setPresetOpen(true)} aria-haspopup="dialog" aria-expanded={presetOpen}><CalendarDays size={16}/><span>{preset==='7'?'7 Hari':preset==='30'?'30 Hari':preset==='90'?'90 Hari':'1 Tahun'}</span><ChevronDown size={14}/></button></div></div>
  </section>
  {presetOpen&&<div className="orders-period-overlay" role="presentation" onClick={()=>setPresetOpen(false)}><div className="orders-period-sheet" role="dialog" aria-modal="true" aria-labelledby="analytics-preset-title" onClick={e=>e.stopPropagation()}><div className="orders-period-handle" aria-hidden="true"/><div className="orders-period-head"><div><span className="eyebrow">ANALYTICS PERIOD</span><h3 id="analytics-preset-title">Pilih periode analisis</h3><p>Tentukan rentang data yang ingin ditampilkan.</p></div><button type="button" className="orders-period-close" onClick={()=>setPresetOpen(false)} aria-label="Tutup"><X size={18}/></button></div><div className="orders-period-options">{[['7','7 Hari','Ringkasan transaksi 7 hari terakhir'],['30','30 Hari','Analisis transaksi 30 hari terakhir']].map(([value,title,desc])=>{const active=preset===value;return <button type="button" key={value} className={`orders-period-option ${active?'active':''}`} onClick={()=>{applyPreset(value);setPresetOpen(false)}}><span className="orders-period-option-icon"><CalendarDays size={18}/></span><span className="orders-period-option-copy"><b>{title}</b><small>{desc}</small></span><span className="orders-period-check">{active&&<Check size={16}/>}</span></button>})}</div><div className="orders-period-footer"><button type="button" onClick={()=>setPresetOpen(false)}>Selesai</button></div></div></div>}
  <div className="analytics-kpis">
   <Kpi tone="violet" label="Total omzet" value={money(total)} detail={delta(revenueGrowth)} icon={CircleDollarSign}/>
   <Kpi tone="blue" label="Transaksi selesai" value={filtered.length.toLocaleString('id-ID')} detail={delta(orderGrowth)} icon={ShoppingBag}/>
   <Kpi tone="orange" label="Rata-rata transaksi" value={money(avg)} detail="Nilai rata-rata per pesanan" icon={TrendingUp}/>
   <Kpi tone="green" label="Pelanggan aktif" value={customerSet.size.toLocaleString('id-ID')} detail="Pelanggan yang bertransaksi" icon={Users}/>
  </div>
  <div className="analytics-chart-grid">
   <section className="analytics-card analytics-revenue-card"><div className="analytics-card-head analytics-saas-head"><div><span className="card-kicker">REVENUE TREND</span><h3>Pergerakan omzet</h3><span>{from} sampai {to}</span></div><div className="chart-metric"><b>{money(total)}</b><small>{revenueGrowth===null?'Belum ada pembanding':`${revenueGrowth>=0?'↑':'↓'} ${Math.abs(revenueGrowth).toFixed(1)}%`}</small></div></div>
    <div className="saas-line-chart"><div className="saas-y-axis"><span>{money(maxRevenue)}</span><span>{money(maxRevenue*.75)}</span><span>{money(maxRevenue*.5)}</span><span>{money(maxRevenue*.25)}</span><span>Rp 0</span></div><div className="saas-plot"><svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Grafik pergerakan omzet per hari"><defs><linearGradient id="saasRevenueArea" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#6f63e9" stopOpacity=".22"/><stop offset="70%" stopColor="#8b82f6" stopOpacity=".055"/><stop offset="100%" stopColor="#8b82f6" stopOpacity="0"/></linearGradient><filter id="saasLineGlow" x="-10%" y="-20%" width="120%" height="140%"><feGaussianBlur stdDeviation="4" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>{[0,.25,.5,.75,1].map((g,i)=><line key={i} x1={PX} x2={W-PX} y1={PY+plotH*g} y2={PY+plotH*g} className="saas-grid-line"/>)}<path d={areaPath} fill="url(#saasRevenueArea)"/><path d={linePath} className="saas-revenue-line" fill="none" strokeLinecap="round" strokeLinejoin="round" filter="url(#saasLineGlow)"/>{activePoint!==null&&coords[activePoint]&&<line x1={coords[activePoint].x} x2={coords[activePoint].x} y1={PY} y2={BASE} className="saas-guide-line"/>}{coords.map((c,i)=><g key={i} className="saas-point" onMouseEnter={()=>setActivePoint(i)} onMouseLeave={()=>setActivePoint(null)} onClick={()=>setActivePoint(i)}><circle cx={c.x} cy={c.y} r="15" fill="transparent"/><circle cx={c.x} cy={c.y} r={activePoint===i?7:3.6} className={activePoint===i?'active':''}/></g>)}</svg>{activePoint!==null&&points[activePoint]&&<div className="saas-tooltip" style={{left:`${Math.min(88,Math.max(8,(activePoint/(Math.max(1,points.length-1)))*100))}%`}}><span>{points[activePoint].label}</span><b>{money(points[activePoint].value)}</b><small>{points[activePoint].count} transaksi</small></div>}<div className="saas-x-axis">{points.map((p,i)=>visibleLabel(i)&&<span key={i} style={{left:`${points.length===1?50:(i/(points.length-1))*100}%`}}>{p.label}</span>)}</div></div></div>
    <div className="saas-chart-insights"><div><span>Omzet tertinggi</span><b>{bestDay?.value?money(bestDay.value):'Rp 0'}</b><small>{bestDay?.label||'Belum ada data'}</small></div><div><span>Rata-rata omzet</span><b>{money(days?total/days:0)}</b><small>Per hari dalam periode</small></div><div><span>Transaksi</span><b>{filtered.length.toLocaleString('id-ID')}</b><small>Data transaksi selesai</small></div></div>
   </section>
   <section className="analytics-card analytics-orders-card"><div className="analytics-card-head analytics-saas-head"><div><span className="card-kicker">ORDER ACTIVITY</span><h3>Aktivitas pesanan</h3><span>Distribusi transaksi per hari</span></div><span className="analytics-total">{filtered.length}</span></div><div className="saas-bar-chart">{points.map((p,i)=><div className="saas-bar-column" key={i} onMouseEnter={()=>setActiveBar(i)} onMouseLeave={()=>setActiveBar(null)} onClick={()=>setActiveBar(i)}><div className="saas-bar-track"><motion.div initial={{height:0}} animate={{height:`${p.count?Math.max(8,(p.count/maxOrders)*100):2}%`}} transition={{duration:.5,delay:Math.min(i*.025,.4)}} className={`saas-bar ${activeBar===i?'active':''}`}/>{activeBar===i&&<div className="saas-bar-tooltip"><b>{p.count}</b><span>transaksi</span></div>}</div>{visibleLabel(i)&&<small>{p.label}</small>}</div>)}</div><div className="orders-insight"><span>Hari terbaik</span><b>{bestDay?.value?`${bestDay.label} • ${money(bestDay.value)}`:'Belum ada penjualan'}</b></div></section>
  </div>
  <div className="analytics-bottom-grid analytics-bottom-grid-premium"><section className="analytics-card top-menu-card top-menu-card-wide"><div className="analytics-card-head"><div><span className="card-kicker">BEST SELLERS</span><h3>Produk terlaris</h3><span>Produk dengan performa omzet terbaik pada periode terpilih</span></div><div className="best-seller-badge"><Sparkles size={15}/> Live ranking</div></div>{topItems.length?<div className="top-menu-list top-menu-list-premium">{topItems.map((it,i)=><div className="top-menu-row top-menu-row-premium" key={it.name}><strong>{String(i+1).padStart(2,'0')}</strong><div className="top-menu-main"><b>{it.name}</b><small>{it.qty.toLocaleString('id-ID')} porsi terjual</small></div><div className="top-menu-bar"><i style={{width:`${Math.max(8,(it.sales/Math.max(...topItems.map(x=>x.sales),1))*100)}%`}}/></div><span>{money(it.sales)}</span></div>)}</div>:<div className="analytics-empty">Belum ada item penjualan untuk ditampilkan.</div>}</section></div>
  <section className="analytics-summary"><div><span>Rata-rata Order</span><b>{money(avg)}</b></div><div><span>Pelanggan Aktif</span><b>{customerSet.size}</b></div><div><span>Transaksi Sukses</span><b>{filtered.length?((filtered.length/(filtered.length+orders.filter((o:Order)=>o.status==='cancelled').length))*100).toFixed(1):'0.0'}%</b></div><div><span>Hari Dianalisis</span><b>{days} hari</b></div></section>
 </div>
}
function DeleteConfirmDialog({data,onCancel,onConfirm}:{data:any;onCancel:()=>void;onConfirm:()=>void}){return <motion.div className="delete-overlay" initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} onMouseDown={e=>{if(e.target===e.currentTarget)onCancel()}}><motion.div className="delete-dialog" initial={{opacity:0,y:18,scale:.97}} animate={{opacity:1,y:0,scale:1}} exit={{opacity:0,y:12,scale:.98}} transition={{duration:.18}} role="dialog" aria-modal="true" aria-labelledby="delete-title"><div className="delete-icon"><Trash2 size={22}/></div><div className="delete-copy"><span className="delete-eyebrow">KONFIRMASI PENGHAPUSAN</span><h2 id="delete-title">Hapus {data.label}?</h2><p><b>{data.name}</b> akan dihapus secara permanen dari data Mieflow.</p></div><div className="delete-actions"><button type="button" className="delete-cancel" onClick={onCancel}>Batal</button><button type="button" className="delete-confirm" onClick={onConfirm}><Trash2 size={16}/> Hapus permanen</button></div></motion.div></motion.div>}

function Modal({type,initial,categories,onClose,onSave}:any){
 const defaults:any={product:{name:'',description:'',price:0,cost:0,stock:0,image_url:'',category_id:'',is_active:true},category:{name:'',color:'#111827'},customer:{name:'',phone:'',email:'',notes:''}};
 const [form,setForm]=useState<any>({...defaults[type],...(initial||{})}),[uploading,setUploading]=useState(false),[uploadError,setUploadError]=useState(''),[categoryOpen,setCategoryOpen]=useState(false),[categorySearch,setCategorySearch]=useState('');
 const set=(k:string,v:any)=>setForm((f:any)=>({...f,[k]:v}));
 const compressImage=async(file:File)=>new Promise<string>((resolve,reject)=>{
   const reader=new FileReader();
   reader.onerror=()=>reject(new Error('Foto tidak bisa dibaca.'));
   reader.onload=()=>{
     const img=new Image();
     img.onerror=()=>reject(new Error('Format foto tidak didukung.'));
     img.onload=()=>{
       const max=900,scale=Math.min(1,max/Math.max(img.width,img.height));
       const canvas=document.createElement('canvas'); canvas.width=Math.max(1,Math.round(img.width*scale)); canvas.height=Math.max(1,Math.round(img.height*scale));
       const ctx=canvas.getContext('2d'); if(!ctx)return reject(new Error('Browser tidak mendukung pemrosesan foto.'));
       ctx.drawImage(img,0,0,canvas.width,canvas.height);
       resolve(canvas.toDataURL('image/webp',0.78));
     };
     img.src=String(reader.result);
   };
   reader.readAsDataURL(file);
 });
 const upload=async(file:File)=>{
   setUploadError('');
   if(!file.type.startsWith('image/')){setUploadError('Pilih foto dari Gallery dalam format JPG, PNG, WEBP, atau GIF.');return}
   if(file.size>10*1024*1024){setUploadError('Ukuran foto maksimal 10 MB.');return}
   setUploading(true);
   try{
     await ensureFreshSession();
     const ext=(file.name.split('.').pop()||'jpg').toLowerCase().replace(/[^a-z0-9]/g,'')||'jpg';
     const userId=(await ensureFreshSession())?.user.id;
     if(!userId) throw new Error('Sesi login tidak ditemukan.');
     const path=`${userId}/products/${crypto.randomUUID()}.${ext}`;
     const uploadResult=await runWithAuthRetry(()=>supabase.storage.from('product-images').upload(path,file,{contentType:file.type,upsert:false,cacheControl:'3600'}));
     if(uploadResult.error)throw uploadResult.error;
     const {data}=supabase.storage.from('product-images').getPublicUrl(path);
     if(!data?.publicUrl)throw new Error('URL foto tidak tersedia.');
     set('image_url',data.publicUrl);
   }catch(err:any){
     try{const fallback=await compressImage(file);set('image_url',fallback);setUploadError(`${friendlySupabaseError(err)} Foto tetap dipakai sebagai preview lokal; setelah database siap produk dapat disimpan.`);}
     catch(processErr:any){setUploadError(processErr?.message||'Foto gagal diproses.');}
   }finally{setUploading(false)}
 };
 const margin=Number(form.price||0)-Number(form.cost||0);
 const marginPct=Number(form.price||0)>0?Math.max(0,Math.round((margin/Number(form.price))*100)):0;
 const product=type==='product';
 return <motion.div className="modal-backdrop" initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} onMouseDown={onClose}>
  <motion.form className={`modal ${product?'product-modal':''}`} initial={{y:20,scale:.97}} animate={{y:0,scale:1}} onMouseDown={e=>e.stopPropagation()} onSubmit={e=>{e.preventDefault();onSave(type,form)}}>
   {product&&<div className="mobile-sheet-handle" aria-hidden="true"/>}
   <div className="modal-head modern-head"><div><span>{initial?'EDIT DATA':'DATA BARU'}</span><h2>{product?'Tambah produk':type==='category'?'Tambah kategori':'Tambah pelanggan'}</h2><p>{product?'Lengkapi informasi produk agar mudah ditemukan saat transaksi.':''}</p></div><button type="button" aria-label="Tutup" onClick={onClose}><X size={18}/></button></div>
   {product&&<div className="product-form-layout">
    <div className="product-media-card">
      <div className="section-kicker"><ImageIcon size={14}/> Foto produk</div>
      <div className={`image-drop ${form.image_url?'has-image':''}`}>
       {form.image_url?<><img src={form.image_url} alt="Preview produk"/><button type="button" className="image-remove" onClick={()=>set('image_url','')}><X size={15}/></button></>:<><UploadCloud size={27}/><b>{uploading?'Mengunggah…':'Upload foto produk'}</b><span>JPG, PNG atau WEBP</span><small>Maks. 5 MB</small></>}
       <input id="product-image" hidden type="file" accept="image/*" onChange={e=>{const file=e.target.files?.[0];if(file)upload(file);e.currentTarget.value=''}}/>
       {!form.image_url&&<label htmlFor="product-image" className="image-drop-action">Pilih dari galeri</label>}
       {form.image_url&&<label htmlFor="product-image" className="image-change">Ganti foto</label>}
      </div>
      {uploadError&&<div className="upload-status"><span>{uploadError}</span></div>}
    </div>
    <div className="product-fields">
      <div className="form-section"><div className="section-title"><span>Informasi dasar</span><small>Wajib</small></div>
       <Field label="Nama produk" value={form.name} onChange={(v:any)=>set('name',v)} placeholder="Contoh: Mie Ayam Spesial" required/>
       <label>Deskripsi <textarea value={form.description??''} onChange={e=>set('description',e.target.value)} placeholder="Deskripsi singkat produk (opsional)" rows={3}/></label>
      </div>
      <div className="form-section"><div className="section-title"><span>Harga & stok</span><small>Dalam Rupiah</small></div>
       <div className="form-grid three"><Field label="Harga jual" type="number" value={form.price} onChange={(v:any)=>set('price',v)} placeholder="0" required/><Field label="Harga modal" type="number" value={form.cost} onChange={(v:any)=>set('cost',v)} placeholder="0"/><Field label="Stok awal" type="number" value={form.stock} onChange={(v:any)=>set('stock',v)} placeholder="0"/></div>
       <div className="margin-preview"><span>Estimasi margin</span><b>{money(margin)}</b><em>{marginPct}%</em></div>
      </div>
      <div className="form-section"><div className="section-title"><span>Kategori & status</span></div>
       <div className="category-picker-field"><label>Kategori produk</label><button type="button" className={`category-picker-trigger ${categoryOpen?'is-open':''}`} onClick={()=>setCategoryOpen(v=>!v)} aria-expanded={categoryOpen}><span className="category-picker-symbol"><Tags size={18}/></span><span className="category-picker-value">{categories.find((c:Category)=>c.id===form.category_id)?.name||'Pilih kategori produk'}<small>{form.category_id?'Kategori produk dipilih':'Kelompokkan agar mudah ditemukan di kasir'}</small></span><ChevronDown size={19} className="category-picker-chevron"/></button>{categoryOpen&&<div className="category-picker-panel"><label className="category-picker-search"><Search size={18}/><input autoFocus value={categorySearch} onChange={e=>setCategorySearch(e.target.value)} placeholder="Cari kategori..."/></label><div className="category-picker-options"><button type="button" className={`category-picker-option ${!form.category_id?'selected':''}`} onClick={()=>{set('category_id','');setCategoryOpen(false);setCategorySearch('')}}><span className="category-option-icon category-option-icon-unified"><Tags size={21}/></span><span className="category-option-copy">Pilih kategori produk<small>Tanpa kategori</small></span><i>{!form.category_id&&<Check size={16}/>}</i></button>{categories.filter((c:Category)=>c.name.toLowerCase().includes(categorySearch.toLowerCase())).map((c:Category,i:number)=>{const Icon=Tags;return <button type="button" key={c.id} className={`category-picker-option ${form.category_id===c.id?'selected':''}`} onClick={()=>{set('category_id',c.id);setCategoryOpen(false);setCategorySearch('')}}><span className="category-option-icon category-option-icon-unified"><Icon size={21}/></span><span className="category-option-copy">{c.name}<small>Kategori produk</small></span><i>{form.category_id===c.id&&<Check size={16}/>}</i></button>})}{!categories.some((c:Category)=>c.name.toLowerCase().includes(categorySearch.toLowerCase()))&&<div className="category-picker-empty">Kategori tidak ditemukan.</div>}</div></div>}</div>
       <div className="active-toggle"><div><b>Produk aktif</b><span>Produk dapat dijual dari halaman POS.</span></div><button type="button" className={`switch ${form.is_active?'on':''}`} aria-label="Status produk" onClick={()=>set('is_active',!form.is_active)}><i/></button></div>
      </div>
    </div>
   </div>}
   {type==='category'&&<div className="simple-form"><Field label="Nama" value={form.name} onChange={(v:any)=>set('name',v)} required/><Field label="Warna" type="color" value={form.color} onChange={(v:any)=>set('color',v)}/></div>}
   {type==='customer'&&<div className="customer-form">
    <div className="customer-form-intro"><div className="customer-form-icon"><Users size={20}/></div><div><b>Profil pelanggan</b><span>Simpan data pelanggan agar transaksi dan riwayat lebih mudah dikelola.</span></div></div>
    <div className="customer-form-grid">
      <label className="customer-field full"><span>Nama pelanggan <em>Wajib</em></span><div><UserRound size={17}/><input required value={form.name??''} placeholder="Contoh: Budi Santoso" onChange={e=>set('name',e.target.value)}/></div></label>
      <label className="customer-field"><span>Nomor telepon</span><div><span className="field-prefix">+62</span><input inputMode="tel" value={(form.phone??'').replace(/^\+62\s?/,'')} placeholder="812 3456 7890" onChange={e=>set('phone',e.target.value)}/></div></label>
      <label className="customer-field"><span>Email</span><div><Mail size={17}/><input type="email" value={form.email??''} placeholder="nama@email.com" onChange={e=>set('email',e.target.value)}/></div></label>
      <label className="customer-field full"><span>Catatan <small>Opsional</small></span><div className="textarea-wrap"><textarea value={form.notes??''} placeholder="Catatan atau preferensi pelanggan…" rows={4} onChange={e=>set('notes',e.target.value)}/></div></label>
    </div>
   </div>}
   <div className="modal-foot"><button type="button" className="secondary" onClick={onClose}>Batal</button><button className="primary" disabled={uploading}>{initial?'Simpan perubahan':type==='customer'?'Simpan pelanggan':type==='category'?'Simpan kategori':'Simpan produk'} <Check size={17}/></button></div>
  </motion.form>
 </motion.div>
}
function Field({label,value,onChange,type='text',required=false,placeholder=''}:any){return <label>{label}<input required={required} type={type} value={value??''} placeholder={placeholder} onChange={e=>onChange(e.target.value)}/></label>}
