import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { MeduzaLayout } from "@/components/MeduzaLayout";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/soci/nuovo")({
  component: NewSocio,
});

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

  function setField<K extends keyof typeof empty>(k: K, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function uploadPhoto(file: File) {
    setUploading(true);
    try {
      const ext = file.name.split(".").pop();
      const path = `${crypto.randomUUID()}.${ext}`;
      const { error } = await supabase.storage.from("member-photos").upload(path, file, { upsert: false });
      if (error) throw error;
      const { data } = supabase.storage.from("member-photos").getPublicUrl(path);
      setField("photo_url", data.publicUrl);
      toast.success("Foto caricata");
    } catch (e: any) {
      toast.error(e.message);
    } finally { setUploading(false); }
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

function Inp({ label, value, onChange, type="text", required, placeholder, className="" }: any) {
  return (
    <label className={`block ${className}`}>
      <span className="block text-[10px] uppercase tracking-[0.3em] text-gold-muted mb-1.5">{label}{required && " *"}</span>
      <input required={required} type={type} value={value} placeholder={placeholder}
        onChange={(e)=>onChange(e.target.value)}
        className="w-full bg-input border border-border rounded-md px-3 py-2 text-sm focus:border-gold outline-none" />
    </label>
  );
}

function Sel({ label, value, onChange, options }: any) {
  return (
    <label className="block">
      <span className="block text-[10px] uppercase tracking-[0.3em] text-gold-muted mb-1.5">{label}</span>
      <select value={value} onChange={(e)=>onChange(e.target.value)}
        className="w-full bg-input border border-border rounded-md px-3 py-2 text-sm focus:border-gold outline-none">
        {options.map((o: string) => <option key={o} value={o}>{o}</option>)}
      </select>
    </label>
  );
}
