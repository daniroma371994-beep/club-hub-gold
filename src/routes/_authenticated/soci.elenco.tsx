import { createFileRoute, Link } from "@tanstack/react-router";
import { MeduzaLayout } from "@/components/MeduzaLayout";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ArrowLeft, Plus, QrCode, Search } from "lucide-react";
import { useState } from "react";

export const Route = createFileRoute("/_authenticated/soci/elenco")({
  component: SociList,
});

function SociList() {
  const [q, setQ] = useState("");
  const { data, isLoading } = useQuery({
    queryKey: ["members"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("members")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const filtered = (data ?? []).filter((m) => {
    const s = `${m.first_name} ${m.last_name} ${m.card_number} ${m.phone ?? ""}`.toLowerCase();
    return s.includes(q.toLowerCase());
  });

  return (
    <MeduzaLayout title="Elenco Soci">
      <Link to="/soci" className="inline-flex items-center gap-2 text-gold-muted hover:text-gold text-xs uppercase tracking-widest mb-6">
        <ArrowLeft className="w-3 h-3" /> Torna a Soci
      </Link>

      <div className="flex flex-col md:flex-row gap-3 mb-6">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gold-muted" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Cerca per nome, tessera, telefono..."
            className="w-full bg-input border border-border rounded-md pl-10 pr-3 py-2.5 text-sm focus:border-gold outline-none"
          />
        </div>
        <Link to="/soci/nuovo" className="bg-gradient-gold text-primary-foreground px-5 py-2.5 rounded-md font-display uppercase tracking-widest text-xs flex items-center gap-2 justify-center">
          <Plus className="w-4 h-4" /> Nuovo socio
        </Link>
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground">Caricamento...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 border border-dashed border-gold/30 rounded-lg">
          <div className="text-gold-muted">Nessun socio trovato.</div>
          <Link to="/soci/nuovo" className="inline-block mt-4 text-gold underline text-sm">Registra il primo socio</Link>
        </div>
      ) : (
        <div className="grid gap-3">
          {filtered.map((m) => (
            <Link
              key={m.id}
              to="/soci/$id"
              params={{ id: m.id }}
              className="flex items-center gap-4 bg-card/60 border border-gold/20 rounded-lg p-4 hover:border-gold/60 transition"
            >
              {m.photo_url ? (
                <img src={m.photo_url} alt="" className="w-14 h-14 rounded-full object-cover border border-gold/40" />
              ) : (
                <div className="w-14 h-14 rounded-full bg-accent flex items-center justify-center text-gold font-display text-lg border border-gold/40">
                  {m.first_name[0]}{m.last_name[0]}
                </div>
              )}
              <div className="flex-1">
                <div className="font-display text-gold tracking-wider">{m.first_name} {m.last_name}</div>
                <div className="text-xs text-muted-foreground">Tessera N° {m.card_number} · {m.phone ?? "—"}</div>
              </div>
              <QrCode className="w-5 h-5 text-gold-muted" />
            </Link>
          ))}
        </div>
      )}
    </MeduzaLayout>
  );
}
