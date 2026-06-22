import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import logoUrl from "@/assets/meduza-logo.png";
import { toast } from "sonner";

export const Route = createFileRoute("/auth")({
  component: AuthPage,
});

function AuthPage() {
  const nav = useNavigate();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) nav({ to: "/dashboard" });
    });
  }, [nav]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { full_name: name }, emailRedirectTo: window.location.origin },
        });
        if (error) throw error;
        toast.success("Account creato. Accesso in corso...");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
      nav({ to: "/dashboard" });
    } catch (err: any) {
      toast.error(err.message ?? "Errore di accesso");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative min-h-screen flex items-center justify-center px-4 overflow-hidden">
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <img src={logoUrl} alt="" className="w-[min(110vh,110vw)] opacity-[0.08]" />
        <div className="absolute inset-0 bg-gradient-to-b from-background/30 to-background/80" />
      </div>

      <div className="relative z-10 w-full max-w-md">
        <div className="text-center mb-8">
          <img src={logoUrl} alt="Meduza" className="w-28 h-28 mx-auto mb-4" />
          <h1 className="font-display text-3xl text-gradient-gold tracking-[0.4em]">MEDUZA</h1>
          <div className="text-xs uppercase tracking-[0.5em] text-gold-muted mt-1">XXIII · Club</div>
        </div>

        <div className="bg-card/80 backdrop-blur border border-gold/30 rounded-lg p-8 shadow-[0_8px_32px_-8px_rgba(0,0,0,0.6)]">
          <div className="flex gap-2 mb-6">
            <button
              onClick={() => setMode("signin")}
              className={`flex-1 py-2 text-xs uppercase tracking-widest font-display transition ${mode === "signin" ? "text-gold border-b border-gold" : "text-muted-foreground"}`}
            >Accedi</button>
            <button
              onClick={() => setMode("signup")}
              className={`flex-1 py-2 text-xs uppercase tracking-widest font-display transition ${mode === "signup" ? "text-gold border-b border-gold" : "text-muted-foreground"}`}
            >Registrati</button>
          </div>

          <form onSubmit={submit} className="space-y-4">
            {mode === "signup" && (
              <Field label="Nome completo">
                <input required value={name} onChange={(e) => setName(e.target.value)} className="auth-input" />
              </Field>
            )}
            <Field label="Email">
              <input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="auth-input" />
            </Field>
            <Field label="Password">
              <input required type="password" minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} className="auth-input" />
            </Field>

            <button
              disabled={loading}
              className="w-full mt-4 bg-gradient-gold text-primary-foreground py-3 rounded-md font-display uppercase tracking-[0.3em] text-sm hover:opacity-90 disabled:opacity-50 transition"
            >
              {loading ? "..." : mode === "signin" ? "Entra" : "Crea account"}
            </button>
          </form>

          <p className="text-[10px] text-muted-foreground text-center mt-6 leading-relaxed">
            Il primo account registrato diventa <span className="text-gold">Amministratore</span>.<br />
            Gli account successivi devono essere abilitati dall'admin.
          </p>
        </div>
      </div>

      <style>{`
        .auth-input {
          width: 100%;
          background: oklch(0.1 0.005 80);
          border: 1px solid oklch(0.3 0.04 80 / 0.5);
          color: oklch(0.92 0.04 80);
          padding: 0.6rem 0.9rem;
          border-radius: 6px;
          font-family: var(--font-body);
          outline: none;
          transition: all 0.2s;
        }
        .auth-input:focus {
          border-color: var(--color-gold);
          box-shadow: 0 0 0 2px oklch(0.72 0.13 80 / 0.2);
        }
      `}</style>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[10px] uppercase tracking-[0.3em] text-gold-muted mb-1.5">{label}</span>
      {children}
    </label>
  );
}
