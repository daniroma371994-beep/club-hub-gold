import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { SnoopLayout } from "@/components/SnoopLayout";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, Camera, Check, Loader2 } from "lucide-react";
import { CONTRACT_TEXT_ES, CONTRACT_VERSION, compressImage, formatPrice, uploadToSnoopDocs } from "@/lib/snoop";
import { SignaturePad, type SignaturePadHandle } from "@/components/SignaturePad";

export const Route = createFileRoute("/_authenticated/soci/nuovo")({
  component: NewSocio,
});

type Plan = { id: string; name: string; duration_days: number; price_cents: number };

const STEPS = ["Datos", "Contacto", "Cuota", "DNI", "Contrato"] as const;

function NewSocio() {
  const nav = useNavigate();
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [plans, setPlans] = useState<Plan[]>([]);
  const sigRef = useRef<SignaturePadHandle>(null);

  const [form, setForm] = useState({
    first_name: "",
    last_name: "",
    birth_date: "",
    city: "",
    phone: "",
    plan_id: "",
    dni_number: "",
    dni_file: null as File | null,
    dni_preview: "" as string,
    contract_read: false,
  });

  useEffect(() => {
    supabase.from("membership_plans").select("id,name,duration_days,price_cents").eq("active", true).order("sort_order")
      .then(({ data }) => setPlans((data as any) ?? []));
  }, []);

  function set<K extends keyof typeof form>(k: K, v: typeof form[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  const selectedPlan = plans.find((p) => p.id === form.plan_id);

  function validateStep(): string | null {
    if (step === 0) {
      if (!form.first_name.trim()) return "Falta el nombre";
      if (!form.last_name.trim()) return "Falta el apellido";
      if (!form.birth_date) return "Falta la fecha de nacimiento";
      const age = (Date.now() - new Date(form.birth_date).getTime()) / (1000 * 60 * 60 * 24 * 365.25);
      if (age < 18) return "El socio debe ser mayor de edad";
    }
    if (step === 1) {
      if (!form.city.trim()) return "Falta la ciudad";
      if (!form.phone.trim()) return "Falta el teléfono";
    }
    if (step === 2 && !form.plan_id) return "Selecciona una cuota";
    if (step === 3) {
      if (!form.dni_number.trim()) return "Falta el número de DNI";
      if (!form.dni_file) return "Falta la foto del DNI";
    }
    return null;
  }

  function next() {
    const err = validateStep();
    if (err) return toast.error(err);
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  }
  function back() { setStep((s) => Math.max(s - 1, 0)); }

  async function handleDniFile(file: File) {
    try {
      const blob = await compressImage(file, 1600, 0.85);
      set("dni_file", new File([blob], "dni.jpg", { type: "image/jpeg" }));
      const reader = new FileReader();
      reader.onload = () => set("dni_preview", reader.result as string);
      reader.readAsDataURL(blob);
    } catch (e: any) {
      toast.error("Error procesando la imagen: " + e.message);
    }
  }

  async function submit() {
    if (!form.contract_read) return toast.error("Lee el contrato antes de firmar");
    if (sigRef.current?.isEmpty()) return toast.error("Falta la firma del socio");
    if (!selectedPlan) return toast.error("Sin cuota seleccionada");

    setSaving(true);
    try {
      const { data: user } = await supabase.auth.getUser();
      const memberId = crypto.randomUUID();
      const dniPath = `members/${memberId}/dni.jpg`;
      const sigPath = `members/${memberId}/signature.png`;

      // Upload DNI
      await uploadToSnoopDocs(form.dni_file!, dniPath);

      // Upload signature
      const sigBlob = await sigRef.current!.toBlob();
      if (!sigBlob) throw new Error("Firma vacía");
      await uploadToSnoopDocs(sigBlob, sigPath);

      const joined = new Date();
      const expires = new Date(joined.getTime() + selectedPlan.duration_days * 86400000);

      const { error } = await supabase.from("members").insert({
        id: memberId,
        first_name: form.first_name.trim(),
        last_name: form.last_name.trim(),
        birth_date: form.birth_date,
        city: form.city.trim(),
        phone: form.phone.trim(),
        dni_number: form.dni_number.trim().toUpperCase(),
        dni_photo_path: dniPath,
        plan_id: form.plan_id,
        joined_at: joined.toISOString().slice(0, 10),
        expires_at: expires.toISOString().slice(0, 10),
        signature_path: sigPath,
        contract_signed_at: new Date().toISOString(),
        contract_version: CONTRACT_VERSION,
        created_by: user.user?.id ?? null,
      });
      if (error) throw error;

      toast.success("Socio creado correctamente");
      nav({ to: "/soci/gestisci" });
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <SnoopLayout title="Nuevo socio" subtitle={STEPS[step]}>
      {/* Progress */}
      <div className="max-w-3xl mb-8">
        <div className="flex items-center gap-1 mb-2">
          {STEPS.map((label, i) => (
            <div key={label} className="flex-1 flex flex-col items-center">
              <div className={`w-full h-[3px] rounded-full transition ${i <= step ? "bg-neon glow-neon-soft" : "bg-border"}`} />
              <div className={`mt-2 text-[10px] uppercase tracking-[0.2em] ${i === step ? "text-neon" : "text-muted-foreground"}`}>{label}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-card/60 border border-neon/20 rounded-2xl p-6 md:p-8 max-w-3xl backdrop-blur">
        {step === 0 && (
          <div className="grid md:grid-cols-2 gap-4">
            <Inp label="Nombre *" value={form.first_name} onChange={(v) => set("first_name", v)} />
            <Inp label="Apellidos *" value={form.last_name} onChange={(v) => set("last_name", v)} />
            <Inp label="Fecha de nacimiento *" type="date" value={form.birth_date} onChange={(v) => set("birth_date", v)} className="md:col-span-2" />
          </div>
        )}

        {step === 1 && (
          <div className="grid md:grid-cols-2 gap-4">
            <Inp label="Ciudad *" value={form.city} onChange={(v) => set("city", v)} />
            <Inp label="Teléfono *" type="tel" value={form.phone} onChange={(v) => set("phone", v)} />
          </div>
        )}

        {step === 2 && (
          <div className="grid sm:grid-cols-3 gap-4">
            {plans.length === 0 && <div className="text-muted-foreground text-sm col-span-3">No hay cuotas. Pide al admin que las cree.</div>}
            {plans.map((p) => {
              const active = form.plan_id === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => set("plan_id", p.id)}
                  className={`text-left rounded-xl p-5 border transition ${active ? "border-neon bg-neon/10 glow-neon-soft" : "border-border bg-input hover:border-neon/50"}`}
                >
                  <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">{p.duration_days} días</div>
                  <div className="font-display text-lg mt-1">{p.name}</div>
                  <div className={`mt-3 font-display text-2xl ${active ? "text-neon" : "text-foreground"}`}>{formatPrice(p.price_cents)}</div>
                </button>
              );
            })}
          </div>
        )}

        {step === 3 && (
          <div className="space-y-5">
            <Inp label="Número de DNI / NIE *" value={form.dni_number} onChange={(v) => set("dni_number", v.toUpperCase())} placeholder="12345678A" />
            <div>
              <div className="text-[10px] uppercase tracking-[0.3em] text-neon-dim mb-2">Foto del DNI (frontal) *</div>
              {form.dni_preview ? (
                <div className="relative inline-block">
                  <img src={form.dni_preview} alt="DNI" className="max-w-full max-h-72 rounded-lg border border-neon/30" />
                  <label className="absolute bottom-2 right-2 cursor-pointer bg-card/90 border border-neon/40 text-neon text-[10px] uppercase tracking-widest px-3 py-1.5 rounded-md">
                    Cambiar
                    <input type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => e.target.files?.[0] && handleDniFile(e.target.files[0])} />
                  </label>
                </div>
              ) : (
                <label className="flex flex-col items-center justify-center gap-2 h-48 rounded-lg border-2 border-dashed border-neon/30 hover:border-neon/60 hover:bg-neon/5 transition cursor-pointer">
                  <Camera className="w-8 h-8 text-neon" />
                  <div className="text-sm text-foreground font-display">Tomar foto / Subir imagen</div>
                  <div className="text-[10px] text-muted-foreground uppercase tracking-widest">Se comprimirá automáticamente</div>
                  <input type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => e.target.files?.[0] && handleDniFile(e.target.files[0])} />
                </label>
              )}
            </div>
          </div>
        )}

        {step === 4 && (
          <div className="space-y-5">
            <div className="text-[10px] uppercase tracking-[0.3em] text-neon-dim">Contrato — versión {CONTRACT_VERSION}</div>
            <div
              onScroll={(e) => {
                const el = e.currentTarget;
                if (el.scrollTop + el.clientHeight >= el.scrollHeight - 10) set("contract_read", true);
              }}
              className="bg-input border border-border rounded-lg p-5 h-64 overflow-y-auto text-sm leading-relaxed whitespace-pre-wrap text-foreground/90"
            >
              {CONTRACT_TEXT_ES}
            </div>
            <label className="flex items-start gap-3 text-sm">
              <input type="checkbox" checked={form.contract_read} onChange={(e) => set("contract_read", e.target.checked)} className="mt-1 accent-[oklch(0.86_0.28_145)]" />
              <span>He leído y acepto íntegramente las normas, el contrato y la política de protección de datos.</span>
            </label>

            <div>
              <div className="text-[10px] uppercase tracking-[0.3em] text-neon-dim mb-2">Firma del socio</div>
              <SignaturePad ref={sigRef} height={220} />
            </div>
          </div>
        )}

        <div className="flex items-center justify-between gap-3 mt-8 pt-6 border-t border-border">
          <button
            type="button"
            disabled={step === 0 || saving}
            onClick={back}
            className="flex items-center gap-2 px-4 py-2 text-xs uppercase tracking-widest text-muted-foreground hover:text-neon disabled:opacity-40"
          >
            <ChevronLeft className="w-4 h-4" /> Atrás
          </button>

          {step < STEPS.length - 1 ? (
            <button
              type="button"
              onClick={next}
              className="flex items-center gap-2 px-6 py-3 rounded-lg bg-gradient-neon text-primary-foreground font-display font-semibold uppercase tracking-[0.2em] text-xs glow-neon"
            >
              Siguiente <ChevronRight className="w-4 h-4" />
            </button>
          ) : (
            <button
              type="button"
              disabled={saving}
              onClick={submit}
              className="flex items-center gap-2 px-6 py-3 rounded-lg bg-gradient-neon text-primary-foreground font-display font-semibold uppercase tracking-[0.2em] text-xs glow-neon disabled:opacity-50"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              {saving ? "Guardando..." : "Confirmar"}
            </button>
          )}
        </div>
      </div>
    </SnoopLayout>
  );
}

function Inp({ label, value, onChange, type = "text", placeholder, className = "" }: { label: string; value: string; onChange: (v: string) => void; type?: string; placeholder?: string; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="block text-[10px] uppercase tracking-[0.3em] text-neon-dim mb-1.5">{label}</span>
      <input type={type} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)}
        className="w-full bg-input border border-border rounded-md px-3 py-2.5 text-sm focus:border-neon focus:ring-2 focus:ring-neon/20 outline-none transition" />
    </label>
  );
}
