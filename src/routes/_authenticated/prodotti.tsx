import { createFileRoute } from "@tanstack/react-router";
import { MeduzaLayout } from "@/components/MeduzaLayout";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Plus, Trash2, Pencil, Check, X, Mic } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { VoiceFormWizard, warmUpVoiceForm, type WizardField } from "@/components/voice/VoiceFormWizard";
import { voiceBus } from "@/components/voice/voice-bus";

export const Route = createFileRoute("/_authenticated/prodotti")({
  component: ProductsPage,
});

const PRODUCT_WIZARD: WizardField[] = [
  { key: "name", label: "Nome prodotto" },
  { key: "description", label: "Descrizione", hint: "Oppure salta" },
  { key: "price", label: "Prezzo", type: "number", hint: "Solo numero in euro" },
  { key: "stock", label: "Stock disponibile", type: "number" },
];


interface ProductRow {
  id: string;
  name: string;
  description: string | null;
  type: "per_gram" | "per_piece";
  price: number;
  stock: number;
  active: boolean;
}

function ProductsPage() {
  const qc = useQueryClient();
  const { can, isAdmin } = useAuth();
  const canEdit = isAdmin || can("manage_products");
  const [editing, setEditing] = useState<Partial<ProductRow> | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);

  useEffect(() => {
    voiceBus.register({
      fillCurrentForm: (fields) => {
        setEditing((current) => ({
          ...(current ?? { type: "per_gram", price: 0, stock: 0, active: true }),
          ...fields,
          price: fields.price != null ? Number(fields.price) : current?.price ?? 0,
          stock: fields.stock != null ? Number(fields.stock) : current?.stock ?? 0,
        }));
        toast.success("Campi prodotto compilati");
        return true;
      },
    });
    return () => voiceBus.unregister(["fillCurrentForm"]);
  }, []);

  const { data: products } = useQuery({
    queryKey: ["products"],
    queryFn: async () => {
      const { data, error } = await supabase.from("products").select("*").order("name");
      if (error) throw error;
      return data as ProductRow[];
    },
  });

  async function save() {
    if (!editing?.name) return toast.error("Nome obbligatorio");
    const payload = {
      name: editing.name,
      description: editing.description ?? null,
      type: editing.type ?? "per_gram",
      price: Number(editing.price ?? 0),
      stock: Number(editing.stock ?? 0),
      active: editing.active ?? true,
    };
    const { error } = editing.id
      ? await supabase.from("products").update(payload).eq("id", editing.id)
      : await supabase.from("products").insert(payload);
    if (error) return toast.error(error.message);
    toast.success("Prodotto salvato");
    setEditing(null);
    qc.invalidateQueries({ queryKey: ["products"] });
  }

  async function remove(id: string) {
    if (!confirm("Eliminare il prodotto?")) return;
    const { error } = await supabase.from("products").delete().eq("id", id);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["products"] });
  }

  return (
    <MeduzaLayout title="Prodotti">
      {canEdit && (
        <div className="mb-6">
          <button
            onClick={() => setEditing({ type: "per_gram", price: 0, stock: 0, active: true })}
            className="bg-gradient-gold text-primary-foreground px-5 py-2.5 rounded-md font-display uppercase tracking-widest text-xs flex items-center gap-2"
          >
            <Plus className="w-4 h-4" /> Nuovo prodotto
          </button>
        </div>
      )}

      {editing && (
        <div className="bg-card/80 border border-gold/40 rounded-lg p-5 mb-6 space-y-3">
          <div className="grid md:grid-cols-2 gap-3">
            <Inp label="Nome" value={editing.name ?? ""} onChange={(v) => setEditing({ ...editing, name: v })} />
            <Sel label="Tipo vendita" value={editing.type ?? "per_gram"} onChange={(v) => setEditing({ ...editing, type: v as any })}
              options={[{v:"per_gram", l:"Al grammo (€/g)"}, {v:"per_piece", l:"A pezzo"}]} />
            <Inp label={editing.type === "per_piece" ? "Prezzo per pezzo (€)" : "Prezzo al grammo (€)"} type="number" step="0.01"
              value={String(editing.price ?? 0)} onChange={(v) => setEditing({ ...editing, price: Number(v) })} />
            <Inp label={editing.type === "per_piece" ? "Stock (pezzi)" : "Stock (grammi)"} type="number" step="0.01"
              value={String(editing.stock ?? 0)} onChange={(v) => setEditing({ ...editing, stock: Number(v) })} />
          </div>
          <Inp label="Descrizione" value={editing.description ?? ""} onChange={(v) => setEditing({ ...editing, description: v })} />
          <div className="flex flex-wrap gap-2 pt-2">
            <button onClick={save} className="bg-gradient-gold text-primary-foreground px-5 py-2 rounded-md text-xs uppercase tracking-widest flex items-center gap-2"><Check className="w-3 h-3" />Salva</button>
            <button onClick={() => { warmUpVoiceForm().catch(() => undefined); setWizardOpen(true); }} className="border border-gold text-gold px-5 py-2 rounded-md text-xs uppercase tracking-widest flex items-center gap-2"><Mic className="w-3 h-3" />Compila a voce</button>
            <button onClick={()=>setEditing(null)} className="border border-border text-muted-foreground px-5 py-2 rounded-md text-xs uppercase tracking-widest flex items-center gap-2"><X className="w-3 h-3" />Annulla</button>
          </div>
        </div>
      )}

      {wizardOpen && editing && (
        <VoiceFormWizard
          fields={PRODUCT_WIZARD}
          onChange={(k, v) => setEditing((e) => ({ ...(e ?? {}), [k]: k === "price" || k === "stock" ? Number(v) : v }))}
          onClose={() => setWizardOpen(false)}
        />
      )}

      <div className="grid gap-2">
        {(products ?? []).map((p) => (
          <div key={p.id} className="flex items-center gap-4 bg-card/60 border border-gold/20 rounded-lg p-4 hover:border-gold/50">
            <div className="flex-1">
              <div className="font-display text-gold tracking-wider">{p.name}</div>
              <div className="text-xs text-muted-foreground">{p.description ?? "—"}</div>
            </div>
            <div className="text-right">
              <div className="font-display text-gold">€ {Number(p.price).toFixed(2)}{p.type === "per_gram" && <span className="text-xs text-gold-muted">/g</span>}</div>
              <div className="text-[10px] text-muted-foreground uppercase tracking-wider">
                Stock: {Number(p.stock).toFixed(p.type === "per_gram" ? 1 : 0)}{p.type === "per_gram" ? "g" : "pz"}
              </div>
            </div>
            {canEdit && (
              <div className="flex gap-2">
                <button onClick={()=>setEditing(p)} className="text-gold-muted hover:text-gold p-2"><Pencil className="w-4 h-4" /></button>
                {isAdmin && <button onClick={()=>remove(p.id)} className="text-destructive hover:opacity-80 p-2"><Trash2 className="w-4 h-4" /></button>}
              </div>
            )}
          </div>
        ))}
        {(products ?? []).length === 0 && (
          <div className="text-center py-12 border border-dashed border-gold/30 rounded-lg text-gold-muted">
            Nessun prodotto. {canEdit && "Aggiungine uno."}
          </div>
        )}
      </div>
    </MeduzaLayout>
  );
}

function Inp({ label, value, onChange, type = "text", step }: { label: string; value: string; onChange: (v: string) => void; type?: string; step?: string }) {
  return (
    <label className="block">
      <span className="block text-[10px] uppercase tracking-[0.3em] text-gold-muted mb-1.5">{label}</span>
      <input type={type} step={step} value={value} onChange={(e) => onChange(e.target.value)}
        className="w-full bg-input border border-border rounded-md px-3 py-2 text-sm focus:border-gold outline-none" />
    </label>
  );
}

function Sel({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: { v: string; l: string }[] }) {
  return (
    <label className="block">
      <span className="block text-[10px] uppercase tracking-[0.3em] text-gold-muted mb-1.5">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}
        className="w-full bg-input border border-border rounded-md px-3 py-2 text-sm focus:border-gold outline-none">
        {options.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
      </select>
    </label>
  );
}
