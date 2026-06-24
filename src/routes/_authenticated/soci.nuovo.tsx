import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { SnoopLayout } from "@/components/SnoopLayout";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Camera, Check, Loader2, Mic, Square } from "lucide-react";
import { CONTRACT_TEXT_ES, CONTRACT_VERSION, compressImage, formatPrice, uploadToSnoopDocs } from "@/lib/snoop";
import { SignaturePad, type SignaturePadHandle } from "@/components/SignaturePad";
import { extractMemberFields, transcribeAudio } from "@/lib/voice-agent.functions";

export const Route = createFileRoute("/_authenticated/soci/nuovo")({
  component: NewSocio,
});

type Plan = { id: string; name: string; duration_days: number; price_cents: number };

function pickMime(): string | null {
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/mpeg"];
  for (const t of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(t)) return t;
  }
  return null;
}
async function blobToBase64(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = ""; for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
  return btoa(bin);
}

function NewSocio() {
  const nav = useNavigate();
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

  // Voice
  const [recStatus, setRecStatus] = useState<"idle" | "recording" | "processing">("idle");
  const [lastHeard, setLastHeard] = useState("");
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const formRef = useRef(form);
  formRef.current = form;
  const transcribe = useServerFn(transcribeAudio);
  const extract = useServerFn(extractMemberFields);

  useEffect(() => {
    supabase.from("membership_plans").select("id,name,duration_days,price_cents").eq("active", true).order("sort_order")
      .then(({ data }) => setPlans((data as any) ?? []));
    return () => { streamRef.current?.getTracks().forEach((t) => t.stop()); };
  }, []);

  useEffect(() => {
    const readTranscript = (value: string | null) => {
      if (!value) return;
      try {
        const parsed = JSON.parse(value) as { text?: string };
        if (parsed.text) applyTranscriptToForm(parsed.text);
      } catch {
        // Ignore malformed storage values.
      }
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === "snoop:new-member-transcript") readTranscript(event.newValue);
    };
    window.addEventListener("storage", onStorage);
    readTranscript(window.localStorage.getItem("snoop:new-member-transcript"));
    return () => window.removeEventListener("storage", onStorage);
  }, [plans]);

  function set<K extends keyof typeof form>(k: K, v: typeof form[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  const selectedPlan = plans.find((p) => p.id === form.plan_id);

  function normalizePlanName(value: string) {
    return value
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/^cuota\s+/, "")
      .trim();
  }

  function findDictatedPlan(planName: string) {
    const wanted = normalizePlanName(planName);
    if (!wanted) return null;
    return plans.find((p) => {
      const name = normalizePlanName(p.name);
      return name === wanted || name.includes(wanted) || wanted.includes(name);
    }) ?? null;
  }

  async function applyTranscriptToForm(text: string) {
    setLastHeard(text);
    setRecStatus("processing");
    try {
      const current = formRef.current;
      const planForId = plans.find((p) => p.id === current.plan_id);
      const { fields } = await extract({
        data: {
          transcript: text,
          current: {
            first_name: current.first_name,
            last_name: current.last_name,
            birth_date: current.birth_date,
            city: current.city,
            phone: current.phone,
            dni_number: current.dni_number,
            plan_name: planForId?.name ?? "",
          },
          available_plans: plans.map((p) => p.name),
        },
      });
      const matchedPlan = fields.plan_name ? findDictatedPlan(fields.plan_name) : null;
      setForm((f) => ({
        ...f,
        first_name: fields.first_name || f.first_name,
        last_name: fields.last_name || f.last_name,
        birth_date: fields.birth_date || f.birth_date,
        city: fields.city || f.city,
        phone: fields.phone || f.phone,
        dni_number: fields.dni_number || f.dni_number,
        plan_id: matchedPlan?.id ?? f.plan_id,
      }));
      toast.success("Casillas rellenadas");
    } catch (e: any) {
      toast.error(e.message ?? "Error en dictado");
    } finally {
      setRecStatus("idle");
    }
  }

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

  // --- Voice: dictate and auto-fill fields ---
  async function startRec() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mime = pickMime();
      if (!mime) { stream.getTracks().forEach((t) => t.stop()); toast.error("Navegador no compatible."); return; }
      const rec = new MediaRecorder(stream, { mimeType: mime });
      chunksRef.current = [];
      rec.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        const blob = new Blob(chunksRef.current, { type: rec.mimeType });
        if (blob.size < 1500) { setRecStatus("idle"); toast.error("No te he oído, vuelve a intentar."); return; }
        setRecStatus("processing");
        try {
          const b64 = await blobToBase64(blob);
          const { text } = await transcribe({ data: { audioBase64: b64, mimeType: rec.mimeType } });
          if (!text) { setRecStatus("idle"); toast.error("No se entendió nada."); return; }
          await applyTranscriptToForm(text);
        } catch (e: any) {
          toast.error(e.message ?? "Error en dictado");
        } finally {
          setRecStatus("idle");
        }
      };
      recorderRef.current = rec;
      rec.start();
      setRecStatus("recording");
    } catch {
      toast.error("Permiso de micrófono denegado.");
    }
  }
  function stopRec() { recorderRef.current?.stop(); }
  function toggleMic() {
    if (recStatus === "recording") stopRec();
    else if (recStatus === "idle") startRec();
  }

  async function submit() {
    if (!form.first_name.trim() || !form.last_name.trim()) return toast.error("Falta nombre y apellido");
    if (!form.birth_date) return toast.error("Falta la fecha de nacimiento");
    const age = (Date.now() - new Date(form.birth_date).getTime()) / (1000 * 60 * 60 * 24 * 365.25);
    if (age < 18) return toast.error("El socio debe ser mayor de edad");
    if (!form.city.trim() || !form.phone.trim()) return toast.error("Faltan ciudad o teléfono");
    if (!form.dni_number.trim()) return toast.error("Falta el número de DNI");
    if (!form.dni_file) return toast.error("Falta la foto del DNI");
    if (!form.plan_id) return toast.error("Selecciona una cuota");
    if (!form.contract_read) return toast.error("Marca que has leído el contrato");
    if (sigRef.current?.isEmpty()) return toast.error("Falta la firma del socio");

    setSaving(true);
    try {
      const { data: user } = await supabase.auth.getUser();
      const memberId = crypto.randomUUID();
      const dniPath = `members/${memberId}/dni.jpg`;
      const sigPath = `members/${memberId}/signature.png`;

      await uploadToSnoopDocs(form.dni_file!, dniPath);
      const sigBlob = await sigRef.current!.toBlob();
      if (!sigBlob) throw new Error("Firma vacía");
      await uploadToSnoopDocs(sigBlob, sigPath);

      const joined = new Date();
      const expires = new Date(joined.getTime() + selectedPlan!.duration_days * 86400000);

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
    <SnoopLayout title="Nuevo socio" subtitle="Dicta los datos o rellénalos a mano">
      {/* Voice dictation bar */}
      <div className="max-w-3xl mb-6 rounded-2xl border border-neon/30 bg-card/70 backdrop-blur p-4 flex items-center gap-4">
        <button
          type="button"
          onClick={toggleMic}
          disabled={recStatus === "processing"}
          className={`h-14 w-14 shrink-0 rounded-full flex items-center justify-center transition
            ${recStatus === "recording" ? "bg-destructive text-destructive-foreground animate-pulse"
              : "bg-gradient-neon text-primary-foreground glow-neon"} disabled:opacity-60`}
          aria-label="Dictar datos"
        >
          {recStatus === "processing" ? <Loader2 className="w-5 h-5 animate-spin" />
            : recStatus === "recording" ? <Square className="w-5 h-5" />
            : <Mic className="w-6 h-6" />}
        </button>
        <div className="flex-1 min-w-0">
          <div className="text-[10px] uppercase tracking-[0.3em] text-neon-dim">Dictado por voz</div>
          {recStatus === "recording" && <p className="text-sm text-destructive animate-pulse">● Escuchando… pulsa para parar</p>}
          {recStatus === "processing" && <p className="text-sm text-neon-dim">Procesando…</p>}
          {recStatus === "idle" && !lastHeard && (
            <p className="text-sm text-muted-foreground">Pulsa y di: "Nombre, apellido, fecha de nacimiento, DNI, ciudad, teléfono y plan".</p>
          )}
          {recStatus === "idle" && lastHeard && (
            <p className="text-sm text-muted-foreground italic truncate">"{lastHeard}"</p>
          )}
        </div>
      </div>

      <div className="bg-card/60 border border-neon/20 rounded-2xl p-6 md:p-8 max-w-3xl backdrop-blur space-y-8">
        {/* Datos personales */}
        <section>
          <h3 className="text-[11px] uppercase tracking-[0.3em] text-neon mb-4">Datos del socio</h3>
          <div className="grid md:grid-cols-2 gap-4">
            <Inp label="Nombre *" value={form.first_name} onChange={(v) => set("first_name", v)} />
            <Inp label="Apellidos *" value={form.last_name} onChange={(v) => set("last_name", v)} />
            <Inp label="Fecha de nacimiento *" type="date" value={form.birth_date} onChange={(v) => set("birth_date", v)} />
            <Inp label="Número de DNI / NIE *" value={form.dni_number} onChange={(v) => set("dni_number", v.toUpperCase())} placeholder="12345678A" />
            <Inp label="Ciudad *" value={form.city} onChange={(v) => set("city", v)} />
            <Inp label="Teléfono *" type="tel" value={form.phone} onChange={(v) => set("phone", v)} />
          </div>
        </section>

        {/* Plan */}
        <section>
          <h3 className="text-[11px] uppercase tracking-[0.3em] text-neon mb-4">Cuota</h3>
          <div className="grid sm:grid-cols-3 gap-3">
            {plans.length === 0 && <div className="text-muted-foreground text-sm col-span-3">No hay cuotas. Pide al admin que las cree.</div>}
            {plans.map((p) => {
              const active = form.plan_id === p.id;
              return (
                <button key={p.id} type="button" onClick={() => set("plan_id", p.id)}
                  className={`text-left rounded-xl p-4 border transition ${active ? "border-neon bg-neon/10 glow-neon-soft" : "border-border bg-input hover:border-neon/50"}`}>
                  <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">{p.duration_days} días</div>
                  <div className="font-display text-base mt-1">{p.name}</div>
                  <div className={`mt-2 font-display text-xl ${active ? "text-neon" : "text-foreground"}`}>{formatPrice(p.price_cents)}</div>
                </button>
              );
            })}
          </div>
        </section>

        {/* DNI photo */}
        <section>
          <h3 className="text-[11px] uppercase tracking-[0.3em] text-neon mb-4">Foto del DNI (frontal) *</h3>
          {form.dni_preview ? (
            <div className="relative inline-block">
              <img src={form.dni_preview} alt="DNI" className="max-w-full max-h-64 rounded-lg border border-neon/30" />
              <label className="absolute bottom-2 right-2 cursor-pointer bg-card/90 border border-neon/40 text-neon text-[10px] uppercase tracking-widest px-3 py-1.5 rounded-md">
                Cambiar
                <input type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => e.target.files?.[0] && handleDniFile(e.target.files[0])} />
              </label>
            </div>
          ) : (
            <label className="flex flex-col items-center justify-center gap-2 h-44 rounded-lg border-2 border-dashed border-neon/30 hover:border-neon/60 hover:bg-neon/5 transition cursor-pointer">
              <Camera className="w-8 h-8 text-neon" />
              <div className="text-sm text-foreground font-display">Tomar foto / Subir imagen</div>
              <div className="text-[10px] text-muted-foreground uppercase tracking-widest">Se comprimirá automáticamente</div>
              <input type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => e.target.files?.[0] && handleDniFile(e.target.files[0])} />
            </label>
          )}
        </section>

        {/* Contrato + firma (único paso separado) */}
        <section className="border-t border-border pt-6">
          <h3 className="text-[11px] uppercase tracking-[0.3em] text-neon mb-4">Contrato y firma — versión {CONTRACT_VERSION}</h3>
          <div
            onScroll={(e) => {
              const el = e.currentTarget;
              if (el.scrollTop + el.clientHeight >= el.scrollHeight - 10) set("contract_read", true);
            }}
            className="bg-input border border-border rounded-lg p-5 h-56 overflow-y-auto text-sm leading-relaxed whitespace-pre-wrap text-foreground/90"
          >
            {CONTRACT_TEXT_ES}
          </div>
          <label className="flex items-start gap-3 text-sm mt-3">
            <input type="checkbox" checked={form.contract_read} onChange={(e) => set("contract_read", e.target.checked)} className="mt-1 accent-[oklch(0.86_0.28_145)]" />
            <span>He leído y acepto íntegramente las normas, el contrato y la política de protección de datos.</span>
          </label>
          <div className="mt-4">
            <div className="text-[10px] uppercase tracking-[0.3em] text-neon-dim mb-2">Firma del socio</div>
            <SignaturePad ref={sigRef} height={220} />
          </div>
        </section>

        <div className="flex items-center justify-end pt-4 border-t border-border">
          <button type="button" disabled={saving} onClick={submit}
            className="flex items-center gap-2 px-6 py-3 rounded-lg bg-gradient-neon text-primary-foreground font-display font-semibold uppercase tracking-[0.2em] text-xs glow-neon disabled:opacity-50">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            {saving ? "Guardando..." : "Crear socio"}
          </button>
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
