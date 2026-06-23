import { createFileRoute, Link } from "@tanstack/react-router";
import { MeduzaLayout } from "@/components/MeduzaLayout";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEffect, useRef, useState } from "react";
import { Html5QrcodeScanner, Html5QrcodeSupportedFormats } from "html5-qrcode";
import { ArrowLeft, ScanLine, X, Plus, Minus, Trash2, Search, Euro, FileText, BadgeCheck, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { voiceBus } from "@/components/voice/voice-bus";

export const Route = createFileRoute("/_authenticated/soci/gestisci")({
  component: GestisciSocio,
});

interface Member { id: string; first_name: string; last_name: string; card_number: string; qr_token: string; photo_url: string | null; phone: string | null; }
interface Product { id: string; name: string; type: "per_gram" | "per_piece"; price: number; stock: number; }
interface CartItem { product: Product; quantity: number; }
interface Plan { id: string; name: string; duration_days: number; price: number; active: boolean; }
interface Subscription { id: string; plan_name: string; start_date: string; end_date: string; price: number; paid: boolean; }

function GestisciSocio() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [member, setMember] = useState<Member | null>(null);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [scanning, setScanning] = useState(false);
  const [manualToken, setManualToken] = useState("");
  const [showSubForm, setShowSubForm] = useState(false);

  const { data: products } = useQuery({
    queryKey: ["products-active"],
    queryFn: async () => {
      const { data } = await supabase.from("products").select("*").eq("active", true).order("name");
      return (data ?? []) as Product[];
    },
  });

  const { data: plans } = useQuery({
    queryKey: ["plans-active"],
    queryFn: async () => {
      const { data } = await supabase.from("membership_plans").select("*").eq("active", true).order("duration_days");
      return (data ?? []) as Plan[];
    },
  });

  const { data: history } = useQuery({
    queryKey: ["member-history", member?.id],
    enabled: !!member,
    queryFn: async () => {
      const { data } = await supabase
        .from("sales")
        .select("id, total, created_at")
        .eq("member_id", member!.id)
        .order("created_at", { ascending: false })
        .limit(5);
      return data ?? [];
    },
  });

  const { data: subs } = useQuery({
    queryKey: ["member-subs", member?.id],
    enabled: !!member,
    queryFn: async () => {
      const { data } = await supabase
        .from("member_subscriptions")
        .select("*")
        .eq("member_id", member!.id)
        .order("end_date", { ascending: false });
      return (data ?? []) as Subscription[];
    },
  });

  const activeSub = subs?.find((s) => new Date(s.end_date) >= new Date());

  async function findByToken(token: string) {
    const clean = token.replace(/^MEDUZA:/, "").trim();
    const { data, error } = await supabase.from("members").select("*")
      .or(`qr_token.eq.${clean},card_number.eq.${clean}`)
      .maybeSingle();
    if (error || !data) return toast.error("Socio non trovato");
    setMember(data as Member);
    setCart([]);
    toast.success(`${data.first_name} ${data.last_name} identificato`);
  }

  function addToCart(p: Product) {
    setCart((c) => {
      const e = c.find((i) => i.product.id === p.id);
      if (e) return c.map((i) => i.product.id === p.id ? { ...i, quantity: i.quantity + 1 } : i);
      return [...c, { product: p, quantity: 1 }];
    });
  }

  function updateQty(id: string, q: number) {
    setCart((c) => q <= 0 ? c.filter(i => i.product.id !== id) : c.map(i => i.product.id === id ? { ...i, quantity: q } : i));
  }

  const total = cart.reduce((s, i) => s + i.product.price * i.quantity, 0);

  async function complete() {
    if (!member) return toast.error("Identifica prima il socio");
    if (cart.length === 0) return toast.error("Nessun prodotto nell'ordine");
    try {
      const { data: sale, error: e1 } = await supabase.from("sales").insert({
        member_id: member.id,
        cashier_id: user!.id,
        total,
      }).select("id").single();
      if (e1) throw e1;
      const items = cart.map(i => ({
        sale_id: sale.id,
        product_id: i.product.id,
        product_name: i.product.name,
        product_type: i.product.type,
        unit_price: i.product.price,
        quantity: i.quantity,
        subtotal: i.product.price * i.quantity,
      }));
      const { error: e2 } = await supabase.from("sale_items").insert(items);
      if (e2) throw e2;
      toast.success(`Ordine registrato: € ${total.toFixed(2)}`);
      setCart([]);
      qc.invalidateQueries({ queryKey: ["member-history", member.id] });
    } catch (e: any) {
      toast.error(e.message);
    }
  }

  async function activatePlan(plan: Plan) {
    if (!member) return;
    const start = new Date();
    const baseStart = activeSub ? new Date(activeSub.end_date) : start;
    if (baseStart < start) baseStart.setTime(start.getTime());
    const end = new Date(baseStart);
    end.setDate(end.getDate() + plan.duration_days);
    const { error } = await supabase.from("member_subscriptions").insert({
      member_id: member.id,
      plan_id: plan.id,
      plan_name: plan.name,
      duration_days: plan.duration_days,
      price: plan.price,
      start_date: baseStart.toISOString().slice(0, 10),
      end_date: end.toISOString().slice(0, 10),
      paid: true,
      created_by: user?.id,
    });
    if (error) return toast.error(error.message);
    toast.success(`Quota "${plan.name}" attivata fino al ${end.toLocaleDateString("it-IT")}`);
    setShowSubForm(false);
    qc.invalidateQueries({ queryKey: ["member-subs", member.id] });
  }

  // ---------- Voice handlers ----------
  const stateRef = useRef({ member, cart, products, plans, activeSub });
  stateRef.current = { member, cart, products, plans, activeSub };

  useEffect(() => {
    const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
    const fuzzy = <T extends { name: string }>(list: T[] | undefined, q: string): T | undefined => {
      if (!list) return undefined;
      const nq = norm(q);
      return (
        list.find((x) => norm(x.name) === nq) ??
        list.find((x) => norm(x.name).includes(nq)) ??
        list.find((x) => nq.includes(norm(x.name)))
      );
    };

    voiceBus.register({
      findMember: async (query) => {
        await findByToken(query);
        return true;
      },
      addToCart: async (productQuery, quantity, unit) => {
        const { products: ps, member: m } = stateRef.current;
        if (!m) { toast.error("Primero identifica al socio"); return false; }
        const p = fuzzy(ps, productQuery);
        if (!p) { toast.error(`Producto "${productQuery}" no encontrado`); return false; }
        const q = quantity ?? (p.type === "per_gram" ? 1 : 1);
        setCart((c) => {
          const e = c.find((i) => i.product.id === p.id);
          if (e) return c.map((i) => i.product.id === p.id ? { ...i, quantity: i.quantity + q } : i);
          return [...c, { product: p, quantity: q }];
        });
        toast.success(`+${q}${p.type === "per_gram" ? "g" : "pz"} ${p.name}`);
        return true;
      },
      removeFromCart: async (productQuery) => {
        const { cart: c } = stateRef.current;
        const item = c.find((i) => norm(i.product.name).includes(norm(productQuery)));
        if (!item) return false;
        setCart((cs) => cs.filter((i) => i.product.id !== item.product.id));
        toast.success(`Quitado: ${item.product.name}`);
        return true;
      },
      clearCart: () => setCart([]),
      confirmOrder: async () => {
        await complete();
        return true;
      },
      renewPlan: async (planQuery) => {
        const { plans: ps, member: m } = stateRef.current;
        if (!m) { toast.error("Primero identifica al socio"); return false; }
        let p = fuzzy(ps, planQuery);
        if (!p) {
          // try matching by duration_days from words like "6 meses", "30 días"
          const num = parseInt(planQuery.replace(/[^0-9]/g, ""), 10);
          if (num && ps) {
            const isMonths = /mes/i.test(planQuery);
            const target = isMonths ? num * 30 : num;
            p = ps.reduce<Plan | undefined>((best, cur) => {
              const d = Math.abs(cur.duration_days - target);
              if (!best || d < Math.abs(best.duration_days - target)) return cur;
              return best;
            }, undefined);
          }
        }
        if (!p) { toast.error(`Plan "${planQuery}" no encontrado`); return false; }
        await activatePlan(p);
        return true;
      },
    });

    return () => voiceBus.unregister(["findMember", "addToCart", "removeFromCart", "clearCart", "confirmOrder", "renewPlan"]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <MeduzaLayout title="Gestisci Socio">
      <Link to="/soci" className="inline-flex items-center gap-2 text-gold-muted hover:text-gold text-xs uppercase tracking-widest mb-6">
        <ArrowLeft className="w-3 h-3" /> Torna a Soci
      </Link>

      {!member ? (
        <div className="max-w-md mx-auto bg-card/60 border border-gold/30 rounded-lg p-8 text-center">
          <ScanLine className="w-12 h-12 text-gold mx-auto mb-4" />
          <h3 className="font-display text-gold uppercase tracking-[0.3em] text-sm mb-2">Identifica socio</h3>
          <p className="text-xs text-muted-foreground mb-6">Scansiona il QR del socio o inserisci manualmente il codice tessera.</p>

          <button onClick={() => setScanning(true)} className="w-full bg-gradient-gold text-primary-foreground py-3 rounded-md font-display uppercase tracking-widest text-xs flex items-center gap-2 justify-center">
            <ScanLine className="w-4 h-4" /> Scansiona QR
          </button>

          <div className="flex items-center gap-3 my-4">
            <div className="flex-1 h-px bg-gold/20" />
            <span className="text-[10px] uppercase tracking-widest text-gold-muted">oppure</span>
            <div className="flex-1 h-px bg-gold/20" />
          </div>

          <form onSubmit={(e) => { e.preventDefault(); findByToken(manualToken); setManualToken(""); }} className="flex gap-2">
            <input value={manualToken} onChange={(e) => setManualToken(e.target.value)} placeholder="N° tessera o codice QR"
              className="flex-1 bg-input border border-border rounded-md px-3 py-2 text-sm focus:border-gold outline-none" />
            <button className="px-4 border border-gold/50 text-gold rounded-md text-xs uppercase tracking-widest"><Search className="w-3 h-3" /></button>
          </form>
        </div>
      ) : (
        <div className="grid lg:grid-cols-[1fr_400px] gap-6">
          <div className="space-y-6">
            {/* Member header */}
            <div className="bg-card/60 border border-gold/30 rounded-lg p-5">
              <div className="flex items-center gap-4">
                {member.photo_url
                  ? <img src={member.photo_url} alt="" className="w-16 h-16 rounded-full object-cover border-2 border-gold" />
                  : <div className="w-16 h-16 rounded-full bg-accent border-2 border-gold flex items-center justify-center font-display text-gold text-xl">{member.first_name[0]}{member.last_name[0]}</div>}
                <div className="flex-1">
                  <div className="text-[10px] uppercase tracking-[0.3em] text-gold-muted">Tessera N° {member.card_number}</div>
                  <div className="font-display text-2xl text-gradient-gold tracking-wider">{member.first_name} {member.last_name}</div>
                  {member.phone && <div className="text-xs text-muted-foreground">{member.phone}</div>}
                </div>
                <div className="flex flex-col gap-2">
                  <Link to="/soci/$id" params={{ id: member.id }} className="text-[10px] uppercase tracking-widest text-gold-muted hover:text-gold flex items-center gap-1">
                    <FileText className="w-3 h-3" /> Scheda
                  </Link>
                  <button onClick={() => { setMember(null); setCart([]); }} className="text-[10px] uppercase tracking-widest text-muted-foreground hover:text-gold">Cambia</button>
                </div>
              </div>
            </div>

            {/* Subscription status */}
            <div className="bg-card/60 border border-gold/30 rounded-lg p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-display text-gold uppercase tracking-[0.3em] text-xs">Quota associativa</h3>
                <button onClick={() => setShowSubForm((v) => !v)} className="text-[10px] uppercase tracking-widest text-gold-muted hover:text-gold flex items-center gap-1">
                  <Plus className="w-3 h-3" /> Rinnova
                </button>
              </div>
              {activeSub ? (
                <div className="flex items-center gap-3 bg-gold/10 border border-gold/30 rounded-md p-3">
                  <BadgeCheck className="w-6 h-6 text-gold" />
                  <div className="flex-1">
                    <div className="font-display text-gold">{activeSub.plan_name}</div>
                    <div className="text-[11px] text-muted-foreground">Scade il {new Date(activeSub.end_date).toLocaleDateString("it-IT")}</div>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-3 bg-destructive/10 border border-destructive/30 rounded-md p-3">
                  <AlertTriangle className="w-6 h-6 text-destructive" />
                  <div className="text-xs text-destructive">Nessuna quota attiva</div>
                </div>
              )}

              {showSubForm && (
                <div className="mt-4 space-y-2">
                  <div className="text-[10px] uppercase tracking-widest text-gold-muted mb-2">Scegli un piano</div>
                  {(plans ?? []).length === 0 && <div className="text-xs text-muted-foreground">Nessun piano configurato. Crealo in Soci → Quote associative.</div>}
                  {(plans ?? []).map((p) => (
                    <button key={p.id} onClick={() => activatePlan(p)}
                      className="w-full flex items-center justify-between bg-accent/30 hover:bg-accent/60 border border-gold/20 hover:border-gold rounded-md p-3 transition">
                      <div className="text-left">
                        <div className="font-display text-gold">{p.name}</div>
                        <div className="text-[11px] text-muted-foreground">{p.duration_days} giorni</div>
                      </div>
                      <div className="font-display text-gold">€ {Number(p.price).toFixed(2)}</div>
                    </button>
                  ))}
                </div>
              )}

              {subs && subs.length > 0 && (
                <div className="mt-4 pt-4 border-t border-gold/20">
                  <div className="text-[10px] uppercase tracking-widest text-gold-muted mb-2">Storico quote</div>
                  <div className="space-y-1">
                    {subs.map((s) => (
                      <div key={s.id} className="flex justify-between text-xs py-1.5 border-b border-gold/10 last:border-0">
                        <span className="text-muted-foreground">{s.plan_name} · {new Date(s.start_date).toLocaleDateString("it-IT")} → {new Date(s.end_date).toLocaleDateString("it-IT")}</span>
                        <span className="text-gold font-display">€ {Number(s.price).toFixed(2)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Products */}
            <div className="bg-card/60 border border-gold/30 rounded-lg p-5">
              <h3 className="font-display text-gold uppercase tracking-[0.3em] text-xs mb-4">Prodotti disponibili</h3>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {(products ?? []).map((p) => (
                  <button key={p.id} onClick={() => addToCart(p)}
                    className="bg-accent/30 border border-gold/20 rounded-md p-3 text-left hover:border-gold hover:bg-accent/60 transition">
                    <div className="font-display text-sm text-gold tracking-wider truncate">{p.name}</div>
                    <div className="text-[11px] text-muted-foreground mt-1">€ {Number(p.price).toFixed(2)}{p.type === "per_gram" ? "/g" : "/pz"}</div>
                  </button>
                ))}
                {(products ?? []).length === 0 && <div className="col-span-full text-center text-gold-muted text-sm py-6">Nessun prodotto attivo</div>}
              </div>
            </div>

            {/* History */}
            {history && history.length > 0 && (
              <div className="bg-card/60 border border-gold/30 rounded-lg p-5">
                <h3 className="font-display text-gold uppercase tracking-[0.3em] text-xs mb-3">Ultimi ordini</h3>
                <div className="space-y-1">
                  {history.map((h) => (
                    <div key={h.id} className="flex justify-between text-xs py-1.5 border-b border-gold/10 last:border-0">
                      <span className="text-muted-foreground">{new Date(h.created_at).toLocaleString("it-IT")}</span>
                      <span className="text-gold font-display">€ {Number(h.total).toFixed(2)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Order panel */}
          <div className="bg-card/80 border border-gold/40 rounded-lg p-5 flex flex-col h-fit lg:sticky lg:top-4">
            <h3 className="font-display text-gold uppercase tracking-[0.3em] text-xs mb-4 flex items-center gap-2"><Euro className="w-3 h-3" />Ordine</h3>
            <div className="flex-1 space-y-2 max-h-96 overflow-y-auto">
              {cart.length === 0 && <div className="text-center text-gold-muted text-sm py-8">Aggiungi prodotti</div>}
              {cart.map((i) => (
                <div key={i.product.id} className="bg-accent/30 rounded-md p-3">
                  <div className="flex justify-between items-start mb-2">
                    <div className="font-display text-sm text-gold">{i.product.name}</div>
                    <button onClick={() => updateQty(i.product.id, 0)} className="text-destructive"><Trash2 className="w-3 h-3" /></button>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <button onClick={() => updateQty(i.product.id, Math.max(0, i.quantity - (i.product.type === "per_gram" ? 0.5 : 1)))} className="w-7 h-7 bg-input rounded border border-border flex items-center justify-center"><Minus className="w-3 h-3" /></button>
                      <input
                        type="number"
                        step={i.product.type === "per_gram" ? "0.1" : "1"}
                        value={i.quantity}
                        onChange={(e) => updateQty(i.product.id, Number(e.target.value))}
                        className="w-16 text-center bg-input border border-border rounded px-1 py-1 text-xs"
                      />
                      <span className="text-[10px] text-muted-foreground">{i.product.type === "per_gram" ? "g" : "pz"}</span>
                      <button onClick={() => updateQty(i.product.id, i.quantity + (i.product.type === "per_gram" ? 0.5 : 1))} className="w-7 h-7 bg-input rounded border border-border flex items-center justify-center"><Plus className="w-3 h-3" /></button>
                    </div>
                    <div className="font-display text-gold">€ {(i.product.price * i.quantity).toFixed(2)}</div>
                  </div>
                </div>
              ))}
            </div>

            <div className="border-t border-gold/30 mt-4 pt-4">
              <div className="flex justify-between items-baseline mb-4">
                <span className="text-xs uppercase tracking-widest text-gold-muted">Totale</span>
                <span className="font-display text-3xl text-gradient-gold">€ {total.toFixed(2)}</span>
              </div>
              <button onClick={complete} disabled={cart.length === 0}
                className="w-full bg-gradient-gold text-primary-foreground py-3 rounded-md font-display uppercase tracking-[0.3em] text-sm disabled:opacity-30">
                Conferma ordine
              </button>
            </div>
          </div>
        </div>
      )}

      {scanning && <ScannerModal onClose={() => setScanning(false)} onScan={(t) => { setScanning(false); findByToken(t); }} />}
    </MeduzaLayout>
  );
}

function ScannerModal({ onClose, onScan }: { onClose: () => void; onScan: (t: string) => void }) {
  const containerId = "qr-scanner-region";
  const scannerRef = useRef<Html5QrcodeScanner | null>(null);
  const handledRef = useRef(false);

  useEffect(() => {
    const scanner = new Html5QrcodeScanner(
      containerId,
      {
        fps: 10,
        qrbox: { width: 260, height: 260 },
        rememberLastUsedCamera: true,
        showTorchButtonIfSupported: true,
        formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE],
      },
      false,
    );
    scannerRef.current = scanner;
    scanner.render(
      (decoded) => {
        if (handledRef.current) return;
        handledRef.current = true;
        onScan(decoded);
      },
      () => {},
    );
    return () => {
      scanner.clear().catch(() => {});
    };
  }, [onScan]);

  return (
    <div className="fixed inset-0 z-50 bg-background/95 backdrop-blur flex items-center justify-center p-4">
      <div className="bg-card border border-gold/50 rounded-lg p-4 max-w-md w-full">
        <div className="flex justify-between items-center mb-3">
          <h3 className="font-display text-gold uppercase tracking-widest text-sm">Scansiona QR</h3>
          <button onClick={onClose} className="text-gold-muted hover:text-gold"><X className="w-5 h-5" /></button>
        </div>
        <div id={containerId} className="rounded overflow-hidden [&_button]:!text-gold [&_select]:!bg-input [&_select]:!text-foreground" />
        <p className="text-xs text-muted-foreground text-center mt-3">Concedi il permesso fotocamera, poi inquadra il QR.</p>
      </div>
    </div>
  );
}
