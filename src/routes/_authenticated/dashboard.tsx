import { createFileRoute, Link } from "@tanstack/react-router";
import { MeduzaLayout } from "@/components/MeduzaLayout";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Users, Package, Euro, ScanLine } from "lucide-react";

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: Dashboard,
});

function Dashboard() {
  const { user, access } = useAuth();

  const { data: stats } = useQuery({
    queryKey: ["dashboard-stats"],
    queryFn: async () => {
      const today = new Date(); today.setHours(0,0,0,0);
      const [m, p, s] = await Promise.all([
        supabase.from("members").select("*", { count: "exact", head: true }),
        supabase.from("products").select("*", { count: "exact", head: true }).eq("active", true),
        supabase.from("sales").select("total, created_at").gte("created_at", today.toISOString()),
      ]);
      const totalToday = (s.data ?? []).reduce((a, r) => a + Number(r.total || 0), 0);
      return {
        members: m.count ?? 0,
        products: p.count ?? 0,
        salesToday: s.data?.length ?? 0,
        revenueToday: totalToday,
      };
    },
  });

  return (
    <MeduzaLayout>
      <div className="text-center mb-12">
        <div className="text-xs uppercase tracking-[0.5em] text-gold-muted">Benvenuto</div>
        <h1 className="font-display text-4xl md:text-5xl text-gradient-gold tracking-[0.3em] mt-2">
          MEDUZA XXIII
        </h1>
        <div className="mt-3 text-sm text-muted-foreground">
          {user?.email} · <span className="text-gold uppercase tracking-wider text-xs">{access.role}</span>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={Users} label="Soci totali" value={stats?.members ?? "—"} to="/soci" />
        <StatCard icon={Package} label="Prodotti attivi" value={stats?.products ?? "—"} to="/prodotti" />
        <StatCard icon={ScanLine} label="Vendite oggi" value={stats?.salesToday ?? "—"} to="/cassa" />
        <StatCard icon={Euro} label="Incasso oggi" value={`€ ${(stats?.revenueToday ?? 0).toFixed(2)}`} to="/cassa" />
      </div>

      <div className="mt-12 grid md:grid-cols-2 gap-4">
        <Link to="/soci/nuovo" className="group bg-card/60 border border-gold/30 rounded-lg p-6 hover:border-gold transition-all hover:shadow-[0_0_30px_-10px_oklch(0.72_0.13_80_/_0.5)]">
          <div className="font-display text-xl text-gold uppercase tracking-widest">+ Nuovo Socio</div>
          <p className="text-sm text-muted-foreground mt-2">Registra un nuovo socio e genera la sua chiave QR.</p>
        </Link>
        <Link to="/cassa" className="group bg-card/60 border border-gold/30 rounded-lg p-6 hover:border-gold transition-all hover:shadow-[0_0_30px_-10px_oklch(0.72_0.13_80_/_0.5)]">
          <div className="font-display text-xl text-gold uppercase tracking-widest">Apri Cassa</div>
          <p className="text-sm text-muted-foreground mt-2">Scansiona QR del socio e registra una vendita.</p>
        </Link>
      </div>
    </MeduzaLayout>
  );
}

function StatCard({ icon: Icon, label, value, to }: any) {
  return (
    <Link to={to} className="bg-card/60 backdrop-blur border border-gold/20 rounded-lg p-5 hover:border-gold/60 transition">
      <Icon className="w-5 h-5 text-gold mb-3" />
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="font-display text-2xl text-gradient-gold mt-1">{value}</div>
    </Link>
  );
}
