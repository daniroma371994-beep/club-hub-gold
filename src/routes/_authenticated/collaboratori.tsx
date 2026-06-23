import { createFileRoute, Navigate } from "@tanstack/react-router";
import { MeduzaLayout } from "@/components/MeduzaLayout";
import { useAuth } from "@/hooks/useAuth";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useState } from "react";
import { toast } from "sonner";
import { UserPlus, Shield, ShieldCheck, Mic } from "lucide-react";
import { VoiceFormWizard, type WizardField } from "@/components/voice/VoiceFormWizard";

export const Route = createFileRoute("/_authenticated/collaboratori")({
  component: Collabs,
});

const COLLAB_WIZARD: WizardField[] = [
  { key: "name", label: "Nome collaboratore" },
  { key: "email", label: "Email", type: "email", hint: "Di chiocciola per @ e punto per ." },
  { key: "password", label: "Password iniziale" },
];


const ALL_PERMS = [
  { v: "manage_members", l: "Gestione soci" },
  { v: "manage_products", l: "Gestione prodotti" },
  { v: "use_cash", l: "Usa cassa" },
  { v: "view_reports", l: "Vede report" },
  { v: "manage_collaborators", l: "Gestione collaboratori" },
] as const;

function Collabs() {
  const { isAdmin, loading } = useAuth();
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [perms, setPerms] = useState<string[]>(["use_cash"]);
  const [wizardOpen, setWizardOpen] = useState(false);

  function setWizardField(k: string, v: string) {
    if (k === "name") setName(v);
    else if (k === "email") setEmail(v);
    else if (k === "password") setPassword(v);
  }

  const { data: collabs } = useQuery({
    queryKey: ["collabs"],
    enabled: isAdmin,
    queryFn: async () => {
      const { data: roles, error } = await supabase.from("user_roles").select("id, user_id, role, permissions, created_at");
      if (error) throw error;
      const ids = roles!.map(r => r.user_id);
      const { data: profs } = await supabase.from("profiles").select("id, full_name").in("id", ids);
      return roles!.map(r => ({ ...r, profile: profs?.find(p => p.id === r.user_id) }));
    },
  });

  if (loading) return <MeduzaLayout><div className="text-muted-foreground">...</div></MeduzaLayout>;
  if (!isAdmin) return <Navigate to="/dashboard" replace />;

  async function createCollab() {
    if (!email || !password) return toast.error("Email e password obbligatorie");
    try {
      const { data, error } = await supabase.auth.signUp({
        email, password,
        options: { data: { full_name: name } },
      });
      if (error) throw error;
      const userId = data.user?.id;
      if (!userId) throw new Error("Errore creazione utente");
      // The trigger created an admin only if it's the first user. Otherwise no role.
      // Insert collaborator role explicitly:
      const { error: e2 } = await supabase.from("user_roles").upsert({
        user_id: userId,
        role: "collaborator",
        permissions: perms as any,
      }, { onConflict: "user_id,role" });
      if (e2) throw e2;
      toast.success("Collaboratore creato");
      setAdding(false); setEmail(""); setPassword(""); setName(""); setPerms(["use_cash"]);
      qc.invalidateQueries({ queryKey: ["collabs"] });
    } catch (e: any) {
      toast.error(e.message);
    }
  }

  async function updatePerms(id: string, current: string[], perm: string) {
    const next = current.includes(perm) ? current.filter(p => p !== perm) : [...current, perm];
    const { error } = await supabase.from("user_roles").update({ permissions: next as any }).eq("id", id);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["collabs"] });
  }

  return (
    <MeduzaLayout title="Collaboratori">
      <button onClick={() => setAdding(!adding)} className="bg-gradient-gold text-primary-foreground px-5 py-2.5 rounded-md font-display uppercase tracking-widest text-xs flex items-center gap-2 mb-6">
        <UserPlus className="w-4 h-4" /> Nuovo collaboratore
      </button>

      {adding && (
        <div className="bg-card/80 border border-gold/40 rounded-lg p-5 mb-6 space-y-4">
          <div className="grid md:grid-cols-3 gap-3">
            <Inp label="Nome" value={name} onChange={setName} />
            <Inp label="Email" type="email" value={email} onChange={setEmail} />
            <Inp label="Password iniziale" type="text" value={password} onChange={setPassword} />
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-[0.3em] text-gold-muted mb-2">Permessi</div>
            <div className="flex flex-wrap gap-2">
              {ALL_PERMS.map(p => (
                <button key={p.v} type="button" onClick={()=>setPerms(perms.includes(p.v) ? perms.filter(x=>x!==p.v) : [...perms, p.v])}
                  className={`px-3 py-1.5 rounded-full text-xs uppercase tracking-wider border transition ${perms.includes(p.v) ? "bg-gold/20 border-gold text-gold" : "border-border text-muted-foreground hover:border-gold/50"}`}>
                  {p.l}
                </button>
              ))}
            </div>
          </div>
          <div className="flex gap-2 pt-2">
            <button onClick={createCollab} className="bg-gradient-gold text-primary-foreground px-5 py-2 rounded-md text-xs uppercase tracking-widest">Crea</button>
            <button onClick={()=>setAdding(false)} className="border border-border text-muted-foreground px-5 py-2 rounded-md text-xs uppercase tracking-widest">Annulla</button>
          </div>
        </div>
      )}

      <div className="grid gap-3">
        {(collabs ?? []).map(c => (
          <div key={c.user_id} className="bg-card/60 border border-gold/20 rounded-lg p-5">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-3">
                {c.role === "admin" ? <ShieldCheck className="w-5 h-5 text-gold" /> : <Shield className="w-5 h-5 text-gold-muted" />}
                <div>
                  <div className="font-display text-gold tracking-wider">{c.profile?.full_name ?? "—"}</div>
                  <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{c.role}</div>
                </div>
              </div>
            </div>
            {c.role !== "admin" && (
              <div className="flex flex-wrap gap-2">
                {ALL_PERMS.map(p => {
                  const has = (c.permissions ?? []).includes(p.v as any);
                  return (
                    <button key={p.v} onClick={()=>updatePerms(c.id, (c.permissions ?? []) as string[], p.v)}
                      className={`px-3 py-1 rounded-full text-[10px] uppercase tracking-wider border transition ${has ? "bg-gold/20 border-gold text-gold" : "border-border text-muted-foreground hover:border-gold/50"}`}>
                      {p.l}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        ))}
      </div>
    </MeduzaLayout>
  );
}

function Inp({ label, value, onChange, type="text" }: { label: string; value: string; onChange: (v: string) => void; type?: string }) {
  return (
    <label className="block">
      <span className="block text-[10px] uppercase tracking-[0.3em] text-gold-muted mb-1.5">{label}</span>
      <input type={type} value={value} onChange={(e)=>onChange(e.target.value)}
        className="w-full bg-input border border-border rounded-md px-3 py-2 text-sm focus:border-gold outline-none" />
    </label>
  );
}
