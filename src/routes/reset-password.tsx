import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
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
        <form onSubmit={submit} className="bg-card/80 backdrop-blur border border-neon/30 rounded-2xl p-8 space-y-4 glow-neon-soft">
          <h2 className="font-display text-xl text-neon">Nueva contraseña</h2>
          <input required type="password" minLength={6} placeholder="Nueva contraseña" value={pw} onChange={(e)=>setPw(e.target.value)}
            className="w-full bg-input border border-border rounded-md px-3 py-2 text-sm focus:border-neon outline-none" />
          <input required type="password" minLength={6} placeholder="Repite contraseña" value={pw2} onChange={(e)=>setPw2(e.target.value)}
            className="w-full bg-input border border-border rounded-md px-3 py-2 text-sm focus:border-neon outline-none" />
          <button disabled={loading} className="w-full bg-gradient-neon text-primary-foreground py-3 rounded-lg font-display font-semibold uppercase tracking-[0.25em] text-sm disabled:opacity-50 glow-neon">
            {loading ? "..." : "Actualizar"}
          </button>
        </form>
      </div>
    </div>
  );
}
