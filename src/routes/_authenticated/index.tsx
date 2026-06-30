import { createFileRoute, Link } from "@tanstack/react-router";
import { SnoopLayout } from "@/components/SnoopLayout";
import fallbackLogo from "@/assets/meduza-xxiii-logo.png.asset.json";
import { Package, BadgeEuro, Users } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";

export const Route = createFileRoute("/_authenticated/")({
  component: Home,
});

function Home() {
  const { access, isAdmin } = useAuth();
  const clubName = access.clubName ?? "Meduza XXIII";
  const logo = access.clubLogo ?? fallbackLogo.url;

  return (
    <SnoopLayout>
      <div className="flex flex-col items-center justify-center text-center py-4">
        <h1 className="font-display text-3xl md:text-5xl tracking-[0.25em] text-neon text-glow-neon uppercase">
          Welcome
        </h1>
        <h2 className="mt-2 font-display text-2xl md:text-4xl tracking-[0.35em] text-foreground uppercase">
          {clubName}
        </h2>
        <div className="mt-4 h-[2px] w-24 bg-gradient-neon rounded-full glow-neon-soft" />

        <img
          src={logo}
          alt={clubName}
          className="mt-8 w-[min(70vw,380px)] aspect-square object-contain rounded-full glow-neon-soft"
        />

        <div className="mt-10 grid grid-cols-2 gap-3 w-full max-w-sm">
          <Link
            to="/soci"
            className="flex flex-col items-center gap-2 px-4 py-5 rounded-xl border border-neon/40 bg-card/60 backdrop-blur text-neon hover:bg-neon/10 transition"
          >
            <Users className="w-6 h-6" />
            <span className="text-xs uppercase tracking-[0.25em] font-display">Socios</span>
          </Link>
          <Link
            to="/productos"
            className="flex flex-col items-center gap-2 px-4 py-5 rounded-xl border border-neon/40 bg-card/60 backdrop-blur text-neon hover:bg-neon/10 transition"
          >
            <Package className="w-6 h-6" />
            <span className="text-xs uppercase tracking-[0.25em] font-display">Productos</span>
          </Link>
          {isAdmin && (
            <Link
              to="/piani"
              className="col-span-2 flex flex-col items-center gap-2 px-4 py-5 rounded-xl border border-neon/40 bg-card/60 backdrop-blur text-neon hover:bg-neon/10 transition"
            >
              <BadgeEuro className="w-6 h-6" />
              <span className="text-xs uppercase tracking-[0.25em] font-display">Cuotas</span>
            </Link>
          )}
        </div>

        <p className="mt-8 text-[11px] uppercase tracking-[0.3em] text-neon-dim">
          Pulsa el menú ☰ para navegar
        </p>
      </div>
    </SnoopLayout>
  );
}

