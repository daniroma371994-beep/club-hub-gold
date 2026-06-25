import { createFileRoute, Link } from "@tanstack/react-router";
import { SnoopLayout } from "@/components/SnoopLayout";
import logo from "@/assets/meduza-xxiii-logo.png.asset.json";

export const Route = createFileRoute("/")({
  component: Home,
});

function Home() {
  return (
    <SnoopLayout>
      <div className="flex flex-col items-center justify-center text-center py-6">
        <h1 className="font-display text-3xl md:text-5xl tracking-[0.25em] text-neon text-glow-neon uppercase">
          Welcome
        </h1>
        <h2 className="mt-2 font-display text-2xl md:text-4xl tracking-[0.35em] text-foreground uppercase">
          Meduza <span className="text-neon">XXIII</span>
        </h2>
        <div className="mt-4 h-[2px] w-24 bg-gradient-neon rounded-full glow-neon-soft" />

        <img
          src={logo.url}
          alt="Meduza XXIII"
          className="mt-8 w-[min(80vw,480px)] aspect-square object-contain rounded-full glow-neon-soft"
        />

        <Link
          to="/soci"
          className="mt-10 inline-block px-8 py-3 bg-gradient-neon text-primary-foreground rounded-md uppercase tracking-[0.3em] text-xs font-display"
        >
          Entrar
        </Link>
      </div>
    </SnoopLayout>
  );
}
