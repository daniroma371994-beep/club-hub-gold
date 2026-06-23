import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { MeduzaLayout } from "@/components/MeduzaLayout";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Mic } from "lucide-react";
import { VoiceFormWizard, type WizardField } from "@/components/voice/VoiceFormWizard";
import { voiceBus } from "@/components/voice/voice-bus";

export const Route = createFileRoute("/_authenticated/soci/nuovo")({
  component: NewSocio,
});

const WIZARD_FIELDS: WizardField[] = [
  { key: "card_number", label: "Numero tessera", type: "number", hint: "Detta solo i numeri" },
  { key: "first_name", label: "Nome" },
  { key: "last_name", label: "Cognome" },
  { key: "birth_date", label: "Data di nascita", type: "date", hint: "Esempio: 12 marzo 1990" },
  { key: "address", label: "Indirizzo" },
  { key: "phone", label: "Telefono", type: "phone" },
  { key: "email", label: "Email", type: "email", hint: "Di chiocciola per @ e punto per ." },
  { key: "document_number", label: "Numero documento" },
];

const empty = {
  card_number: "",
  first_name: "",
  last_name: "",
  birth_date: "",
  address: "",
  phone: "",
  email: "",
  document_type: "DNI",
  document_number: "",
  document_expiry: "",
  photo_url: "",
  expires_at: "",
  notes: "",
};

function NewSocio() {
  const nav = useNavigate();
  const [form, setForm] = useState(empty);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);

  useEffect(() => {
    voiceBus.register({
      fillCurrentForm: (fields) => {
        setForm((current) => ({ ...current, ...fields }));
        toast.success("Campi socio compilati");
        return true;
      },
    });
    return () => voiceBus.unregister(["fillCurrentForm"]);
  }, []);

  function setField<K extends keyof typeof empty>(k: K, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function uploadPhoto(file: File) {
    if (file.size > 800_000) {
      toast.error("Foto troppo grande (max 800KB). Comprimila prima di caricarla.");
      return;
    }
    setUploading(true);
    try {
      const reader = new FileReader();
      reader.onload = () => {
        setField("photo_url", reader.result as string);
        toast.success("Foto caricata");
        setUploading(false);
      };
      reader.onerror = () => { toast.error("Errore lettura file"); setUploading(false); };
      reader.readAsDataURL(file);
    } catch (e: any) {
      toast.error(e.message);
      setUploading(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const { data: user } = await supabase.auth.getUser();
      const payload = {
        ...form,
        created_by: user.user?.id,
        birth_date: form.birth_date || null,
        document_expiry: form.document_expiry || null,
        expires_at: form.expires_at || null,
      };
      const { data, error } = await supabase.from("members").insert(payload).select("id").single();
      if (error) throw error;
      toast.success("Socio registrato. QR generato.");
      nav({ to: "/soci/$id", params: { id: data.id } });
    } catch (e: any) {
      toast.error(e.message);
    } finally { setSaving(false); }
  }

  return (
    <MeduzaLayout title="Nuovo Socio">
      {wizardOpen && (
        <VoiceFormWizard
          fields={WIZARD_FIELDS}
          onChange={(k, v) => setField(k as keyof typeof empty, v)}
          onClose={() => setWizardOpen(false)}
        />
      )}
      <div className="max-w-3xl mb-4">
        <button
          type="button"
          onClick={() => setWizardOpen(true)}
          className="w-full md:w-auto flex items-center justify-center gap-2 px-5 py-3 bg-gradient-gold text-primary-foreground rounded-md font-display uppercase tracking-[0.3em] text-xs shadow-lg"
        >
          <Mic className="w-4 h-4" /> Compila a voce
        </button>
      </div>
      <form onSubmit={submit} className="bg-card/60 border border-gold/30 rounded-lg p-6 md:p-8 space-y-6 max-w-3xl">

        <Section title="Dati anagrafici">
          <div className="grid md:grid-cols-2 gap-4">
            <Inp label="N° Tessera" required value={form.card_number} onChange={(v)=>setField("card_number",v)} placeholder="es. 0001" />
            <Inp label="Data di nascita" type="date" value={form.birth_date} onChange={(v)=>setField("birth_date",v)} />
            <Inp label="Nome" required value={form.first_name} onChange={(v)=>setField("first_name",v)} />
            <Inp label="Cognome" required value={form.last_name} onChange={(v)=>setField("last_name",v)} />
            <Inp label="Indirizzo" value={form.address} onChange={(v)=>setField("address",v)} className="md:col-span-2" />
            <Inp label="Telefono" value={form.phone} onChange={(v)=>setField("phone",v)} />
            <Inp label="Email" type="email" value={form.email} onChange={(v)=>setField("email",v)} />
          </div>
        </Section>

        <Section title="Documento d'identità">
          <div className="grid md:grid-cols-3 gap-4">
            <Sel label="Tipo" value={form.document_type} onChange={(v)=>setField("document_type",v)} options={["DNI","Passaporto","Carta d'identità","Patente"]} />
            <Inp label="Numero documento" value={form.document_number} onChange={(v)=>setField("document_number",v)} />
            <Inp label="Scadenza" type="date" value={form.document_expiry} onChange={(v)=>setField("document_expiry",v)} />
          </div>
        </Section>

        <Section title="Foto">
          <div className="flex items-center gap-4">
            {form.photo_url && <img src={form.photo_url} alt="" className="w-20 h-20 rounded-full object-cover border border-gold/50" />}
            <label className="cursor-pointer px-4 py-2 border border-gold/50 text-gold rounded-md text-xs uppercase tracking-widest hover:bg-gold/10">
              {uploading ? "Caricamento..." : form.photo_url ? "Cambia foto" : "Carica foto"}
              <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && uploadPhoto(e.target.files[0])} />
            </label>
          </div>
        </Section>

        <Section title="Tessera">
          <div className="grid md:grid-cols-2 gap-4">
            <Inp label="Scadenza tessera" type="date" value={form.expires_at} onChange={(v)=>setField("expires_at",v)} />
          </div>
          <label className="block mt-4">
            <span className="block text-[10px] uppercase tracking-[0.3em] text-gold-muted mb-1.5">Note</span>
            <textarea value={form.notes} onChange={(e)=>setField("notes", e.target.value)} rows={3}
              className="w-full bg-input border border-border rounded-md px-3 py-2 text-sm focus:border-gold outline-none" />
          </label>
        </Section>

        <div className="flex gap-3 pt-4 border-t border-gold/20">
          <button type="button" onClick={()=>nav({ to: "/soci" })} className="px-6 py-3 border border-border text-muted-foreground rounded-md text-xs uppercase tracking-widest hover:text-gold hover:border-gold">Annulla</button>
          <button disabled={saving} className="flex-1 bg-gradient-gold text-primary-foreground py-3 rounded-md font-display uppercase tracking-[0.3em] text-sm disabled:opacity-50">
            {saving ? "Salvataggio..." : "Registra e genera QR"}
          </button>
        </div>
      </form>
    </MeduzaLayout>
  );
}

function Section({ title, children }: any) {
  return (
    <div>
      <h3 className="font-display text-gold uppercase tracking-[0.3em] text-xs mb-4 pb-2 border-b border-gold/20">{title}</h3>
      {children}
    </div>
  );
}

function Inp({ label, value, onChange, type="text", required, placeholder, className="" }: { label: string; value: string; onChange: (v: string) => void; type?: string; required?: boolean; placeholder?: string; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="block text-[10px] uppercase tracking-[0.3em] text-gold-muted mb-1.5">{label}{required && " *"}</span>
      <input required={required} type={type} value={value} placeholder={placeholder}
        onChange={(e)=>onChange(e.target.value)}
        className="w-full bg-input border border-border rounded-md px-3 py-2 text-sm focus:border-gold outline-none" />
    </label>
  );
}

function Sel({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: string[] }) {
  return (
    <label className="block">
      <span className="block text-[10px] uppercase tracking-[0.3em] text-gold-muted mb-1.5">{label}</span>
      <select value={value} onChange={(e)=>onChange(e.target.value)}
        className="w-full bg-input border border-border rounded-md px-3 py-2 text-sm focus:border-gold outline-none">
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </label>
  );
}
