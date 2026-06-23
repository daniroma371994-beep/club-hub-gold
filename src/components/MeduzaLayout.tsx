import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { Users, Package, ScanLine, ShieldCheck, LogOut, LayoutDashboard, UserCog, BadgeEuro, MoreVertical, X } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import logoUrl from "@/assets/meduza-logo.png";
import { cn } from "@/lib/utils";
import { useState, type ReactNode } from "react";
import { VoiceAssistant } from "@/components/voice/VoiceAssistant";

const NAV = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard, perm: null, adminOnly: false },
  { to: "/soci", label: "Soci", icon: Users, perm: "manage_members" as const, adminOnly: false },
  { to: "/piani", label: "Quote", icon: BadgeEuro, perm: null, adminOnly: true },
  { to: "/prodotti", label: "Prodotti", icon: Package, perm: "manage_products" as const, adminOnly: false },
  { to: "/cassa", label: "Cassa", icon: ScanLine, perm: "use_cash" as const, adminOnly: false },
  { to: "/collaboratori", label: "Collaboratori", icon: UserCog, perm: "manage_collaborators" as const, adminOnly: false },
];

export function MeduzaLayout({ children, title }: { children: ReactNode; title?: string }) {
  const { user, access, can, isAdmin } = useAuth();
  const nav = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const visible = NAV.filter((n) => (n.adminOnly ? isAdmin : !n.perm || isAdmin || can(n.perm)));

  async function signOut() {
    await supabase.auth.signOut();
    setMobileMenuOpen(false);
    nav({ to: "/auth" });
  }

  return (
    <div className="relative min-h-screen flex">
      {/* Background logo watermark */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 flex items-center justify-center overflow-hidden"
      >
        <img
          src={logoUrl}
          alt=""
          className="w-[min(120vh,120vw)] max-w-none opacity-[0.06] select-none"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-background/40 via-background/10 to-background" />
      </div>

      {/* Sidebar */}
      <aside className="relative z-10 hidden md:flex w-64 flex-col border-r border-gold/30 bg-card/70 backdrop-blur-sm">
        <div className="px-6 py-6 border-b border-gold/20 flex flex-col items-center text-center">
          <img src={logoUrl} alt="Meduza" className="w-20 h-20 object-contain" />
          <div className="mt-2 font-display text-lg text-gradient-gold tracking-[0.3em]">MEDUZA</div>
          <div className="text-[10px] uppercase tracking-[0.4em] text-gold-muted">XXIII Club</div>
        </div>

        <nav className="flex-1 px-3 py-6 space-y-1">
          {visible.map((item) => {
            const Icon = item.icon;
            const active = pathname === item.to || pathname.startsWith(item.to + "/");
            return (
              <Link
                key={item.to}
                to={item.to}
                className={cn(
                  "flex items-center gap-3 px-4 py-3 rounded-md text-sm transition-all",
                  "hover:bg-accent/50 hover:text-gold",
                  active
                    ? "bg-gradient-to-r from-gold/20 to-transparent text-gold border-l-2 border-gold"
                    : "text-muted-foreground border-l-2 border-transparent",
                )}
              >
                <Icon className="w-4 h-4" />
                <span className="font-display tracking-wider uppercase text-xs">{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="p-4 border-t border-gold/20">
          <div className="text-xs text-muted-foreground mb-2 truncate">{user?.email}</div>
          <div className="text-[10px] uppercase tracking-widest text-gold-muted mb-3 flex items-center gap-1">
            <ShieldCheck className="w-3 h-3" /> {access.role ?? "—"}
          </div>
          <button
            onClick={signOut}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-xs text-muted-foreground hover:text-gold hover:bg-accent/50 transition"
          >
            <LogOut className="w-3 h-3" /> Esci
          </button>
        </div>
      </aside>

      {/* Mobile top bar */}
      <header className="md:hidden fixed top-0 inset-x-0 z-30 flex items-center justify-between px-4 h-14 bg-card/95 backdrop-blur border-b border-gold/30">
        <div className="flex items-center gap-2">
          <img src={logoUrl} alt="" className="w-8 h-8" />
          <span className="font-display tracking-[0.3em] text-gold text-sm">MEDUZA</span>
        </div>
        <button
          type="button"
          onClick={() => setMobileMenuOpen((open) => !open)}
          className="h-10 w-10 rounded-full border border-gold/40 bg-input/70 text-gold flex items-center justify-center"
          aria-label={mobileMenuOpen ? "Chiudi menu" : "Apri menu"}
        >
          {mobileMenuOpen ? <X className="w-5 h-5" /> : <MoreVertical className="w-5 h-5" />}
        </button>
      </header>

      {mobileMenuOpen && (
        <div className="md:hidden fixed inset-x-3 top-16 z-30 rounded-2xl border border-gold/40 bg-card/95 backdrop-blur-xl shadow-2xl overflow-hidden">
          <div className="px-4 py-3 border-b border-gold/20">
            <div className="text-[10px] uppercase tracking-[0.35em] text-gold-muted">Menu club</div>
            <div className="text-xs text-muted-foreground truncate mt-1">{user?.email}</div>
          </div>
          <nav className="p-2 grid gap-1">
            {visible.map((item) => {
              const Icon = item.icon;
              const active = pathname === item.to || pathname.startsWith(item.to + "/");
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  onClick={() => setMobileMenuOpen(false)}
                  className={cn(
                    "flex items-center gap-3 rounded-xl px-4 py-3 text-sm transition-all",
                    active ? "bg-gold/15 text-gold border border-gold/30" : "text-muted-foreground border border-transparent hover:bg-accent/50 hover:text-gold",
                  )}
                >
                  <Icon className="w-5 h-5" />
                  <span className="font-display uppercase tracking-[0.2em] text-xs">{item.label}</span>
                </Link>
              );
            })}
          </nav>
          <div className="p-3 border-t border-gold/20 flex items-center justify-between gap-3">
            <div className="text-[10px] uppercase tracking-widest text-gold-muted flex items-center gap-1 truncate">
              <ShieldCheck className="w-3 h-3" /> {access.role ?? "—"}
            </div>
            <button
              type="button"
              onClick={signOut}
              className="flex items-center gap-2 px-3 py-2 rounded-md text-xs text-muted-foreground hover:text-gold hover:bg-accent/50 transition uppercase tracking-widest"
            >
              <LogOut className="w-3 h-3" /> Esci
            </button>
          </div>
        </div>
      )}

      {/* Main */}
      <main className="relative z-10 flex-1 min-h-screen pt-14 md:pt-0 pb-6 md:pb-0">
        <div className="max-w-6xl mx-auto px-4 md:px-10 py-8">
          {title && (
            <div className="mb-8">
              <h1 className="font-display text-3xl md:text-4xl text-gradient-gold tracking-widest uppercase">
                {title}
              </h1>
              <div className="mt-2 h-px w-24 bg-gradient-gold" />
            </div>
          )}
          {children}
        </div>
      </main>

      <VoiceAssistant />
    </div>
  );
}
