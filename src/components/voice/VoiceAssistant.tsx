import { useCallback, useRef, useState } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Mic, X } from "lucide-react";
import { toast } from "sonner";
import { parseVoiceIntent, transcribeVoice, type VoiceIntent } from "@/lib/voice.functions";
import { supabase } from "@/integrations/supabase/client";
import { voiceBus } from "./voice-bus";
import { cn } from "@/lib/utils";

type State = "idle" | "listening" | "transcribing" | "thinking" | "executing";

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

const SILENCE_MS = 3000;
const MAX_RECORD_MS = 16000;
const MIN_AUDIO_BYTES = 1200;

function mimeForRecording() {
  return ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find((mime) => MediaRecorder.isTypeSupported(mime));
}

function blobToBase64(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(",")[1] ?? "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function speak(text: string) {
  try {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "it-IT";
    utterance.rate = 0.95;
    window.speechSynthesis.speak(utterance);
  } catch {
    // best effort
  }
}

export function VoiceAssistant() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const route = useRouterState({ select: (s) => s.location.pathname });
  const parseIntent = useServerFn(parseVoiceIntent);
  const transcribe = useServerFn(transcribeVoice);

  const [state, setState] = useState<State>("idle");
  const [level, setLevel] = useState(0);
  const [finalText, setFinalText] = useState("");
  const [lastSpoken, setLastSpoken] = useState("");

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);
  const maxTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const runRef = useRef(0);

  const cleanup = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    if (maxTimerRef.current) clearTimeout(maxTimerRef.current);
    maxTimerRef.current = null;
    try { audioCtxRef.current?.close(); } catch {}
    audioCtxRef.current = null;
    try {
      if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    } catch {}
    recorderRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setLevel(0);
  }, []);

  const executeIntent = useCallback(
    async (intent: VoiceIntent) => {
      setState("executing");
      if (intent.speak) {
        setLastSpoken(intent.speak);
        speak(intent.speak);
      }
      const { action } = intent;
      try {
        if (action === "navigate" && intent.target) {
          const to = ROUTE_MAP[intent.target];
          if (!to) return toast.error(`Non conosco "${intent.target}"`);
          await nav({ to });
          toast.success(intent.speak ?? `Apro ${intent.target}`);
        } else if (action === "create_member") {
          if (!intent.first_name || !intent.last_name) return toast.error("Mancano nome o cognome");
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
          toast.success(`Socio creato: ${intent.first_name} ${intent.last_name}`);
          await nav({ to: "/soci/$id", params: { id: data.id } });
        } else if (action === "find_member") {
          if (!intent.query) return toast.error("Dimmi quale socio cercare");
          if (route !== "/soci/gestisci") {
            voiceBus.pending = intent;
            await nav({ to: "/soci/gestisci" });
            return;
          }
          await voiceBus.handlers.findMember?.(intent.query);
        } else if (action === "add_to_cart") {
          if (!intent.query) return toast.error("Quale prodotto?");
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
          toast.success("Carrello svuotato");
        } else if (action === "confirm_order") {
          if (route !== "/soci/gestisci") return toast.error("Apri prima la pagina gestione soci");
          await voiceBus.handlers.confirmOrder?.();
        } else if (action === "renew_plan") {
          if (!intent.query) return toast.error("Quale piano?");
          if (route !== "/soci/gestisci") {
            voiceBus.pending = intent;
            await nav({ to: "/soci/gestisci" });
            return;
          }
          await voiceBus.handlers.renewPlan?.(intent.query);
        } else if (action === "fill_current_form") {
          if (!intent.form_fields || Object.keys(intent.form_fields).length === 0) return toast.error("Dimmi i campi da compilare");
          const handled = await voiceBus.handlers.fillCurrentForm?.(intent.form_fields);
          if (!handled) toast.error("Apri un modulo e riprova");
        } else if (action === "cancel") {
          toast.message(intent.speak ?? "Annullato");
        } else {
          toast.error(intent.speak ?? "Non ho capito.");
        }
        qc.invalidateQueries();
      } catch (e: any) {
        toast.error(e.message ?? "Errore");
      } finally {
        setState("idle");
      }
    },
    [nav, route, qc],
  );

  const handleText = useCallback(
    async (text: string) => {
      setFinalText(text);
      setState("thinking");
      try {
        const [{ data: prods }, { data: plansData }] = await Promise.all([
          supabase.from("products").select("id, name").eq("active", true),
          supabase.from("membership_plans").select("id, name, duration_days").eq("active", true),
        ]);
        const intent = await parseIntent({ data: { text, route, products: prods ?? [], plans: plansData ?? [] } });
        await executeIntent(intent);
      } catch (e: any) {
        toast.error(e.message ?? "Errore durante l'elaborazione");
        setState("idle");
      }
    },
    [executeIntent, parseIntent, route],
  );

  const stop = useCallback(() => {
    runRef.current += 1;
    cleanup();
    setState("idle");
  }, [cleanup]);

  const start = useCallback(async () => {
    if (state !== "idle") return;
    const mime = mimeForRecording();
    if (!mime) return toast.error("Questo browser non supporta il formato audio.");
    const runId = ++runRef.current;
    setFinalText("");
    setLastSpoken("");
    chunksRef.current = [];

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      if (runRef.current !== runId) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      const recorder = new MediaRecorder(stream, { mimeType: mime });
      recorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = async () => {
        if (runRef.current !== runId) return;
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || mime });
        cleanup();
        if (blob.size < MIN_AUDIO_BYTES) {
          toast.message("Non ho sentito nulla");
          setState("idle");
          return;
        }
        setState("transcribing");
        try {
          const audioBase64 = await blobToBase64(blob);
          const { text } = await transcribe({
            data: {
              audioBase64,
              mime: blob.type || mime,
              language: "it",
              prompt: "Trascrivi un comando vocale in italiano per il gestionale Meduza. Mantieni nomi prodotto, numeri, grammi e tessere.",
            },
          });
          if (runRef.current === runId) await handleText(text);
        } catch (e: any) {
          toast.error(e.message ?? "Errore trascrizione");
          setState("idle");
        }
      };

      const AudioCtor = window.AudioContext || (window as any).webkitAudioContext;
      const audioCtx = new AudioCtor();
      audioCtxRef.current = audioCtx;
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 1024;
      source.connect(analyser);
      const buffer = new Float32Array(analyser.fftSize);
      let lastVoiceAt = performance.now();
      let hasSpoken = false;
      let noiseFloor = 0.006;

      const finish = () => {
        try {
          if (recorder.state === "recording") recorder.stop();
        } catch {}
      };

      const tick = () => {
        if (runRef.current !== runId || recorder.state !== "recording") return;
        analyser.getFloatTimeDomainData(buffer);
        let sum = 0;
        for (let i = 0; i < buffer.length; i += 1) sum += buffer[i] * buffer[i];
        const rms = Math.sqrt(sum / buffer.length);
        setLevel(rms);
        const threshold = Math.max(0.009, noiseFloor + 0.008);
        if (!hasSpoken) noiseFloor = noiseFloor * 0.96 + Math.min(rms, 0.035) * 0.04;
        if (rms > threshold) {
          hasSpoken = true;
          lastVoiceAt = performance.now();
        }
        if (hasSpoken && performance.now() - lastVoiceAt >= SILENCE_MS) return finish();
        rafRef.current = requestAnimationFrame(tick);
      };

      recorder.start(250);
      setState("listening");
      rafRef.current = requestAnimationFrame(tick);
      maxTimerRef.current = setTimeout(finish, MAX_RECORD_MS);
    } catch (e: any) {
      toast.error(e?.name === "NotAllowedError" ? "Microfono bloccato" : "Microfono non disponibile");
      cleanup();
      setState("idle");
    }
  }, [cleanup, handleText, state, transcribe]);

  const busy = state === "transcribing" || state === "thinking" || state === "executing";
  const listening = state === "listening";
  const showOverlay = listening || busy || !!finalText;
  const meter = Math.min(1, level * 18);

  return (
    <>
      {showOverlay && (
        <div className="fixed inset-x-0 bottom-28 md:bottom-24 z-40 flex justify-center pointer-events-none px-4">
          <div className="bg-card/95 border-2 border-gold/60 rounded-3xl px-5 py-4 max-w-md w-full backdrop-blur-xl shadow-2xl pointer-events-auto">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] font-display uppercase tracking-widest text-gold">
                {listening ? "Meduza ascolta…" : state === "transcribing" ? "Meduza trascrive…" : state === "thinking" ? "Meduza capisce…" : state === "executing" ? "Meduza esegue…" : "Ultimo comando"}
              </span>
              <button onClick={() => { stop(); setFinalText(""); setLastSpoken(""); }} className="text-gold-muted hover:text-gold">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="text-sm text-foreground min-h-[1.5rem] leading-snug">
              {finalText || (listening ? "Parla ora, chiudo dopo 3 secondi di silenzio…" : "")}
            </div>
            {lastSpoken && !listening && <div className="text-[11px] text-gold italic mt-1">→ {lastSpoken}</div>}
          </div>
        </div>
      )}

      <div className="fixed z-30 bottom-6 right-4">
        <button
          onClick={listening ? stop : start}
          disabled={busy}
          className={cn(
            "relative w-16 h-16 rounded-full border-2 flex items-center justify-center shadow-xl backdrop-blur transition after:absolute after:inset-[-8px] after:rounded-full after:border after:border-gold/25",
            listening ? "bg-destructive border-destructive text-destructive-foreground animate-pulse" : busy ? "bg-card/80 border-gold/50 text-gold" : "bg-gradient-gold border-gold text-primary-foreground hover:scale-105 shadow-[0_0_45px_-12px_oklch(var(--gold)_/_0.9)]",
          )}
          style={listening ? { transform: `scale(${1 + meter * 0.18})` } : undefined}
          title={listening ? "Ferma" : "Parla"}
        >
          {busy ? <Loader2 className="w-7 h-7 animate-spin" /> : <Mic className="w-7 h-7" />}
        </button>
      </div>
    </>
  );
}