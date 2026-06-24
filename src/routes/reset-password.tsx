import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import logoUrl from "@/assets/meduza-logo.png";
import { toast } from "sonner";

export const Route = createFileRoute("/reset-password")({
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const nav = useNavigate();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // Supabase places the recovery tokens in the URL hash and fires PASSWORD_RECOVERY.
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") setReady(true);
    });
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setReady(true);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 6) return toast.error("Minimo 6 caratteri");
    if (password !== confirm) return toast.error("Le password non coincidono");
    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      toast.success("Password aggiornata");
      await supabase.auth.signOut();
      nav({ to: "/auth" });
    } catch (err: any) {
      toast.error(err.message ?? "Errore");
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
          <img src={logoUrl} alt="Meduza" className="w-24 h-24 mx-auto mb-4" />
          <h1 className="font-display text-2xl text-gradient-gold tracking-[0.4em]">MEDUZA</h1>
          <div className="text-xs uppercase tracking-[0.5em] text-gold-muted mt-1">Nuova password</div>
        </div>

        <div className="bg-card/80 backdrop-blur border border-gold/30 rounded-lg p-8">
          {!ready ? (
            <p className="text-sm text-muted-foreground text-center">
              Apri questo link dall'email di recupero password.
            </p>
          ) : (
            <form onSubmit={submit} className="space-y-4">
              <label className="block">
                <span className="block text-[10px] uppercase tracking-[0.3em] text-gold-muted mb-1.5">Nuova password</span>
                <input required type="password" minLength={6} value={password} onChange={(e) => setPassword(e.target.value)}
                  className="w-full bg-input border border-border rounded-md px-3 py-2 text-sm focus:border-gold outline-none" />
              </label>
              <label className="block">
                <span className="block text-[10px] uppercase tracking-[0.3em] text-gold-muted mb-1.5">Conferma password</span>
                <input required type="password" minLength={6} value={confirm} onChange={(e) => setConfirm(e.target.value)}
                  className="w-full bg-input border border-border rounded-md px-3 py-2 text-sm focus:border-gold outline-none" />
              </label>
              <button disabled={loading}
                className="w-full mt-4 bg-gradient-gold text-primary-foreground py-3 rounded-md font-display uppercase tracking-[0.3em] text-sm disabled:opacity-50">
                {loading ? "..." : "Aggiorna password"}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
