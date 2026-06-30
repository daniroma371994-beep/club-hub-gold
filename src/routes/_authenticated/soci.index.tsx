import { createFileRoute, Link } from "@tanstack/react-router";
import { SnoopLayout } from "@/components/SnoopLayout";
import { UserPlus, Users, ShieldCheck } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";

export const Route = createFileRoute("/_authenticated/soci/")({
  component: SociMenu,
});

function Tile({ to, icon: Icon, title, text }: any) {
  return (
    <Link
      to={to}
      className="group bg-card/60 border border-neon/25 rounded-2xl p-8 hover:border-neon hover:bg-card/80 hover:glow-neon-soft transition flex flex-col items-center text-center"
    >
      <div className="w-16 h-16 rounded-full border border-neon/50 flex items-center justify-center mb-4 group-hover:bg-neon/10 group-hover:glow-neon-soft transition">
        <Icon className="w-7 h-7 text-neon" />
      </div>
      <div className="font-display text-xl text-foreground tracking-tight">{title}</div>
      <p className="text-xs text-muted-foreground mt-3 leading-relaxed">{text}</p>
    </Link>
  );
}

function SociMenu() {
  const { isAdmin } = useAuth();
  return (
    <SnoopLayout title="Socios" subtitle="Crea un socio nuevo, gestiona los existentes o tus colaboradores">
      <div className="grid md:grid-cols-3 gap-5 max-w-4xl">
        <Tile to="/soci/nuovo" icon={UserPlus} title="Crear socio" text="Registra un nuevo socio con datos, foto del DNI y firma." />
        <Tile to="/soci/gestisci" icon={Users} title="Gestionar socios" text="Busca un socio, renueva, edita o haz un pedido." />
        {isAdmin && (
          <Tile to="/soci/colaboratori" icon={ShieldCheck} title="Colaboradores" text="Crea colaboradores y define qué pueden hacer." />
        )}
      </div>
    </SnoopLayout>
  );
}

