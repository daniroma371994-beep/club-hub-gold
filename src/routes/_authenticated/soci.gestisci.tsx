import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { SnoopLayout } from "@/components/SnoopLayout";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Search, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { expiryBadge } from "@/lib/snoop";

export const Route = createFileRoute("/_authenticated/soci/gestisci")({
  component: GestisciSoci,
});

type Row = {
  id: string;
  first_name: string;
  last_name: string;
  dni_number: string;
  city: string | null;
  expires_at: string;
  plan?: { name: string } | null;
};

function GestisciSoci() {
  const [rows, setRows] = useState<Row[]>([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const { data } = await supabase
      .from("members")
      .select("id, first_name, last_name, dni_number, city, expires_at, plan:membership_plans(name)")
      .order("last_name");
    setRows((data as any) ?? []);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  useEffect(() => {
    function onVoiceSearch(e: Event) {
      const detail = (e as CustomEvent).detail as { query?: string } | undefined;
      if (detail?.query !== undefined) setQ(detail.query);
    }
    window.addEventListener("snoop:search-members", onVoiceSearch as EventListener);
    return () => window.removeEventListener("snoop:search-members", onVoiceSearch as EventListener);
  }, []);

  const filtered = rows.filter((r) => {
    const query = q.trim().toLowerCase();
    if (!query) return true;
    const haystack = `${r.first_name} ${r.last_name} ${r.dni_number} ${r.city ?? ""}`.toLowerCase();
    const tokens = query.split(/\s+/).filter(Boolean);
    return tokens.every((t) => haystack.includes(t));
  });

  return (
    <SnoopLayout title="Gestionar socios" subtitle={`${rows.length} socio${rows.length === 1 ? "" : "s"} registrado${rows.length === 1 ? "" : "s"}`}>
      <div className="flex flex-col md:flex-row gap-3 mb-6">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neon-dim" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar por nombre, apellido o DNI..."
            className="w-full bg-input border border-border rounded-lg pl-10 pr-3 py-2.5 text-sm focus:border-neon focus:ring-2 focus:ring-neon/20 outline-none transition"
          />
        </div>
        <Link to="/soci/nuovo" className="flex items-center justify-center gap-2 px-5 py-2.5 bg-gradient-neon text-primary-foreground rounded-lg font-display font-semibold uppercase tracking-[0.2em] text-xs glow-neon">
          <UserPlus className="w-4 h-4" /> Crear socio
        </Link>
      </div>

      {loading ? (
        <div className="text-muted-foreground text-sm">Cargando...</div>
      ) : filtered.length === 0 ? (
        <div className="bg-card/60 border border-border rounded-2xl p-12 text-center">
          <div className="text-muted-foreground">No hay socios{q && " que coincidan"}.</div>
          {!q && (
            <Link to="/soci/nuovo" className="mt-4 inline-flex items-center gap-2 text-neon hover:text-glow-neon text-sm uppercase tracking-widest">
              <UserPlus className="w-4 h-4" /> Crear el primero
            </Link>
          )}
        </div>
      ) : (
        <div className="grid gap-3">
          {filtered.map((r) => {
            const badge = expiryBadge(r.expires_at);
            return (
              <Link
                key={r.id}
                to="/soci/$id"
                params={{ id: r.id }}
                className="flex items-center gap-4 bg-card/60 hover:bg-card border border-border hover:border-neon/50 rounded-xl p-4 transition group"
              >
                <div className="w-11 h-11 rounded-full bg-neon/10 border border-neon/30 flex items-center justify-center font-display text-neon">
                  {r.first_name[0]?.toUpperCase()}{r.last_name[0]?.toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-display text-foreground truncate">{r.first_name} {r.last_name}</div>
                  <div className="text-xs text-muted-foreground truncate">
                    {r.dni_number}{r.city && ` · ${r.city}`}{r.plan?.name && ` · ${r.plan.name}`}
                  </div>
                </div>
                <span className={`shrink-0 text-[10px] uppercase tracking-widest px-2.5 py-1 rounded-full border ${badge.color}`}>
                  {badge.label}
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </SnoopLayout>
  );
}
