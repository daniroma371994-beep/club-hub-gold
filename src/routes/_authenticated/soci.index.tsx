import { createFileRoute, Link } from "@tanstack/react-router";
import { SnoopLayout } from "@/components/SnoopLayout";
import { UserPlus, Users } from "lucide-react";

export const Route = createFileRoute("/_authenticated/soci/")({
  component: SociMenu,
});

function SociMenu() {
  return (
    <SnoopLayout title="Socios" subtitle="Crea un socio nuevo o gestiona los existentes">
      <div className="grid md:grid-cols-2 gap-5 max-w-3xl">
        <Link
          to="/soci/nuovo"
          className="group bg-card/60 border border-neon/25 rounded-2xl p-8 hover:border-neon hover:bg-card/80 hover:glow-neon-soft transition flex flex-col items-center text-center"
        >
          <div className="w-16 h-16 rounded-full border border-neon/50 flex items-center justify-center mb-4 group-hover:bg-neon/10 group-hover:glow-neon-soft transition">
            <UserPlus className="w-7 h-7 text-neon" />
          </div>
          <div className="font-display text-xl text-foreground tracking-tight">Crear socio</div>
          <p className="text-xs text-muted-foreground mt-3 leading-relaxed">
            Registra un nuevo socio con datos personales, foto del DNI y firma del contrato.
          </p>
        </Link>

        <Link
          to="/soci/gestisci"
          className="group bg-card/60 border border-neon/25 rounded-2xl p-8 hover:border-neon hover:bg-card/80 hover:glow-neon-soft transition flex flex-col items-center text-center"
        >
          <div className="w-16 h-16 rounded-full border border-neon/50 flex items-center justify-center mb-4 group-hover:bg-neon/10 group-hover:glow-neon-soft transition">
            <Users className="w-7 h-7 text-neon" />
          </div>
          <div className="font-display text-xl text-foreground tracking-tight">Gestionar socios</div>
          <p className="text-xs text-muted-foreground mt-3 leading-relaxed">
            Busca un socio, revisa su cuota, renueva o consulta su contrato firmado.
          </p>
        </Link>
      </div>
    </SnoopLayout>
  );
}
