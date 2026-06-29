import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { SnoopLayout } from "@/components/SnoopLayout";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { ArrowLeft, Mic, Square, Loader2, Trash2, Plus, ShoppingBag, Send } from "lucide-react";
import { parseOrderItems, transcribeAudio } from "@/lib/voice-agent.functions";
import { formatPrice } from "@/lib/snoop";

export const Route = createFileRoute("/_authenticated/soci/$id/pedido")({
  component: PedidoPage,
});

type Product = {
  id: string;
  category_id: string;
  name: string;
  stock: number;
  sell_price: number;
  unit_type: "gr" | "unit";
};

type Cart = {
  product_id: string;
  product_name: string;
  unit_type: "gr" | "unit";
  quantity: number;
  unit_price_cents: number;
  line_total_cents: number;
};

function pickMime(): string | null {
  const c = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/mpeg"];
  for (const t of c) if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(t)) return t;
  return null;
}
async function blobToBase64(blob: Blob) {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
  return btoa(bin);
}

function PedidoPage() {
  const { id } = Route.useParams();
  const nav = useNavigate();
  const [member, setMember] = useState<{ first_name: string; last_name: string; member_number: string } | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [cart, setCart] = useState<Cart[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [notes, setNotes] = useState("");
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  const parse = useServerFn(parseOrderItems);
  const transcribe = useServerFn(transcribeAudio);

  useEffect(() => {
    (async () => {
      const [{ data: m }, { data: p }] = await Promise.all([
        supabase.from("members").select("first_name,last_name,member_number").eq("id", id).maybeSingle(),
        supabase.from("products").select("id,category_id,name,stock,sell_price,product_categories(unit_type)").order("name"),
      ]);
      setMember((m as any) ?? null);
      const flat: Product[] = ((p as any[]) ?? []).map((row) => ({
        id: row.id,
        category_id: row.category_id,
        name: row.name,
        stock: Number(row.stock ?? 0),
        sell_price: Number(row.sell_price ?? 0),
        unit_type: (row.product_categories?.unit_type ?? "unit") as "gr" | "unit",
      }));
      setProducts(flat);
    })();
  }, [id]);

  const total = useMemo(() => cart.reduce((a, c) => a + c.line_total_cents, 0), [cart]);

  function addToCart(productId: string, quantity: number) {
    const p = products.find((x) => x.id === productId);
    if (!p) return;
    if (quantity <= 0) return;
    if (quantity > p.stock) {
      toast.error(`Stock insuficiente de ${p.name} (disponible: ${p.stock})`);
      return;
    }
    const line_total_cents = Math.round(p.sell_price * quantity);
    setCart((prev) => {
      const i = prev.findIndex((c) => c.product_id === productId);
      if (i >= 0) {
        const merged = [...prev];
        const newQty = merged[i].quantity + quantity;
        if (newQty > p.stock) {
          toast.error(`Stock insuficiente de ${p.name}`);
          return prev;
        }
        merged[i] = {
          ...merged[i],
          quantity: newQty,
          line_total_cents: Math.round(p.sell_price * newQty),
        };
        return merged;
      }
      return [
        ...prev,
        {
          product_id: p.id,
          product_name: p.name,
          unit_type: p.unit_type,
          quantity,
          unit_price_cents: p.sell_price,
          line_total_cents,
        },
      ];
    });
  }

  async function processTranscript(t: string) {
    if (!t.trim()) return;
    setBusy(true);
    try {
      const { items } = await parse({
        data: {
          transcript: t,
          products: products.map((p) => ({
            id: p.id,
            name: p.name,
            unit_type: p.unit_type,
            sell_price: p.sell_price,
            stock: p.stock,
          })),
        },
      });
      if (!items.length) {
        toast.error("No encontré productos en lo que dictaste");
        return;
      }
      for (const it of items) addToCart(it.product_id, it.quantity);
      toast.success(`Añadidos ${items.length} item${items.length > 1 ? "s" : ""}`);
      setText("");
    } catch (e: any) {
      toast.error(e?.message ?? "Error al interpretar");
    } finally {
      setBusy(false);
    }
  }

  async function startRec() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mime = pickMime();
      if (!mime) {
        stream.getTracks().forEach((t) => t.stop());
        toast.error("Navegador no compatible");
        return;
      }
      const rec = new MediaRecorder(stream, { mimeType: mime });
      chunksRef.current = [];
      rec.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        const blob = new Blob(chunksRef.current, { type: rec.mimeType });
        if (blob.size < 1200) { setProcessing(false); return; }
        setProcessing(true);
        try {
          const b64 = await blobToBase64(blob);
          const { text: tx } = await transcribe({ data: { audioBase64: b64, mimeType: rec.mimeType } });
          if (tx) await processTranscript(tx);
        } catch (e: any) {
          toast.error(e?.message ?? "Error transcribiendo");
        } finally {
          setProcessing(false);
        }
      };
      recRef.current = rec;
      rec.start();
      setRecording(true);
    } catch {
      toast.error("Permiso de micrófono denegado");
    }
  }
  function stopRec() {
    recRef.current?.stop();
    recRef.current = null;
    setRecording(false);
  }

  async function confirmar() {
    if (!cart.length) return toast.error("Carrito vacío");
    setBusy(true);
    try {
      const { data, error } = await (supabase.rpc as any)("create_order_with_items", {
        _member_id: id,
        _notes: notes || null,
        _items: cart,
      });
      if (error) throw error;
      toast.success(`Pedido cerrado · ${formatPrice(total)}`);
      nav({ to: "/soci/$id", params: { id } });
    } catch (e: any) {
      toast.error(e?.message ?? "Error al guardar");
    } finally {
      setBusy(false);
    }
  }

  return (
    <SnoopLayout title="Nuevo pedido" subtitle={member ? `${member.first_name} ${member.last_name} · #${member.member_number}` : ""}>
      <Link to="/soci/$id" params={{ id }} className="inline-flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground hover:text-neon mb-6">
        <ArrowLeft className="w-4 h-4" /> Volver a la ficha
      </Link>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Dictation */}
        <div className="lg:col-span-2 space-y-4">
          <div className="bg-card/60 border border-neon/20 rounded-2xl p-5">
            <div className="text-[10px] uppercase tracking-[0.3em] text-neon-dim mb-3">Dicta o escribe el pedido</div>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder='ej. "un gramo de amnesia, dos cervezas y medio de critical"'
              rows={3}
              className="w-full bg-input border border-border rounded-lg px-3 py-2 text-sm focus:border-neon outline-none resize-none"
            />
            <div className="flex gap-2 mt-3 flex-wrap">
              <button
                onClick={recording ? stopRec : startRec}
                disabled={busy || processing}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs uppercase tracking-widest font-display border transition ${
                  recording ? "border-destructive text-destructive bg-destructive/10" : "border-neon text-neon bg-neon/10 hover:bg-neon/20"
                }`}
              >
                {processing ? <Loader2 className="w-4 h-4 animate-spin" /> : recording ? <Square className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                {processing ? "Transcribiendo…" : recording ? "Parar" : "Hablar"}
              </button>
              <button
                onClick={() => processTranscript(text)}
                disabled={busy || !text.trim()}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs uppercase tracking-widest font-display bg-gradient-neon text-primary-foreground glow-neon disabled:opacity-50"
              >
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                Añadir al carrito
              </button>
            </div>
          </div>

          {/* Quick catalog */}
          <div className="bg-card/60 border border-neon/20 rounded-2xl p-5">
            <div className="text-[10px] uppercase tracking-[0.3em] text-neon-dim mb-3">Catálogo rápido</div>
            {products.length === 0 ? (
              <div className="text-sm text-muted-foreground">No hay productos. Crea alguno en <Link to="/productos" className="text-neon underline">Productos</Link>.</div>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                {products.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => addToCart(p.id, p.unit_type === "gr" ? 1 : 1)}
                    disabled={p.stock <= 0}
                    className="text-left p-3 rounded-lg border border-border hover:border-neon/60 hover:bg-neon/5 disabled:opacity-40 disabled:cursor-not-allowed transition"
                  >
                    <div className="text-sm text-foreground truncate flex items-center gap-1"><Plus className="w-3 h-3 text-neon" />{p.name}</div>
                    <div className="text-[10px] text-muted-foreground mt-0.5">
                      {formatPrice(p.sell_price)}/{p.unit_type} · stock {p.stock}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Cart */}
        <div className="space-y-4">
          <div className="bg-card/60 border border-neon/20 rounded-2xl p-5">
            <div className="flex items-center gap-2 mb-3">
              <ShoppingBag className="w-4 h-4 text-neon" />
              <div className="font-display text-sm">Carrito</div>
            </div>
            {cart.length === 0 ? (
              <div className="text-xs text-muted-foreground">Vacío</div>
            ) : (
              <ul className="space-y-2">
                {cart.map((c, i) => (
                  <li key={i} className="flex items-start justify-between gap-2 text-sm border-b border-border/40 pb-2">
                    <div className="min-w-0">
                      <div className="text-foreground truncate">{c.product_name}</div>
                      <div className="text-[10px] text-muted-foreground">
                        {c.quantity}{c.unit_type === "gr" ? " g" : " ud"} × {formatPrice(c.unit_price_cents)}
                      </div>
                    </div>
                    <div className="text-neon font-display whitespace-nowrap">{formatPrice(c.line_total_cents)}</div>
                    <button onClick={() => setCart((p) => p.filter((_, j) => j !== i))} className="text-muted-foreground hover:text-destructive">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex items-center justify-between mt-4 pt-3 border-t border-neon/20">
              <div className="text-[10px] uppercase tracking-[0.3em] text-neon-dim">Total</div>
              <div className="font-display text-2xl text-neon">{formatPrice(total)}</div>
            </div>
          </div>

          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Notas (opcional)"
            rows={2}
            className="w-full bg-input border border-border rounded-lg px-3 py-2 text-xs focus:border-neon outline-none resize-none"
          />

          <button
            onClick={confirmar}
            disabled={!cart.length || busy}
            className="w-full bg-gradient-neon text-primary-foreground py-3 rounded-xl font-display font-semibold uppercase tracking-[0.2em] text-xs glow-neon disabled:opacity-50"
          >
            {busy ? "Guardando…" : "Confirmar pedido"}
          </button>
        </div>
      </div>
    </SnoopLayout>
  );
}
