import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import logoAsset from "@/assets/snoop-logo.png.asset.json";
import { toast } from "sonner";

export const Route = createFileRoute("/reset-password")({
  component: ResetPassword,
});

function ResetPassword() {
  const nav = useNavigate();
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const url = new URL(window.location.href);
        const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
        const errorDesc = hash.get("error_description") || url.searchParams.get("error_description");
        if (errorDesc) {
          setErrorMsg(decodeURIComponent(errorDesc).replace(/\+/g, " "));
          return;
        }

        // New Supabase format: ?token_hash=...&type=recovery
        const tokenHash = url.searchParams.get("token_hash");
        const type = url.searchParams.get("type");
        if (tokenHash && type === "recovery") {
          const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: "recovery" });
          if (error) { setErrorMsg(error.message); return; }
          window.history.replaceState({}, "", "/reset-password");
        }

        // PKCE flow: ?code=...
        const code = url.searchParams.get("code");
        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) { setErrorMsg(error.message); return; }
          window.history.replaceState({}, "", "/reset-password");
        }

        // Hash flow: #access_token=...&type=recovery -> client auto-handles
        const { data } = await supabase.auth.getSession();
        if (!data.session) {
          setErrorMsg("Enlace inválido o caducado. Solicita un nuevo email de recuperación.");
          return;
        }
        setReady(true);
      } catch (e: any) {
        setErrorMsg(e.message ?? "Error");
      }
    })();

    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") setReady(true);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pw !== pw2) return toast.error("Las contraseñas no coinciden");
    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: pw });
      if (error) throw error;
      toast.success("Contraseña actualizada");
      nav({ to: "/soci" });
    } catch (e: any) { toast.error(e.message); }
    finally { setLoading(false); }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 scanline">
      <div className="w-full max-w-md">
        <img src={logoAsset.url} alt="Snoop" className="w-52 mx-auto mb-8" />
        {errorMsg ? (
          <div className="bg-card/80 backdrop-blur border border-destructive/40 rounded-2xl p-8 space-y-4 text-center">
            <h2 className="font-display text-xl text-destructive">Enlace no válido</h2>
            <p className="text-sm text-muted-foreground">{errorMsg}</p>
            <button onClick={() => nav({ to: "/auth" })} className="w-full bg-gradient-neon text-primary-foreground py-3 rounded-lg font-display font-semibold uppercase tracking-[0.25em] text-sm glow-neon">
              Volver a iniciar sesión
            </button>
          </div>
        ) : (
          <form onSubmit={submit} className="bg-card/80 backdrop-blur border border-neon/30 rounded-2xl p-8 space-y-4 glow-neon-soft">
            <h2 className="font-display text-xl text-neon">Nueva contraseña</h2>
            {!ready && <p className="text-xs text-muted-foreground">Validando enlace…</p>}
            <input required type="password" minLength={6} placeholder="Nueva contraseña" value={pw} onChange={(e)=>setPw(e.target.value)}
              className="w-full bg-input border border-border rounded-md px-3 py-2 text-sm focus:border-neon outline-none" />
            <input required type="password" minLength={6} placeholder="Repite contraseña" value={pw2} onChange={(e)=>setPw2(e.target.value)}
              className="w-full bg-input border border-border rounded-md px-3 py-2 text-sm focus:border-neon outline-none" />
            <button disabled={loading || !ready} className="w-full bg-gradient-neon text-primary-foreground py-3 rounded-lg font-display font-semibold uppercase tracking-[0.25em] text-sm disabled:opacity-50 glow-neon">
              {loading ? "..." : "Actualizar"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
