import { useCallback, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Mic, X, Check, Loader2, Volume2 } from "lucide-react";
import { toast } from "sonner";
import { transcribeVoice } from "@/lib/voice.functions";

export type WizardField = {
  key: string;
  label: string;
  type?: "text" | "date" | "email" | "phone" | "number";
  hint?: string;
};

function normalize(text: string, type?: WizardField["type"]): string {
  let t = text.trim();
  if (!t) return "";
  t = t.replace(/[.,;!?]+$/g, "").trim();
  if (type === "email") {
    return t.toLowerCase()
      .replace(/\s+chiocciola\s+/g, "@")
      .replace(/\s+at\s+/g, "@")
      .replace(/\s+arroba\s+/g, "@")
      .replace(/\s+punto\s+/g, ".")
      .replace(/\s+dot\s+/g, ".")
      .replace(/\s+/g, "");
  }
  if (type === "phone") {
    const map: Record<string, string> = {
      zero: "0", uno: "1", due: "2", tre: "3", quattro: "4",
      cinque: "5", sei: "6", sette: "7", otto: "8", nove: "9",
    };
    const tokens = t.toLowerCase().split(/[\s-]+/);
    const digits = tokens.map((w) => map[w] ?? w).join("");
    return digits.replace(/[^\d+]/g, "") || t;
  }
  if (type === "number") {
    const map: Record<string, string> = {
      zero: "0", uno: "1", due: "2", tre: "3", quattro: "4",
      cinque: "5", sei: "6", sette: "7", otto: "8", nove: "9", dieci: "10",
    };
    const tokens = t.toLowerCase().split(/[\s-]+/);
    const out = tokens.map((w) => map[w] ?? w).join("");
    const num = out.replace(/[^\d.,]/g, "").replace(",", ".");
    return num || t;
  }
  if (type === "date") {
    const months: Record<string, string> = {
      gennaio: "01", febbraio: "02", marzo: "03", aprile: "04", maggio: "05",
      giugno: "06", luglio: "07", agosto: "08", settembre: "09",
      ottobre: "10", novembre: "11", dicembre: "12",
    };
    const m = t.toLowerCase().match(/(\d{1,2})\s+(\w+)\s+(\d{2,4})/);
    if (m && months[m[2]]) {
      const dd = m[1].padStart(2, "0");
      const mm = months[m[2]];
      let yy = m[3];
      if (yy.length === 2) yy = (parseInt(yy) > 30 ? "19" : "20") + yy;
      return `${yy}-${mm}-${dd}`;
    }
    const m2 = t.match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
    if (m2) {
      const dd = m2[1].padStart(2, "0");
      const mm = m2[2].padStart(2, "0");
      let yy = m2[3];
      if (yy.length === 2) yy = (parseInt(yy) > 30 ? "19" : "20") + yy;
      return `${yy}-${mm}-${dd}`;
    }
    return t;
  }
  return t.charAt(0).toUpperCase() + t.slice(1);
}

type Phase = "speaking" | "listening" | "transcribing" | "confirming" | "done";

// Silence detection thresholds
const SILENCE_RMS = 0.012;       // below this = silence
const SILENCE_MS = 1800;         // ms of continuous silence to stop
const MAX_RECORD_MS = 12000;     // hard cap
const MIN_SPEECH_MS = 400;       // need some voiced audio first

export function VoiceFormWizard({
  fields,
  onChange,
  onClose,
}: {
  fields: WizardField[];
  onChange: (key: string, value: string) => void;
  onClose: () => void;
}) {
  const transcribe = useServerFn(transcribeVoice);
  const [idx, setIdx] = useState(0);
  const [phase, setPhase] = useState<Phase>("speaking");
  const [heard, setHeard] = useState("");
  const [level, setLevel] = useState(0);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);
  const stopTimerRef = useRef<number | null>(null);
  const maxTimerRef = useRef<number | null>(null);
  const advanceTimerRef = useRef<number | null>(null);
  const stoppedRef = useRef(false);
  const cancelledRef = useRef(false);

  const field = fields[idx];
  const finished = idx >= fields.length;

  const blob2b64 = (blob: Blob) =>
    new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve((r.result as string).split(",")[1] ?? "");
      r.onerror = () => reject(r.error);
      r.readAsDataURL(blob);
    });

  const cleanupAudio = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    if (stopTimerRef.current) { clearTimeout(stopTimerRef.current); stopTimerRef.current = null; }
    if (maxTimerRef.current) { clearTimeout(maxTimerRef.current); maxTimerRef.current = null; }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    try { audioCtxRef.current?.close(); } catch {}
    audioCtxRef.current = null;
    recorderRef.current = null;
  }, []);

  const cleanupAll = useCallback(() => {
    cancelledRef.current = true;
    cleanupAudio();
    if (advanceTimerRef.current) { clearTimeout(advanceTimerRef.current); advanceTimerRef.current = null; }
    try { window.speechSynthesis.cancel(); } catch {}
  }, [cleanupAudio]);

  // Speak helper that resolves when done
  const speak = useCallback((text: string) =>
    new Promise<void>((resolve) => {
      try {
        window.speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(text);
        u.lang = "it-IT";
        u.rate = 1.0;
        u.onend = () => resolve();
        u.onerror = () => resolve();
        window.speechSynthesis.speak(u);
        // safety timeout
        setTimeout(() => resolve(), 6000);
      } catch { resolve(); }
    }), []);

  const startListening = useCallback(async () => {
    stoppedRef.current = false;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (cancelledRef.current) { stream.getTracks().forEach((t) => t.stop()); return; }
      streamRef.current = stream;

      const mime = ["audio/webm", "audio/mp4"].find((m) => MediaRecorder.isTypeSupported(m)) ?? "";
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      recorderRef.current = rec;
      chunksRef.current = [];
      rec.ondataavailable = (e) => e.data.size > 0 && chunksRef.current.push(e.data);
      rec.onstop = async () => {
        cleanupAudio();
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" });
        if (cancelledRef.current) return;
        if (blob.size < 1500) {
          await speak("Non ho sentito nulla. Ripeti pure.");
          if (!cancelledRef.current) startListening();
          return;
        }
        setPhase("transcribing");
        try {
          const audioBase64 = await blob2b64(blob);
          const { text } = await transcribe({
            data: { audioBase64, mime: blob.type || "audio/webm", language: "it" },
          });
          if (cancelledRef.current) return;
          if (!text || !text.trim()) {
            await speak("Non ho capito. Ripeti pure.");
            if (!cancelledRef.current) startListening();
            return;
          }
          const norm = normalize(text, field?.type);
          setHeard(norm);
          onChange(field.key, norm);
          setPhase("confirming");
          await speak(`Ho scritto: ${norm}`);
          // brief pause then advance
          advanceTimerRef.current = window.setTimeout(() => {
            if (!cancelledRef.current) setIdx((i) => i + 1);
          }, 600);
        } catch (e: any) {
          toast.error(e?.message ?? "Errore trascrizione");
          await speak("Errore. Ripeti pure.");
          if (!cancelledRef.current) startListening();
        }
      };

      // Audio analyser for silence detection
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      audioCtxRef.current = ctx;
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      src.connect(analyser);
      const buf = new Float32Array(analyser.fftSize);
      const startedAt = performance.now();
      let lastVoiceAt = 0;
      let hasSpoken = false;

      const tick = () => {
        if (stoppedRef.current) return;
        analyser.getFloatTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
        const rms = Math.sqrt(sum / buf.length);
        setLevel(rms);
        const now = performance.now();
        if (rms > SILENCE_RMS) {
          lastVoiceAt = now;
          if (now - startedAt > MIN_SPEECH_MS) hasSpoken = true;
        }
        if (hasSpoken && lastVoiceAt && now - lastVoiceAt > SILENCE_MS) {
          stoppedRef.current = true;
          try { rec.stop(); } catch {}
          return;
        }
        rafRef.current = requestAnimationFrame(tick);
      };

      rec.start();
      setPhase("listening");
      rafRef.current = requestAnimationFrame(tick);
      maxTimerRef.current = window.setTimeout(() => {
        if (!stoppedRef.current) {
          stoppedRef.current = true;
          try { rec.stop(); } catch {}
        }
      }, MAX_RECORD_MS);
    } catch {
      toast.error("Microfono non disponibile");
      onClose();
    }
  }, [cleanupAudio, transcribe, field, onChange, speak, onClose]);

  // Run per field: speak prompt, then listen
  useEffect(() => {
    cancelledRef.current = false;
    if (finished) {
      setPhase("done");
      speak("Compilazione completata.");
      return;
    }
    setHeard("");
    setPhase("speaking");
    let cancelled = false;
    (async () => {
      const prompt = field.hint ? `${field.label}. ${field.hint}` : field.label;
      await speak(prompt);
      if (cancelled || cancelledRef.current) return;
      // 3 second pause then auto-listen
      await new Promise((r) => setTimeout(r, 600));
      if (cancelled || cancelledRef.current) return;
      startListening();
    })();
    return () => {
      cancelled = true;
      cancelledRef.current = true;
      cleanupAudio();
      if (advanceTimerRef.current) { clearTimeout(advanceTimerRef.current); advanceTimerRef.current = null; }
      try { window.speechSynthesis.cancel(); } catch {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx]);

  useEffect(() => () => { cleanupAll(); }, [cleanupAll]);

  const close = () => {
    cleanupAll();
    onClose();
  };

  const skip = () => {
    cleanupAudio();
    if (advanceTimerRef.current) { clearTimeout(advanceTimerRef.current); advanceTimerRef.current = null; }
    try { window.speechSynthesis.cancel(); } catch {}
    setIdx((i) => i + 1);
  };

  const repeat = () => {
    cleanupAudio();
    if (advanceTimerRef.current) { clearTimeout(advanceTimerRef.current); advanceTimerRef.current = null; }
    try { window.speechSynthesis.cancel(); } catch {}
    setHeard("");
    setPhase("speaking");
    (async () => {
      const prompt = field.hint ? `${field.label}. ${field.hint}` : field.label;
      await speak(prompt);
      if (!cancelledRef.current) startListening();
    })();
  };

  const meter = Math.min(1, level * 12);

  return (
    <div className="fixed inset-0 bg-black/90 backdrop-blur z-50 flex items-end md:items-center justify-center p-0 md:p-4">
      <div className="bg-card border-2 border-gold/60 rounded-t-2xl md:rounded-2xl p-6 w-full max-w-md space-y-5 shadow-2xl">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-display uppercase tracking-[0.3em] text-gold-muted">
            Auto-dettatura {Math.min(idx + 1, fields.length)} / {fields.length}
          </span>
          <button onClick={close} className="text-gold-muted hover:text-gold">
            <X className="w-4 h-4" />
          </button>
        </div>

        {finished ? (
          <div className="text-center py-6 space-y-3">
            <Check className="w-12 h-12 text-gold mx-auto" />
            <p className="font-display uppercase tracking-widest text-gold text-sm">Completato</p>
            <button onClick={close} className="w-full bg-gradient-gold text-primary-foreground py-3 rounded-md font-display uppercase tracking-[0.3em] text-xs">
              Chiudi
            </button>
          </div>
        ) : (
          <>
            <div className="text-center">
              <div className="text-[10px] uppercase tracking-[0.3em] text-gold-muted">Campo</div>
              <div className="font-display text-3xl text-gold mt-1">{field.label}</div>
              {field.hint && <div className="text-xs text-muted-foreground mt-1">{field.hint}</div>}
            </div>

            {/* Big animated indicator */}
            <div className="flex flex-col items-center justify-center py-4">
              <div
                className={
                  "w-28 h-28 rounded-full flex items-center justify-center border-4 transition " +
                  (phase === "speaking"
                    ? "border-gold/70 bg-card text-gold"
                    : phase === "listening"
                      ? "border-destructive bg-destructive/10 text-destructive"
                      : phase === "transcribing"
                        ? "border-gold/60 bg-card text-gold"
                        : "border-gold bg-gradient-gold text-primary-foreground")
                }
                style={
                  phase === "listening"
                    ? { transform: `scale(${1 + meter * 0.35})` }
                    : undefined
                }
              >
                {phase === "speaking" && <Volume2 className="w-12 h-12 animate-pulse" />}
                {phase === "listening" && <Mic className="w-12 h-12" />}
                {phase === "transcribing" && <Loader2 className="w-12 h-12 animate-spin" />}
                {phase === "confirming" && <Check className="w-12 h-12" />}
              </div>
              <div className="mt-4 text-xs uppercase tracking-[0.25em] text-gold-muted text-center min-h-[1.5rem]">
                {phase === "speaking" && "La IA sta leggendo…"}
                {phase === "listening" && "Parla ora — mi fermo da sola"}
                {phase === "transcribing" && "Sto trascrivendo…"}
                {phase === "confirming" && "Ok, passo al prossimo"}
              </div>
              {heard && (
                <div className="mt-3 px-3 py-2 bg-input border border-gold/30 rounded text-base text-foreground text-center max-w-full break-words">
                  {heard}
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button onClick={repeat} className="px-3 py-2.5 border border-gold/40 text-gold rounded-md text-[10px] uppercase tracking-widest">
                Ripeti campo
              </button>
              <button onClick={skip} className="px-3 py-2.5 border border-border text-muted-foreground rounded-md text-[10px] uppercase tracking-widest">
                Salta
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
