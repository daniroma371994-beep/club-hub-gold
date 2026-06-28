import { createFileRoute } from "@tanstack/react-router";
import { SnoopLayout } from "@/components/SnoopLayout";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Package, Tag, Plus, Trash2, Pencil, Save, X, Mic } from "lucide-react";

export const Route = createFileRoute("/_authenticated/productos")({
  component: ProductosPage,
});

type UnitType = "gr" | "unit";
type Strain = "indica" | "sativa" | "hibrida";
type Category = { id: string; name: string; unit_type: UnitType; is_smokeable: boolean };
type Product = {
  id: string;
  category_id: string;
  name: string;
  stock: number;
  buy_price: number;
  sell_price: number;
  strain: Strain | null;
  notes: string | null;
};

const TABS = [
  { id: "stock", label: "Stock" },
  { id: "nuevo", label: "Crear producto" },
  { id: "categoria", label: "Crear categoría" },
] as const;
type TabId = (typeof TABS)[number]["id"];

function ProductosPage() {
  const [tab, setTab] = useState<TabId>("stock");
  const [cats, setCats] = useState<Category[]>([]);
  const [prods, setProds] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const [{ data: c }, { data: p }] = await Promise.all([
      supabase.from("product_categories").select("*").order("name"),
      supabase.from("products").select("*").order("name"),
    ]);
    setCats((c as any) ?? []);
    setProds((p as any) ?? []);
    setLoading(false);
  }
  useEffect(() => {
    load();
  }, []);

  return (
    <SnoopLayout title="Productos" subtitle="Stock, categorías y altas">
      <div className="flex gap-2 mb-6 flex-wrap">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 rounded-lg text-xs uppercase tracking-[0.2em] font-display border transition ${
              tab === t.id
                ? "border-neon text-neon bg-neon/10 glow-neon-soft"
                : "border-border text-muted-foreground hover:text-neon hover:border-neon/40"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-muted-foreground">Cargando…</div>
      ) : tab === "stock" ? (
        <Stock cats={cats} prods={prods} onChange={load} />
      ) : tab === "nuevo" ? (
        <NuevoProducto cats={cats} onCreated={load} />
      ) : (
        <NuevaCategoria onCreated={load} />
      )}
    </SnoopLayout>
  );
}

/* ---------------- STOCK ---------------- */

function Stock({ cats, prods, onChange }: { cats: Category[]; prods: Product[]; onChange: () => void }) {
  const [filter, setFilter] = useState<string>("all");
  const grouped = useMemo(() => {
    const map = new Map<string, Product[]>();
    for (const p of prods) {
      if (filter !== "all" && p.category_id !== filter) continue;
      const arr = map.get(p.category_id) ?? [];
      arr.push(p);
      map.set(p.category_id, arr);
    }
    return map;
  }, [prods, filter]);

  if (cats.length === 0)
    return (
      <div className="bg-card/60 border border-neon/20 rounded-2xl p-8 text-center">
        <Tag className="w-8 h-8 mx-auto text-neon mb-3" />
        <p className="text-sm text-muted-foreground">
          Aún no hay categorías. Crea una primero desde <strong className="text-neon">Crear categoría</strong>.
        </p>
      </div>
    );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setFilter("all")}
          className={`px-3 py-1.5 rounded-full text-[11px] uppercase tracking-widest border ${
            filter === "all" ? "border-neon text-neon" : "border-border text-muted-foreground"
          }`}
        >
          Todas
        </button>
        {cats.map((c) => (
          <button
            key={c.id}
            onClick={() => setFilter(c.id)}
            className={`px-3 py-1.5 rounded-full text-[11px] uppercase tracking-widest border ${
              filter === c.id ? "border-neon text-neon" : "border-border text-muted-foreground"
            }`}
          >
            {c.name}
          </button>
        ))}
      </div>

      {cats
        .filter((c) => filter === "all" || c.id === filter)
        .map((c) => {
          const list = grouped.get(c.id) ?? [];
          return (
            <div key={c.id} className="bg-card/60 border border-neon/20 rounded-2xl p-5">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <div className="font-display text-lg text-neon tracking-wide">{c.name}</div>
                  <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
                    {c.unit_type === "gr" ? "Gramos" : "Unidades"}
                    {c.is_smokeable && " · fumable"}
                  </div>
                </div>
              </div>
              {list.length === 0 ? (
                <div className="text-xs text-muted-foreground">Sin productos.</div>
              ) : (
                <div className="space-y-2">
                  {list.map((p) => (
                    <ProductRow key={p.id} p={p} cat={c} onChange={onChange} />
                  ))}
                </div>
              )}
            </div>
          );
        })}
    </div>
  );
}

function ProductRow({ p, cat, onChange }: { p: Product; cat: Category; onChange: () => void }) {
  const [edit, setEdit] = useState(false);
  const [form, setForm] = useState<Product>(p);
  useEffect(() => setForm(p), [p]);

  async function save() {
    const { error } = await supabase
      .from("products")
      .update({
        name: form.name,
        stock: form.stock,
        buy_price: form.buy_price,
        sell_price: form.sell_price,
        strain: cat.is_smokeable ? form.strain : null,
        notes: form.notes,
      })
      .eq("id", p.id);
    if (error) return toast.error(error.message);
    toast.success("Producto actualizado");
    setEdit(false);
    onChange();
  }
  async function remove() {
    if (!confirm(`Eliminar ${p.name}?`)) return;
    const { error } = await supabase.from("products").delete().eq("id", p.id);
    if (error) return toast.error(error.message);
    toast.success("Eliminado");
    onChange();
  }

  if (!edit) {
    return (
      <div className="flex items-center justify-between gap-3 bg-input/40 rounded-lg px-3 py-2">
        <div className="min-w-0 flex-1">
          <div className="text-sm text-foreground truncate">
            {p.name}
            {p.strain && (
              <span className="ml-2 text-[10px] uppercase tracking-widest text-neon-dim">{p.strain}</span>
            )}
          </div>
          <div className="text-[11px] text-muted-foreground">
            Stock: <span className="text-foreground">{Number(p.stock)} {cat.unit_type === "gr" ? "gr" : "u"}</span>
            {" · "}Compra: €{Number(p.buy_price).toFixed(2)} · Venta: €{Number(p.sell_price).toFixed(2)}
          </div>
        </div>
        <div className="flex gap-1">
          <button onClick={() => setEdit(true)} className="p-2 text-muted-foreground hover:text-neon">
            <Pencil className="w-4 h-4" />
          </button>
          <button onClick={remove} className="p-2 text-muted-foreground hover:text-destructive">
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-input/40 rounded-lg p-3 space-y-2">
      <input
        className="w-full bg-input border border-border rounded px-2 py-1.5 text-sm"
        value={form.name}
        onChange={(e) => setForm({ ...form, name: e.target.value })}
      />
      <div className="grid grid-cols-3 gap-2">
        <NumField label={`Stock (${cat.unit_type})`} value={form.stock} onChange={(v) => setForm({ ...form, stock: v })} />
        <NumField label="Compra €" value={form.buy_price} onChange={(v) => setForm({ ...form, buy_price: v })} />
        <NumField label="Venta €" value={form.sell_price} onChange={(v) => setForm({ ...form, sell_price: v })} />
      </div>
      {cat.is_smokeable && (
        <select
          value={form.strain ?? ""}
          onChange={(e) => setForm({ ...form, strain: (e.target.value || null) as Strain | null })}
          className="w-full bg-input border border-border rounded px-2 py-1.5 text-sm"
        >
          <option value="">— tipo —</option>
          <option value="indica">Indica</option>
          <option value="sativa">Sativa</option>
          <option value="hibrida">Híbrida</option>
        </select>
      )}
      <div className="flex gap-2 justify-end">
        <button onClick={() => { setEdit(false); setForm(p); }} className="px-3 py-1.5 text-xs border border-border rounded">
          <X className="w-3 h-3 inline mr-1" /> Cancelar
        </button>
        <button onClick={save} className="px-3 py-1.5 text-xs bg-gradient-neon text-primary-foreground rounded font-semibold">
          <Save className="w-3 h-3 inline mr-1" /> Guardar
        </button>
      </div>
    </div>
  );
}

function NumField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label className="block">
      <span className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</span>
      <input
        type="number"
        step="0.01"
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
        className="w-full bg-input border border-border rounded px-2 py-1.5 text-sm"
      />
    </label>
  );
}

/* ---------------- NUEVO PRODUCTO ---------------- */

function NuevoProducto({ cats, onCreated }: { cats: Category[]; onCreated: () => void }) {
  const [categoryId, setCategoryId] = useState("");
  const [name, setName] = useState("");
  const [stock, setStock] = useState(0);
  const [buy, setBuy] = useState(0);
  const [sell, setSell] = useState(0);
  const [strain, setStrain] = useState<Strain | "">("");
  const [saving, setSaving] = useState(false);
  const cat = cats.find((c) => c.id === categoryId);

  // voice input for product name
  const [listening, setListening] = useState(false);
  function startVoice() {
    const SR: any = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return toast.error("Tu navegador no soporta dictado");
    const r = new SR();
    r.lang = "es-ES";
    r.interimResults = false;
    r.onresult = (e: any) => setName(e.results[0][0].transcript);
    r.onend = () => setListening(false);
    r.onerror = () => setListening(false);
    setListening(true);
    r.start();
  }

  async function submit() {
    if (!categoryId) return toast.error("Selecciona categoría");
    if (!name.trim()) return toast.error("Nombre obligatorio");
    setSaving(true);
    const { error } = await supabase.from("products").insert({
      category_id: categoryId,
      name: name.trim(),
      stock,
      buy_price: buy,
      sell_price: sell,
      strain: cat?.is_smokeable && strain ? strain : null,
    });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Producto creado");
    setName("");
    setStock(0);
    setBuy(0);
    setSell(0);
    setStrain("");
    onCreated();
  }

  if (cats.length === 0)
    return (
      <div className="bg-card/60 border border-neon/20 rounded-2xl p-8 text-center">
        <p className="text-sm text-muted-foreground">Crea primero una categoría.</p>
      </div>
    );

  return (
    <div className="max-w-xl bg-card/60 border border-neon/20 rounded-2xl p-6 space-y-4">
      <Field label="Categoría">
        <select
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
          className="w-full bg-input border border-border rounded-lg px-3 py-2.5 text-sm focus:border-neon outline-none"
        >
          <option value="">— elegir —</option>
          {cats.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} ({c.unit_type === "gr" ? "gr" : "u"})
            </option>
          ))}
        </select>
      </Field>

      <Field label="Nombre del producto">
        <div className="flex gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="ej. Amnesia Haze"
            className="flex-1 bg-input border border-border rounded-lg px-3 py-2.5 text-sm focus:border-neon outline-none"
          />
          <button
            type="button"
            onClick={startVoice}
            className={`px-3 rounded-lg border ${listening ? "border-neon text-neon glow-neon" : "border-border text-muted-foreground"}`}
            title="Dictar nombre"
          >
            <Mic className="w-4 h-4" />
          </button>
        </div>
      </Field>

      <div className="grid grid-cols-3 gap-3">
        <Field label={`Stock${cat ? ` (${cat.unit_type})` : ""}`}>
          <input type="number" step="0.01" value={stock} onChange={(e) => setStock(parseFloat(e.target.value) || 0)}
            className="w-full bg-input border border-border rounded-lg px-3 py-2.5 text-sm" />
        </Field>
        <Field label="P. compra €">
          <input type="number" step="0.01" value={buy} onChange={(e) => setBuy(parseFloat(e.target.value) || 0)}
            className="w-full bg-input border border-border rounded-lg px-3 py-2.5 text-sm" />
        </Field>
        <Field label="P. venta €">
          <input type="number" step="0.01" value={sell} onChange={(e) => setSell(parseFloat(e.target.value) || 0)}
            className="w-full bg-input border border-border rounded-lg px-3 py-2.5 text-sm" />
        </Field>
      </div>

      {cat?.is_smokeable && (
        <Field label="Tipo (fumable)">
          <select value={strain} onChange={(e) => setStrain(e.target.value as Strain | "")}
            className="w-full bg-input border border-border rounded-lg px-3 py-2.5 text-sm focus:border-neon outline-none">
            <option value="">— sin especificar —</option>
            <option value="indica">Indica</option>
            <option value="sativa">Sativa</option>
            <option value="hibrida">Híbrida</option>
          </select>
        </Field>
      )}

      <button
        onClick={submit}
        disabled={saving}
        className="w-full bg-gradient-neon text-primary-foreground py-3 rounded-xl font-display font-semibold uppercase tracking-[0.2em] text-xs glow-neon disabled:opacity-50"
      >
        <Plus className="w-4 h-4 inline mr-2" /> {saving ? "Creando…" : "Crear producto"}
      </button>
    </div>
  );
}

/* ---------------- NUEVA CATEGORIA ---------------- */

function NuevaCategoria({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState("");
  const [unit, setUnit] = useState<UnitType>("unit");
  const [smokeable, setSmokeable] = useState(false);
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (!name.trim()) return toast.error("Nombre obligatorio");
    setSaving(true);
    const { error } = await supabase.from("product_categories").insert({
      name: name.trim(),
      unit_type: unit,
      is_smokeable: smokeable,
    });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Categoría creada");
    setName("");
    setUnit("unit");
    setSmokeable(false);
    onCreated();
  }

  const ejemplos = ["Flores", "Hash", "Extracciones", "Bebidas", "Parafernalia", "Prerolled"];

  return (
    <div className="max-w-xl bg-card/60 border border-neon/20 rounded-2xl p-6 space-y-4">
      <Field label="Nombre">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="ej. Flores"
          className="w-full bg-input border border-border rounded-lg px-3 py-2.5 text-sm focus:border-neon outline-none" />
        <div className="mt-2 flex flex-wrap gap-1">
          {ejemplos.map((ex) => (
            <button key={ex} type="button" onClick={() => setName(ex)}
              className="text-[10px] uppercase tracking-widest px-2 py-1 rounded-full border border-border text-muted-foreground hover:text-neon hover:border-neon/40">
              {ex}
            </button>
          ))}
        </div>
      </Field>

      <Field label="Unidad de medida">
        <div className="grid grid-cols-2 gap-2">
          {(["gr", "unit"] as UnitType[]).map((u) => (
            <button key={u} type="button" onClick={() => setUnit(u)}
              className={`py-2.5 rounded-lg text-xs uppercase tracking-widest border ${
                unit === u ? "border-neon text-neon bg-neon/10" : "border-border text-muted-foreground"
              }`}>
              {u === "gr" ? "Gramos" : "Unidades"}
            </button>
          ))}
        </div>
      </Field>

      <label className="flex items-center gap-3 cursor-pointer">
        <input type="checkbox" checked={smokeable} onChange={(e) => setSmokeable(e.target.checked)}
          className="w-4 h-4 accent-[var(--neon)]" />
        <span className="text-sm">Producto fumable (mostrará indica / sativa / híbrida)</span>
      </label>

      <button onClick={submit} disabled={saving}
        className="w-full bg-gradient-neon text-primary-foreground py-3 rounded-xl font-display font-semibold uppercase tracking-[0.2em] text-xs glow-neon disabled:opacity-50">
        <Plus className="w-4 h-4 inline mr-2" /> {saving ? "Creando…" : "Crear categoría"}
      </button>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[10px] uppercase tracking-[0.25em] text-neon-dim">{label}</span>
      <div className="mt-1.5">{children}</div>
    </label>
  );
}
