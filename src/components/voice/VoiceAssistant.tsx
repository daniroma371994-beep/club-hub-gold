import { useEffect, useRef, useState, useCallback } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { Mic, MicOff, Loader2, Ear, Radio } from "lucide-react";
import { toast } from "sonner";
import { transcribeVoice, parseVoiceIntent, type VoiceIntent } from "@/lib/voice.functions";
import { supabase } from "@/integrations/supabase/client";
import { voiceBus } from "./voice-bus";
import { cn } from "@/lib/utils";

type State = "idle" | "wake" | "recording" | "transcribing" | "thinking" | "executing";

const ROUTE_MAP: Record<string, string> = {
  dashboard: "/dashboard",
  soci: "/soci",
  "crear-socio": "/soci/nuovo",
  "gestionar-socio": "/soci/gestisci",
  productos: "/prodotti",
  caja: "/cassa",
  planes: "/piani",
  colaboradores: "/collaboratori",
};

export function VoiceAssistant() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const route = useRouterState({ select: (s) => s.location.pathname });
  const transcribe = useServerFn(transcribeVoice);
  const parseIntent = useServerFn(parseVoiceIntent);

  const [state, setState] = useState<State>("idle");
  const [wakeEnabled, setWakeEnabled] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("meduza-voice-wake") === "1";
  });
  const [lastText, setLastText] = useState<string>("");
  const [lastSpoken, setLastSpoken] = useState<string>("");
  const [expanded, setExpanded] = useState(false);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const srRef = useRef<any>(null);
  const stopTimerRef = useRef<number | null>(null);
  const stateRef = useRef<State>("idle");
  stateRef.current = state;

  const blob2b64 = (blob: Blob) =>
    new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => {
        const s = r.result as string;
        resolve(s.split(",")[1] ?? "");
      };
      r.onerror = () => reject(r.error);
      r.readAsDataURL(blob);
    });

  const beep = useCallback(() => {
    try {
      const Ctx: typeof AudioContext = (window as any).AudioContext || (window as any).webkitAudioContext;
      const ctx = new Ctx();
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = 880;
      o.connect(g);
      g.connect(ctx.destination);
      g.gain.setValueAtTime(0.0001, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.15, ctx.currentTime + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.18);
      o.start();
      o.stop(ctx.currentTime + 0.2);
    } catch {}
  }, []);

  const stopRecording = useCallback(() => {
    if (stopTimerRef.current) {
      window.clearTimeout(stopTimerRef.current);
      stopTimerRef.current = null;
    }
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      recorderRef.current.stop();
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const executeIntent = useCallback(
    async (intent: VoiceIntent) => {
      setState("executing");
      if (intent.speak) setLastSpoken(intent.speak);
      const { action } = intent;

      try {
        if (action === "navigate" && intent.target) {
          const to = ROUTE_MAP[intent.target];
          if (!to) return toast.error(`No conozco la sección "${intent.target}"`);
          await nav({ to });
          toast.success(intent.speak ?? `Abriendo ${intent.target}`);
        } else if (action === "create_member") {
          if (!intent.first_name || !intent.last_name) {
            toast.error("Faltan nombre o apellido");
            return;
          }
          const { data: u } = await supabase.auth.getUser();
          const cardNumber = `V${Date.now().toString().slice(-6)}`;
          const { data, error } = await supabase
            .from("members")
            .insert({
              card_number: cardNumber,
              first_name: intent.first_name,
              last_name: intent.last_name,
              document_type: "DNI",
              document_number: intent.dni ?? null,
              phone: intent.phone ?? null,
              address: intent.address ?? null,
              email: intent.email ?? null,
              birth_date: intent.birth_date ?? null,
              created_by: u.user?.id,
            })
            .select("id")
            .single();
          if (error) throw error;
          toast.success(`Socio creado: ${intent.first_name} ${intent.last_name}`);
          await nav({ to: "/soci/$id", params: { id: data.id } });
        } else if (action === "find_member") {
          if (!intent.query) return toast.error("Dime qué socio buscar");
          if (route !== "/soci/gestisci") {
            voiceBus.pending = intent;
            await nav({ to: "/soci/gestisci" });
            return;
          }
          if (!voiceBus.handlers.findMember) return toast.error("Página no lista");
          await voiceBus.handlers.findMember(intent.query);
        } else if (action === "add_to_cart") {
          if (!intent.query) return toast.error("¿Qué producto?");
          if (route !== "/soci/gestisci") {
            voiceBus.pending = intent;
            await nav({ to: "/soci/gestisci" });
            return;
          }
          await voiceBus.handlers.addToCart?.(intent.query, intent.quantity ?? 1, intent.unit ?? "g");
        } else if (action === "remove_from_cart") {
          if (!intent.query) return;
          await voiceBus.handlers.removeFromCart?.(intent.query);
        } else if (action === "clear_cart") {
          voiceBus.handlers.clearCart?.();
          toast.success("Pedido vaciado");
        } else if (action === "confirm_order") {
          if (route !== "/soci/gestisci") return toast.error("Abre primero la página de socio");
          await voiceBus.handlers.confirmOrder?.();
        } else if (action === "renew_plan") {
          if (!intent.query) return toast.error("¿Qué plan?");
          if (route !== "/soci/gestisci") {
            voiceBus.pending = intent;
            await nav({ to: "/soci/gestisci" });
            return;
          }
          await voiceBus.handlers.renewPlan?.(intent.query);
        } else if (action === "cancel") {
          toast.message(intent.speak ?? "Cancelado");
        } else {
          toast.error(intent.speak ?? "No entendí. Intenta otra vez.");
        }
        qc.invalidateQueries();
      } catch (e: any) {
        toast.error(e.message ?? "Error ejecutando el comando");
      } finally {
        setState(wakeEnabled ? "wake" : "idle");
        if (wakeEnabled) startWake();
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [nav, route, qc, wakeEnabled],
  );

  // Allow the bus to replay pending intents once a page registers its handlers.
  useEffect(() => {
    voiceBus.setReplayer((i) => executeIntent(i));
    return () => voiceBus.setReplayer(null);
  }, [executeIntent]);

  const processBlob = useCallback(
    async (blob: Blob) => {
      if (blob.size < 2000) {
        toast.error("No oí nada. Intenta de nuevo.");
        setState(wakeEnabled ? "wake" : "idle");
        if (wakeEnabled) startWake();
        return;
      }
      try {
        setState("transcribing");
        const audioBase64 = await blob2b64(blob);
        const { text } = await transcribe({ data: { audioBase64, mime: blob.type || "audio/webm" } });
        if (!text) {
          toast.error("No pude entender el audio");
          setState(wakeEnabled ? "wake" : "idle");
          if (wakeEnabled) startWake();
          return;
        }
        setLastText(text);
        setState("thinking");

        // Fetch context for intent parsing
        const [{ data: prods }, { data: plansData }] = await Promise.all([
          supabase.from("products").select("id, name").eq("active", true),
          supabase.from("membership_plans").select("id, name, duration_days").eq("active", true),
        ]);

        const intent = await parseIntent({
          data: {
            text,
            route,
            products: prods ?? [],
            plans: plansData ?? [],
          },
        });
        await executeIntent(intent);
      } catch (e: any) {
        toast.error(e.message ?? "Error procesando voz");
        setState(wakeEnabled ? "wake" : "idle");
        if (wakeEnabled) startWake();
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [transcribe, parseIntent, route, wakeEnabled, executeIntent],
  );

  const startRecording = useCallback(async () => {
    try {
      // pause wake-word SR while recording
      try { srRef.current?.stop(); } catch {}
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mime = ["audio/webm", "audio/mp4"].find((t) => MediaRecorder.isTypeSupported(t)) ?? "";
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      recorderRef.current = rec;
      chunksRef.current = [];
      rec.ondataavailable = (e) => e.data.size > 0 && chunksRef.current.push(e.data);
      rec.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" });
        chunksRef.current = [];
        processBlob(blob);
      };
      rec.start();
      setState("recording");
      beep();
      stopTimerRef.current = window.setTimeout(() => stopRecording(), 7000);
    } catch (e: any) {
      toast.error("Sin acceso al micrófono");
      setState(wakeEnabled ? "wake" : "idle");
      if (wakeEnabled) startWake();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [beep, processBlob, stopRecording, wakeEnabled]);

  const startWake = useCallback(() => {
    const SR: any = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return;
    try { srRef.current?.stop(); } catch {}
    const sr = new SR();
    sr.lang = "es-ES";
    sr.continuous = true;
    sr.interimResults = true;
    sr.onresult = (ev: any) => {
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const t = (ev.results[i][0].transcript ?? "").toLowerCase();
        if (/\bmedu[sz]a\b/.test(t)) {
          try { sr.stop(); } catch {}
          startRecording();
          return;
        }
      }
    };
    sr.onerror = (e: any) => {
      if (e.error === "not-allowed") {
        toast.error("Micrófono bloqueado por el navegador");
        setWakeEnabled(false);
        localStorage.removeItem("meduza-voice-wake");
        setState("idle");
        return;
      }
      // auto-restart on transient errors
      if (stateRef.current === "wake") setTimeout(startWake, 800);
    };
    sr.onend = () => {
      if (stateRef.current === "wake") setTimeout(startWake, 200);
    };
    srRef.current = sr;
    try {
      sr.start();
      setState("wake");
    } catch {}
  }, [startRecording]);

  // Toggle wake mode on/off
  useEffect(() => {
    if (wakeEnabled) {
      localStorage.setItem("meduza-voice-wake", "1");
      if (state === "idle") startWake();
    } else {
      localStorage.removeItem("meduza-voice-wake");
      try { srRef.current?.stop(); } catch {}
      if (state === "wake") setState("idle");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wakeEnabled]);

  useEffect(() => () => {
    try { srRef.current?.stop(); } catch {}
    stopRecording();
  }, [stopRecording]);

  const onMicClick = () => {
    if (state === "recording") {
      stopRecording();
    } else if (state === "idle" || state === "wake") {
      startRecording();
    }
  };

  const busy = state === "transcribing" || state === "thinking" || state === "executing";
  const recording = state === "recording";
  const wakeActive = state === "wake";

  return (
    <div className="fixed z-30 bottom-20 md:bottom-6 right-4 flex flex-col items-end gap-2">
      {expanded && (
        <div className="bg-card/95 border border-gold/40 rounded-lg p-3 max-w-xs text-xs space-y-2 backdrop-blur shadow-xl">
          <div className="flex items-center justify-between">
            <span className="font-display uppercase tracking-widest text-gold text-[10px]">Voz Meduza</span>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <span className="text-[10px] text-gold-muted uppercase tracking-wider">Wake</span>
              <input
                type="checkbox"
                checked={wakeEnabled}
                onChange={(e) => setWakeEnabled(e.target.checked)}
                className="accent-yellow-500"
              />
            </label>
          </div>
          <div className="text-[10px] text-muted-foreground leading-relaxed">
            Di <b className="text-gold">"Meduza"</b> y luego tu orden. O pulsa el micrófono.
            <br />
            Ej: <i>"Meduza, abre la caja"</i> · <i>"añade 2 gramos de Amnesia"</i> · <i>"confirma el pedido"</i>.
          </div>
          {lastText && (
            <div className="border-t border-gold/20 pt-2">
              <div className="text-[9px] uppercase tracking-widest text-gold-muted">Última orden</div>
              <div className="text-foreground">{lastText}</div>
            </div>
          )}
          {lastSpoken && (
            <div className="text-[10px] text-gold italic">→ {lastSpoken}</div>
          )}
        </div>
      )}
      <div className="flex items-center gap-2">
        <button
          onClick={() => setExpanded((v) => !v)}
          className="bg-card/80 border border-gold/40 text-gold-muted hover:text-gold rounded-full px-3 py-1 text-[10px] uppercase tracking-widest backdrop-blur"
          title="Ayuda voz"
        >
          {wakeActive ? <span className="flex items-center gap-1"><Ear className="w-3 h-3" /> Escuchando "Meduza"</span> : "Voz"}
        </button>
        <button
          onClick={onMicClick}
          disabled={busy}
          className={cn(
            "relative w-14 h-14 rounded-full border-2 flex items-center justify-center shadow-lg backdrop-blur transition",
            recording
              ? "bg-destructive/90 border-destructive text-white animate-pulse"
              : busy
                ? "bg-card/80 border-gold/50 text-gold"
                : wakeActive
                  ? "bg-gradient-gold border-gold text-primary-foreground"
                  : "bg-card/80 border-gold/50 text-gold hover:bg-gold/10",
          )}
          title={recording ? "Detener" : "Hablar"}
        >
          {busy ? (
            <Loader2 className="w-6 h-6 animate-spin" />
          ) : recording ? (
            <Radio className="w-6 h-6" />
          ) : wakeEnabled ? (
            <Mic className="w-6 h-6" />
          ) : (
            <MicOff className="w-6 h-6" />
          )}
        </button>
      </div>
    </div>
  );
}
