import { createFileRoute, Link } from "@tanstack/react-router";
import { MeduzaLayout } from "@/components/MeduzaLayout";
import { UserPlus, ScanLine, List } from "lucide-react";

export const Route = createFileRoute("/_authenticated/soci/")({
  component: SociMenu,
});

function SociMenu() {
  return (
    <MeduzaLayout title="Soci">
      <div className="grid md:grid-cols-2 gap-5 max-w-3xl">
        <Link
          to="/soci/nuovo"
          className="group bg-card/60 border border-gold/30 rounded-lg p-8 hover:border-gold hover:bg-card/80 transition flex flex-col items-center text-center"
        >
          <div className="w-16 h-16 rounded-full border border-gold/50 flex items-center justify-center mb-4 group-hover:bg-gold/10">
            <UserPlus className="w-7 h-7 text-gold" />
          </div>
          <div className="font-display text-xl text-gradient-gold tracking-widest uppercase">Crea socio</div>
          <p className="text-xs text-muted-foreground mt-3 leading-relaxed">
            Registra un nuovo socio con anagrafica, documento e foto. Verrà generato automaticamente il QR personale.
          </p>
        </Link>

        <Link
          to="/soci/gestisci"
          className="group bg-card/60 border border-gold/30 rounded-lg p-8 hover:border-gold hover:bg-card/80 transition flex flex-col items-center text-center"
        >
          <div className="w-16 h-16 rounded-full border border-gold/50 flex items-center justify-center mb-4 group-hover:bg-gold/10">
            <ScanLine className="w-7 h-7 text-gold" />
          </div>
          <div className="font-display text-xl text-gradient-gold tracking-widest uppercase">Gestisci socio</div>
          <p className="text-xs text-muted-foreground mt-3 leading-relaxed">
            Scansiona il QR del socio per aprire la sua schermata personale e registrare ordini di prodotti.
          </p>
        </Link>
      </div>

      <div className="mt-8">
        <Link to="/soci/elenco" className="inline-flex items-center gap-2 text-gold-muted hover:text-gold text-xs uppercase tracking-widest">
          <List className="w-3 h-3" /> Elenco completo soci
        </Link>
      </div>
    </MeduzaLayout>
  );
}
