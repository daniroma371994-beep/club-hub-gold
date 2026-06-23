import { useCallback, useEffect, useRef, useState } from "react";
import { Mic, MicOff, SkipForward, X, Check, RotateCcw } from "lucide-react";
import { toast } from "sonner";

export type WizardField = {
  key: string;
  label: string;
  type?: "text" | "date" | "email" | "phone" | "number";
  hint?: string;
};

function normalize(text: string, type?: WizardField["type"]): string {
  let t = text.trim();
  if (!t) return "";
  // Strip trailing punctuation
  t = t.replace(/[.,;!?]+$/g, "").trim();

  if (type === "email") {
    t = t.toLowerCase()
      .replace(/\s+arroba\s+/g, "@")
      .replace(/\s+chiocciola\s+/g, "@")
      .replace(/\s+at\s+/g, "@")
      .replace(/\s+punto\s+/g, ".")
      .replace(/\s+dot\s+/g, ".")
      .replace(/\s+/g, "");
    return t;
  }
  if (type === "phone" || type === "number") {
    const map: Record<string, string> = {
      zero: "0", uno: "1", due: "2", tre: "3", quattro: "4",
      cinque: "5", sei: "6", sette: "7", otto: "8", nove: "9",
    };
    const tokens = t.toLowerCase().split(/[\s-]+/);
    const digits = tokens.map((w) => map[w] ?? w).join("");
    const onlyDigits = digits.replace(/[^\d+]/g, "");
    return onlyDigits || t;
  }
  if (type === "date") {
    // Try to parse "12 marzo 1990" / "12/03/1990"
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
  // Capitalize first letter for names
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export function VoiceFormWizard({
  fields,
  onChange,
  onClose,
}: {
  fields: WizardField[];
  onChange: (key: string, value: string) => void;
  onClose: () => void;
}) {
  const [idx, setIdx] = useState(0);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [captured, setCaptured] = useState("");
  const [speaking, setSpeaking] = useState(false);

  const srRef = useRef<any>(null);
  const supported = typeof window !== "undefined" &&
    !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);

  const field = fields[idx];
  const done = idx >= fields.length;

  const speak = useCallback((text: string, then?: () => void) => {
    try {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = "it-IT";
      u.rate = 1.05;
      setSpeaking(true);
      u.onend = () => { setSpeaking(false); then?.(); };
      u.onerror = () => { setSpeaking(false); then?.(); };
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
    } catch {
      setSpeaking(false);
      then?.();
    }
  }, []);

  const stopListening = useCallback(() => {
    try { srRef.current?.stop(); } catch {}
    setListening(false);
  }, []);

  const startListening = useCallback(() => {
    if (!field) return;
    const SR: any = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return toast.error("Voce non supportata. Usa Chrome.");
    try { srRef.current?.stop(); } catch {}
    setInterim("");
    setCaptured("");
    const sr = new SR();
    sr.lang = "it-IT";
    sr.continuous = false;
    sr.interimResults = true;
    sr.onstart = () => setListening(true);
    sr.onresult = (ev: any) => {
      let iStr = "", fStr = "";
      for (let i = 0; i < ev.results.length; i++) {
        const t = ev.results[i][0].transcript;
        if (ev.results[i].isFinal) fStr += t; else iStr += t;
      }
      setInterim(iStr);
      if (fStr) setCaptured((p) => (p + " " + fStr).trim());
    };
    sr.onerror = (e: any) => {
      setListening(false);
      if (e.error === "not-allowed") toast.error("Microfono bloccato");
      else if (e.error === "no-speech") toast.message("Non ho sentito");
      else if (e.error !== "aborted") toast.error(`Errore: ${e.error}`);
    };
    sr.onend = () => {
      setListening(false);
    };
    srRef.current = sr;
    try { sr.start(); } catch { setListening(false); }
  }, [field]);

  // When moving to a new field, announce it then start listening
  useEffect(() => {
    if (done) {
      speak("Compilazione completata");
      return;
    }
    setCaptured("");
    setInterim("");
    const prompt = field.hint ? `${field.label}. ${field.hint}` : field.label;
    speak(prompt, () => startListening());
    return () => {
      try { srRef.current?.stop(); } catch {}
      window.speechSynthesis.cancel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx]);

  const confirm = () => {
    if (!field) return;
    const value = normalize(captured || interim, field.type);
    if (!value) {
      toast.message("Niente da salvare, ripeti o salta");
      return;
    }
    onChange(field.key, value);
    toast.success(`${field.label}: ${value}`);
    setIdx((i) => i + 1);
  };

  const skip = () => { stopListening(); setIdx((i) => i + 1); };
  const repeat = () => { stopListening(); setCaptured(""); setInterim(""); startListening(); };

  if (!supported) {
    return (
      <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4">
        <div className="bg-card border border-gold/40 rounded-xl p-6 max-w-sm text-center space-y-4">
          <MicOff className="w-10 h-10 text-gold mx-auto" />
          <p className="text-sm">Il tuo browser non supporta la dettatura. Usa Chrome su Android o desktop.</p>
          <button onClick={onClose} className="px-4 py-2 border border-gold text-gold rounded-md text-xs uppercase tracking-widest">Chiudi</button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/85 backdrop-blur z-50 flex items-end md:items-center justify-center p-0 md:p-4">
      <div className="bg-card border-2 border-gold/60 rounded-t-2xl md:rounded-2xl p-5 w-full max-w-md space-y-4 shadow-2xl">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-display uppercase tracking-[0.3em] text-gold-muted">
            Dettatura {Math.min(idx + 1, fields.length)} / {fields.length}
          </span>
          <button onClick={() => { stopListening(); window.speechSynthesis.cancel(); onClose(); }} className="text-gold-muted hover:text-gold">
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

            <div className="bg-input border border-border rounded-md px-3 py-4 min-h-[4rem]">
              <div className="text-[9px] uppercase tracking-widest text-gold-muted mb-1">Stai dicendo</div>
              <div className="text-base text-foreground leading-snug">
                {captured}
                {interim && <span className="text-gold-muted italic"> {interim}</span>}
                {!captured && !interim && (
                  <span className="text-muted-foreground italic text-sm">
                    {speaking ? "…" : listening ? "Parla ora…" : "In attesa"}
                  </span>
                )}
              </div>
            </div>

            <div className="flex items-center justify-center">
              <button
                onClick={listening ? stopListening : startListening}
                disabled={speaking}
                className={
                  "w-16 h-16 rounded-full border-2 flex items-center justify-center transition " +
                  (listening
                    ? "bg-destructive border-destructive text-white animate-pulse"
                    : "bg-gradient-gold border-gold text-primary-foreground")
                }
              >
                <Mic className="w-7 h-7" />
              </button>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <button onClick={repeat} className="px-3 py-2.5 border border-gold/40 text-gold rounded-md text-[10px] uppercase tracking-widest flex items-center justify-center gap-1">
                <RotateCcw className="w-3 h-3" /> Ripeti
              </button>
              <button onClick={skip} className="px-3 py-2.5 border border-border text-muted-foreground rounded-md text-[10px] uppercase tracking-widest flex items-center justify-center gap-1">
                <SkipForward className="w-3 h-3" /> Salta
              </button>
              <button onClick={confirm} disabled={!captured && !interim} className="px-3 py-2.5 bg-gradient-gold text-primary-foreground rounded-md text-[10px] uppercase tracking-widest flex items-center justify-center gap-1 disabled:opacity-40">
                <Check className="w-3 h-3" /> OK
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
