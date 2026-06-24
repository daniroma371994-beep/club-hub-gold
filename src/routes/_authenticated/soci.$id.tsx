import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { SnoopLayout } from "@/components/SnoopLayout";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { ArrowLeft, RefreshCw, Trash2, FileCheck, ShoppingBag } from "lucide-react";
import { expiryBadge, formatPrice, signedUrl } from "@/lib/snoop";
import { useAuth } from "@/hooks/useAuth";

export const Route = createFileRoute("/_authenticated/soci/$id")({
  component: SocioDetail,
});

type Plan = { id: string; name: string; duration_days: number; price_cents: number };
type Member = {
  id: string;
  first_name: string;
  last_name: string;
  birth_date: string;
  city: string | null;
  phone: string | null;
  dni_number: string;
  dni_photo_path: string | null;
  signature_path: string | null;
  contract_signed_at: string | null;
  contract_version: string;
  joined_at: string;
  expires_at: string;
  plan_id: string | null;
};

function SocioDetail() {
  const { id } = Route.useParams();
  const nav = useNavigate();
  const { isAdmin } = useAuth();
  const [member, setMember] = useState<Member | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [dniUrl, setDniUrl] = useState<string>("");
  const [sigUrl, setSigUrl] = useState<string>("");
  const [renewing, setRenewing] = useState(false);
  const [newPlanId, setNewPlanId] = useState("");

  async function load() {
    const { data: m } = await supabase.from("members").select("*").eq("id", id).maybeSingle();
    if (!m) return;
    setMember(m as any);
    setNewPlanId((m as any).plan_id ?? "");
    if ((m as any).plan_id) {
      const { data: p } = await supabase.from("membership_plans").select("*").eq("id", (m as any).plan_id).maybeSingle();
      setPlan(p as any);
    }
    if ((m as any).dni_photo_path) setDniUrl(await signedUrl((m as any).dni_photo_path).catch(() => ""));
    if ((m as any).signature_path) setSigUrl(await signedUrl((m as any).signature_path).catch(() => ""));
  }
  useEffect(() => {
    load();
    supabase.from("membership_plans").select("*").eq("active", true).order("sort_order").then(({ data }) => setPlans((data as any) ?? []));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function renew() {
    if (!newPlanId) return toast.error("Selecciona una cuota");
    setRenewing(true);
    try {
      const chosen = plans.find((p) => p.id === newPlanId)!;
      const today = new Date();
      const current = member ? new Date(member.expires_at) : today;
      const base = current > today ? current : today;
      const expires = new Date(base.getTime() + chosen.duration_days * 86400000);
      const { error } = await supabase.from("members").update({
        plan_id: chosen.id,
        expires_at: expires.toISOString().slice(0, 10),
      }).eq("id", id);
      if (error) throw error;
      toast.success("Cuota renovada");
      load();
    } catch (e: any) { toast.error(e.message); }
    finally { setRenewing(false); }
  }

  async function remove() {
    if (!confirm("¿Eliminar este socio? No se puede deshacer.")) return;
    const { error } = await supabase.from("members").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Socio eliminado");
    nav({ to: "/soci/gestisci" });
  }

  function nuevoPedido() {
    toast.info("Pedidos: próximamente disponible para " + (member?.first_name ?? "este socio"));
  }

  useEffect(() => {
    function onAction(e: Event) {
      const action = (e as CustomEvent).detail?.action;
      if (action === "order") nuevoPedido();
      else if (action === "renew") renew();
      else if (action === "delete") remove();
    }
    window.addEventListener("snoop:member-action", onAction as EventListener);
    return () => window.removeEventListener("snoop:member-action", onAction as EventListener);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [member, newPlanId, plans]);

  if (!member) {
    return <SnoopLayout title="Socio"><div className="text-muted-foreground">Cargando...</div></SnoopLayout>;
  }

  const badge = expiryBadge(member.expires_at);

  return (
    <SnoopLayout>
      <Link to="/soci/gestisci" className="inline-flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground hover:text-neon mb-6">
        <ArrowLeft className="w-4 h-4" /> Volver
      </Link>

      <div className="grid md:grid-cols-3 gap-6">
        {/* Left: identity */}
        <div className="md:col-span-2 space-y-6">
          <div className="bg-card/60 border border-neon/20 rounded-2xl p-6 backdrop-blur">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div>
                <h1 className="font-display text-3xl text-foreground">{member.first_name} {member.last_name}</h1>
                <div className="text-sm text-muted-foreground mt-1">{member.dni_number}</div>
              </div>
              <span className={`text-[10px] uppercase tracking-widest px-3 py-1.5 rounded-full border ${badge.color}`}>{badge.label}</span>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mt-6 text-sm">
              <Stat label="F. nacimiento" value={member.birth_date} />
              <Stat label="Ciudad" value={member.city ?? "—"} />
              <Stat label="Teléfono" value={member.phone ?? "—"} />
              <Stat label="Alta" value={member.joined_at} />
              <Stat label="Caducidad" value={member.expires_at} />
              <Stat label="Cuota" value={plan ? `${plan.name} · ${formatPrice(plan.price_cents)}` : "—"} />
            </div>
          </div>

          {/* DNI */}
          <div className="bg-card/60 border border-neon/20 rounded-2xl p-6">
            <div className="text-[10px] uppercase tracking-[0.3em] text-neon-dim mb-3">DNI</div>
            {dniUrl ? (
              <img src={dniUrl} alt="DNI" className="max-w-full rounded-lg border border-border" />
            ) : <div className="text-muted-foreground text-sm">Sin foto</div>}
          </div>

          {/* Contract */}
          <div className="bg-card/60 border border-neon/20 rounded-2xl p-6">
            <div className="flex items-center gap-2 mb-3">
              <FileCheck className="w-4 h-4 text-neon" />
              <div className="text-[10px] uppercase tracking-[0.3em] text-neon-dim">Contrato firmado</div>
            </div>
            {member.contract_signed_at ? (
              <>
                <div className="text-xs text-muted-foreground mb-3">
                  Firmado el {new Date(member.contract_signed_at).toLocaleString("es-ES")} · versión {member.contract_version}
                </div>
                {sigUrl && <img src={sigUrl} alt="Firma" className="max-w-xs bg-black rounded-lg border border-border" />}
              </>
            ) : <div className="text-muted-foreground text-sm">Sin firma</div>}
          </div>
        </div>

        {/* Right: actions */}
        <div className="space-y-6">
          <button
            onClick={nuevoPedido}
            className="w-full flex items-center justify-center gap-2 bg-gradient-neon text-primary-foreground py-3 rounded-xl font-display font-semibold uppercase tracking-[0.2em] text-xs glow-neon"
          >
            <ShoppingBag className="w-4 h-4" /> Hacer pedido
          </button>

          <div className="bg-card/60 border border-neon/20 rounded-2xl p-6">
            <div className="flex items-center gap-2 mb-3">
              <RefreshCw className="w-4 h-4 text-neon" />
              <div className="font-display text-sm">Renovar cuota</div>
            </div>
            <select value={newPlanId} onChange={(e) => setNewPlanId(e.target.value)}
              className="w-full bg-input border border-border rounded-md px-3 py-2 text-sm focus:border-neon outline-none">
              {plans.map((p) => (
                <option key={p.id} value={p.id}>{p.name} — {formatPrice(p.price_cents)} ({p.duration_days} d)</option>
              ))}
            </select>
            <button onClick={renew} disabled={renewing}
              className="mt-3 w-full bg-gradient-neon text-primary-foreground py-2.5 rounded-lg font-display font-semibold uppercase tracking-[0.2em] text-xs glow-neon disabled:opacity-50">
              {renewing ? "..." : "Renovar"}
            </button>
            <p className="text-[10px] text-muted-foreground mt-2 leading-relaxed">
              La nueva caducidad se suma desde hoy o desde la fecha actual de caducidad si todavía es futura.
            </p>
          </div>

          {isAdmin && (
            <button onClick={remove}
              className="w-full flex items-center justify-center gap-2 border border-destructive/40 text-destructive py-2.5 rounded-lg text-xs uppercase tracking-widest hover:bg-destructive/10">
              <Trash2 className="w-4 h-4" /> Eliminar socio
            </button>
          )}
        </div>
      </div>
    </SnoopLayout>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.25em] text-neon-dim">{label}</div>
      <div className="mt-1 text-foreground">{value}</div>
    </div>
  );
}
