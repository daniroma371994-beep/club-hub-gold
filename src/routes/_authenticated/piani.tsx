import { createFileRoute, Link } from "@tanstack/react-router";
import { MeduzaLayout } from "@/components/MeduzaLayout";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Plus, Trash2, Pencil, Check, X, ArrowLeft, Mic } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { VoiceFormWizard, warmUpVoiceForm, type WizardField } from "@/components/voice/VoiceFormWizard";

export const Route = createFileRoute("/_authenticated/piani")({
  component: PlansPage,
});

const PLAN_WIZARD: WizardField[] = [
  { key: "name", label: "Nome piano", hint: "Esempio: 1 mese, 6 mesi, 1 anno" },
  { key: "duration_days", label: "Durata in giorni", type: "number" },
  { key: "price", label: "Prezzo in euro", type: "number" },
  { key: "description", label: "Descrizione", hint: "Oppure salta" },
];


interface Plan {
  id: string;
  name: string;
  duration_days: number;
  price: number;
  description: string | null;
  active: boolean;
}

function PlansPage() {
  const qc = useQueryClient();
  const { isAdmin } = useAuth();
  const [editing, setEditing] = useState<Partial<Plan> | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);

  const { data: plans } = useQuery({
    queryKey: ["plans"],
    queryFn: async () => {
      const { data, error } = await supabase.from("membership_plans").select("*").order("duration_days");
      if (error) throw error;
      return data as Plan[];
    },
  });

  async function save() {
    if (!editing?.name) return toast.error("Nome obbligatorio");
    if (!editing.duration_days || editing.duration_days <= 0) return toast.error("Durata in giorni obbligatoria");
    const payload = {
      name: editing.name,
      duration_days: Number(editing.duration_days),
      price: Number(editing.price ?? 0),
      description: editing.description ?? null,
      active: editing.active ?? true,
    };
    const { error } = editing.id
      ? await supabase.from("membership_plans").update(payload).eq("id", editing.id)
      : await supabase.from("membership_plans").insert(payload);
    if (error) return toast.error(error.message);
    toast.success("Piano salvato");
    setEditing(null);
    qc.invalidateQueries({ queryKey: ["plans"] });
  }

  async function remove(id: string) {
    if (!confirm("Eliminare il piano?")) return;
    const { error } = await supabase.from("membership_plans").delete().eq("id", id);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["plans"] });
  }

  return (
    <MeduzaLayout title="Quote associative">
      <Link to="/soci" className="inline-flex items-center gap-2 text-gold-muted hover:text-gold text-xs uppercase tracking-widest mb-6">
        <ArrowLeft className="w-3 h-3" /> Torna a Soci
      </Link>

      {isAdmin && (
        <div className="mb-6">
          <button
            onClick={() => setEditing({ duration_days: 30, price: 0, active: true })}
            className="bg-gradient-gold text-primary-foreground px-5 py-2.5 rounded-md font-display uppercase tracking-widest text-xs flex items-center gap-2"
          >
            <Plus className="w-4 h-4" /> Nuovo piano
          </button>
        </div>
      )}

      {editing && (
        <div className="bg-card/80 border border-gold/40 rounded-lg p-5 mb-6 space-y-3">
          <div className="grid md:grid-cols-3 gap-3">
            <Inp label="Nome" value={editing.name ?? ""} onChange={(v) => setEditing({ ...editing, name: v })} placeholder="es. 1 mese" />
            <Inp label="Durata (giorni)" type="number" value={String(editing.duration_days ?? "")} onChange={(v) => setEditing({ ...editing, duration_days: Number(v) })} placeholder="30" />
            <Inp label="Prezzo (€)" type="number" step="0.01" value={String(editing.price ?? 0)} onChange={(v) => setEditing({ ...editing, price: Number(v) })} />
          </div>
          <Inp label="Descrizione" value={editing.description ?? ""} onChange={(v) => setEditing({ ...editing, description: v })} />
          <div className="flex flex-wrap gap-2 pt-2">
            <button onClick={save} className="bg-gradient-gold text-primary-foreground px-5 py-2 rounded-md text-xs uppercase tracking-widest flex items-center gap-2"><Check className="w-3 h-3" />Salva</button>
            <button onClick={() => { void warmUpVoiceForm(); setWizardOpen(true); }} className="border border-gold text-gold px-5 py-2 rounded-md text-xs uppercase tracking-widest flex items-center gap-2"><Mic className="w-3 h-3" />Compila a voce</button>
            <button onClick={() => setEditing(null)} className="border border-border text-muted-foreground px-5 py-2 rounded-md text-xs uppercase tracking-widest flex items-center gap-2"><X className="w-3 h-3" />Annulla</button>
          </div>
        </div>
      )}

      {wizardOpen && editing && (
        <VoiceFormWizard
          fields={PLAN_WIZARD}
          onChange={(k, v) => setEditing((e) => ({ ...(e ?? {}), [k]: k === "duration_days" || k === "price" ? Number(v) : v }))}
          onClose={() => setWizardOpen(false)}
        />
      )}

      <div className="grid gap-2">
        {(plans ?? []).map((p) => (
          <div key={p.id} className="flex items-center gap-4 bg-card/60 border border-gold/20 rounded-lg p-4 hover:border-gold/50">
            <div className="flex-1">
              <div className="font-display text-gold tracking-wider text-lg">{p.name}</div>
              <div className="text-xs text-muted-foreground">{p.duration_days} giorni{p.description ? ` · ${p.description}` : ""}</div>
            </div>
            <div className="font-display text-gold text-xl">€ {Number(p.price).toFixed(2)}</div>
            {isAdmin && (
              <div className="flex gap-2">
                <button onClick={() => setEditing(p)} className="text-gold-muted hover:text-gold p-2"><Pencil className="w-4 h-4" /></button>
                <button onClick={() => remove(p.id)} className="text-destructive hover:opacity-80 p-2"><Trash2 className="w-4 h-4" /></button>
              </div>
            )}
          </div>
        ))}
        {(plans ?? []).length === 0 && (
          <div className="text-center py-12 border border-dashed border-gold/30 rounded-lg text-gold-muted">
            Nessun piano. {isAdmin && "Crea il primo (es. 1 mese, 6 mesi, 1 anno)."}
          </div>
        )}
      </div>
    </MeduzaLayout>
  );
}

function Inp({ label, value, onChange, type = "text", step, placeholder }: { label: string; value: string; onChange: (v: string) => void; type?: string; step?: string; placeholder?: string }) {
  return (
    <label className="block">
      <span className="block text-[10px] uppercase tracking-[0.3em] text-gold-muted mb-1.5">{label}</span>
      <input type={type} step={step} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)}
        className="w-full bg-input border border-border rounded-md px-3 py-2 text-sm focus:border-gold outline-none" />
    </label>
  );
}
