import { createFileRoute, Link } from "@tanstack/react-router";
import { MeduzaLayout } from "@/components/MeduzaLayout";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEffect, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";
import { ArrowLeft, ScanLine, X, Plus, Minus, Trash2, Search, Euro, FileText } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";

export const Route = createFileRoute("/_authenticated/soci/gestisci")({
  component: GestisciSocio,
});

interface Member { id: string; first_name: string; last_name: string; card_number: string; qr_token: string; photo_url: string | null; phone: string | null; }
interface Product { id: string; name: string; type: "per_gram" | "per_piece"; price: number; stock: number; }
interface CartItem { product: Product; quantity: number; }

function GestisciSocio() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [member, setMember] = useState<Member | null>(null);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [scanning, setScanning] = useState(false);
  const [manualToken, setManualToken] = useState("");

  const { data: products } = useQuery({
    queryKey: ["products-active"],
    queryFn: async () => {
      const { data } = await supabase.from("products").select("*").eq("active", true).order("name");
      return (data ?? []) as Product[];
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

  async function findByToken(token: string) {
    const clean = token.replace(/^MEDUZA:/, "").trim();
    const { data, error } = await supabase.from("members").select("*").eq("qr_token", clean).maybeSingle();
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

          <button onClick={()=>setScanning(true)} className="w-full bg-gradient-gold text-primary-foreground py-3 rounded-md font-display uppercase tracking-widest text-xs flex items-center gap-2 justify-center">
            <ScanLine className="w-4 h-4" /> Scansiona QR
          </button>

          <div className="flex items-center gap-3 my-4">
            <div className="flex-1 h-px bg-gold/20" />
            <span className="text-[10px] uppercase tracking-widest text-gold-muted">oppure</span>
            <div className="flex-1 h-px bg-gold/20" />
          </div>

          <div className="flex gap-2">
            <input value={manualToken} onChange={(e)=>setManualToken(e.target.value)} placeholder="Codice tessera"
              className="flex-1 bg-input border border-border rounded-md px-3 py-2 text-sm focus:border-gold outline-none" />
            <button onClick={()=>{ findByToken(manualToken); setManualToken(""); }} className="px-4 border border-gold/50 text-gold rounded-md text-xs uppercase tracking-widest"><Search className="w-3 h-3" /></button>
          </div>
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
                  <button onClick={()=>{ setMember(null); setCart([]); }} className="text-[10px] uppercase tracking-widest text-muted-foreground hover:text-gold">Cambia</button>
                </div>
              </div>
            </div>

            {/* Products */}
            <div className="bg-card/60 border border-gold/30 rounded-lg p-5">
              <h3 className="font-display text-gold uppercase tracking-[0.3em] text-xs mb-4">Prodotti disponibili</h3>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {(products ?? []).map((p) => (
                  <button key={p.id} onClick={()=>addToCart(p)}
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
                    <button onClick={()=>updateQty(i.product.id, 0)} className="text-destructive"><Trash2 className="w-3 h-3" /></button>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <button onClick={()=>updateQty(i.product.id, Math.max(0, i.quantity - (i.product.type === "per_gram" ? 0.5 : 1)))} className="w-7 h-7 bg-input rounded border border-border flex items-center justify-center"><Minus className="w-3 h-3" /></button>
                      <input
                        type="number"
                        step={i.product.type === "per_gram" ? "0.1" : "1"}
                        value={i.quantity}
                        onChange={(e)=>updateQty(i.product.id, Number(e.target.value))}
                        className="w-16 text-center bg-input border border-border rounded px-1 py-1 text-xs"
                      />
                      <span className="text-[10px] text-muted-foreground">{i.product.type === "per_gram" ? "g" : "pz"}</span>
                      <button onClick={()=>updateQty(i.product.id, i.quantity + (i.product.type === "per_gram" ? 0.5 : 1))} className="w-7 h-7 bg-input rounded border border-border flex items-center justify-center"><Plus className="w-3 h-3" /></button>
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

      {scanning && <ScannerModal onClose={()=>setScanning(false)} onScan={(t)=>{ setScanning(false); findByToken(t); }} />}
    </MeduzaLayout>
  );
}

function ScannerModal({ onClose, onScan }: { onClose: () => void; onScan: (t: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    const id = "qr-scanner-gestisci";
    ref.current.id = id;
    const scanner = new Html5Qrcode(id);
    scanner.start(
      { facingMode: "environment" },
      { fps: 10, qrbox: 250 },
      (decoded) => { onScan(decoded); },
      () => {},
    ).catch((err) => {
      toast.error("Impossibile aprire la fotocamera: " + err);
      onClose();
    });
    return () => {
      scanner.stop().then(() => scanner.clear()).catch(() => {});
    };
  }, [onScan, onClose]);

  return (
    <div className="fixed inset-0 z-50 bg-background/95 backdrop-blur flex items-center justify-center p-4">
      <div className="bg-card border border-gold/50 rounded-lg p-4 max-w-md w-full">
        <div className="flex justify-between items-center mb-3">
          <h3 className="font-display text-gold uppercase tracking-widest text-sm">Scansiona QR</h3>
          <button onClick={onClose} className="text-gold-muted hover:text-gold"><X className="w-5 h-5" /></button>
        </div>
        <div ref={ref} className="rounded overflow-hidden" />
        <p className="text-xs text-muted-foreground text-center mt-3">Inquadra il QR del socio</p>
      </div>
    </div>
  );
}
