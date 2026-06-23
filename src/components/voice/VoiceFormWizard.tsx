import { useCallback, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Mic, SkipForward, X, Check, RotateCcw, Loader2, Square } from "lucide-react";
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

type Phase = "intro" | "ready" | "recording" | "transcribing" | "preview";

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
  const [phase, setPhase] = useState<Phase>("intro");
  const [transcript, setTranscript] = useState("");
  const [editing, setEditing] = useState("");

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  const field = fields[idx];
  const done = idx >= fields.length;

  const blob2b64 = (blob: Blob) =>
    new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve((r.result as string).split(",")[1] ?? "");
      r.onerror = () => reject(r.error);
      r.readAsDataURL(blob);
    });

  const cleanupStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    recorderRef.current = null;
  }, []);

  const speakPrompt = useCallback((text: string) => {
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = "it-IT";
      u.rate = 1.05;
      window.speechSynthesis.speak(u);
    } catch {}
  }, []);

  // Announce a new field
  useEffect(() => {
    if (done) {
      speakPrompt("Compilazione completata");
      return;
    }
    setTranscript("");
    setEditing("");
    setPhase("intro");
    const prompt = field.hint ? `${field.label}. ${field.hint}` : field.label;
    speakPrompt(prompt);
    const t = setTimeout(() => setPhase("ready"), 50);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx]);

  useEffect(() => () => {
    try { recorderRef.current?.stop(); } catch {}
    cleanupStream();
    try { window.speechSynthesis.cancel(); } catch {}
  }, [cleanupStream]);

  const startRecording = useCallback(async () => {
    try {
      window.speechSynthesis.cancel();
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mime = ["audio/webm", "audio/mp4"].find((m) => MediaRecorder.isTypeSupported(m)) ?? "";
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      recorderRef.current = rec;
      chunksRef.current = [];
      rec.ondataavailable = (e) => e.data.size > 0 && chunksRef.current.push(e.data);
      rec.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" });
        cleanupStream();
        if (blob.size < 1500) {
          toast.error("Audio troppo corto, riprova");
          setPhase("ready");
          return;
        }
        setPhase("transcribing");
        try {
          const audioBase64 = await blob2b64(blob);
          const { text } = await transcribe({
            data: { audioBase64, mime: blob.type || "audio/webm", language: "it" },
          });
          if (!text) {
            toast.error("Non ho capito, riprova");
            setPhase("ready");
            return;
          }
          const norm = normalize(text, field?.type);
          setTranscript(norm);
          setEditing(norm);
          setPhase("preview");
        } catch (e: any) {
          toast.error(e.message ?? "Errore trascrizione");
          setPhase("ready");
        }
      };
      rec.start();
      setPhase("recording");
    } catch {
      toast.error("Microfono non disponibile");
      setPhase("ready");
    }
  }, [cleanupStream, transcribe, field]);

  const stopRecording = useCallback(() => {
    try { recorderRef.current?.stop(); } catch {}
  }, []);

  const confirm = () => {
    if (!field) return;
    const value = editing.trim();
    if (!value) {
      toast.message("Vuoto, riprova o salta");
      setPhase("ready");
      return;
    }
    onChange(field.key, value);
    toast.success(`${field.label}: ${value}`);
    setIdx((i) => i + 1);
  };

  const skip = () => {
    try { recorderRef.current?.stop(); } catch {}
    cleanupStream();
    setIdx((i) => i + 1);
  };

  const repeat = () => {
    setTranscript("");
    setEditing("");
    setPhase("ready");
  };

  return (
    <div className="fixed inset-0 bg-black/85 backdrop-blur z-50 flex items-end md:items-center justify-center p-0 md:p-4">
      <div className="bg-card border-2 border-gold/60 rounded-t-2xl md:rounded-2xl p-5 w-full max-w-md space-y-4 shadow-2xl">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-display uppercase tracking-[0.3em] text-gold-muted">
            Dettatura {Math.min(idx + 1, fields.length)} / {fields.length}
          </span>
          <button
            onClick={() => {
              try { recorderRef.current?.stop(); } catch {}
              cleanupStream();
              window.speechSynthesis.cancel();
              onClose();
            }}
            className="text-gold-muted hover:text-gold"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {done ? (
          <div className="text-center py-6 space-y-3">
            <Check className="w-12 h-12 text-gold mx-auto" />
            <p className="font-display uppercase tracking-widest text-gold text-sm">Completato</p>
            <p className="text-xs text-muted-foreground">Controlla i campi e premi "Registra".</p>
            <button onClick={onClose} className="w-full bg-gradient-gold text-primary-foreground py-3 rounded-md font-display uppercase tracking-[0.3em] text-xs">
              Chiudi e salva
            </button>
          </div>
        ) : (
          <>
            <div>
              <div className="text-[10px] uppercase tracking-[0.3em] text-gold-muted">Campo</div>
              <div className="font-display text-2xl text-gold">{field.label}</div>
              {field.hint && <div className="text-xs text-muted-foreground mt-1">{field.hint}</div>}
            </div>

            <div className="bg-input border border-border rounded-md min-h-[5rem] p-3">
              {phase === "preview" ? (
                <>
                  <div className="text-[9px] uppercase tracking-widest text-gold-muted mb-1">Trascrizione (modificabile)</div>
                  <input
                    autoFocus
                    value={editing}
                    onChange={(e) => setEditing(e.target.value)}
                    className="w-full bg-transparent text-base text-foreground focus:outline-none"
                  />
                </>
              ) : (
                <>
                  <div className="text-[9px] uppercase tracking-widest text-gold-muted mb-1">Stato</div>
                  <div className="text-base text-foreground">
                    {phase === "intro" && <span className="italic text-muted-foreground">Sto leggendo il campo…</span>}
                    {phase === "ready" && <span className="italic text-muted-foreground">Premi il microfono e parla</span>}
                    {phase === "recording" && <span className="text-destructive flex items-center gap-2"><span className="w-2 h-2 bg-destructive rounded-full animate-pulse" /> Registrazione in corso…</span>}
                    {phase === "transcribing" && <span className="text-gold flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Trascrizione AI…</span>}
                  </div>
                </>
              )}
            </div>

            {/* Mic / Stop button */}
            {phase !== "preview" && (
              <div className="flex items-center justify-center">
                <button
                  onClick={phase === "recording" ? stopRecording : startRecording}
                  disabled={phase === "transcribing" || phase === "intro"}
                  className={
                    "w-20 h-20 rounded-full border-2 flex items-center justify-center transition shadow-xl " +
                    (phase === "recording"
                      ? "bg-destructive border-destructive text-white animate-pulse"
                      : phase === "transcribing"
                        ? "bg-card border-gold/40 text-gold"
                        : "bg-gradient-gold border-gold text-primary-foreground")
                  }
                >
                  {phase === "transcribing" ? <Loader2 className="w-8 h-8 animate-spin" />
                    : phase === "recording" ? <Square className="w-8 h-8" />
                    : <Mic className="w-8 h-8" />}
                </button>
              </div>
            )}
            {phase !== "preview" && (
              <div className="text-center text-[10px] uppercase tracking-widest text-gold-muted">
                {phase === "recording" ? "Premi per fermare" : "Premi per parlare"}
              </div>
            )}

            <div className="grid grid-cols-3 gap-2">
              <button onClick={repeat} disabled={phase === "transcribing" || phase === "recording"} className="px-3 py-2.5 border border-gold/40 text-gold rounded-md text-[10px] uppercase tracking-widest flex items-center justify-center gap-1 disabled:opacity-40">
                <RotateCcw className="w-3 h-3" /> Ripeti
              </button>
              <button onClick={skip} className="px-3 py-2.5 border border-border text-muted-foreground rounded-md text-[10px] uppercase tracking-widest flex items-center justify-center gap-1">
                <SkipForward className="w-3 h-3" /> Salta
              </button>
              <button onClick={confirm} disabled={phase !== "preview"} className="px-3 py-2.5 bg-gradient-gold text-primary-foreground rounded-md text-[10px] uppercase tracking-widest flex items-center justify-center gap-1 disabled:opacity-40">
                <Check className="w-3 h-3" /> OK
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
