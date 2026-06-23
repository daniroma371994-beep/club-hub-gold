import { useCallback, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Check, Loader2, Mic, Volume2, X } from "lucide-react";
import { toast } from "sonner";
import { transcribeVoice } from "@/lib/voice.functions";

export type WizardField = {
  key: string;
  label: string;
  type?: "text" | "date" | "email" | "phone" | "number";
  hint?: string;
};

type Phase = "waiting" | "preparing" | "speaking" | "listening" | "transcribing" | "confirming" | "done" | "error";

const SILENCE_MS = 1300;
const MAX_RECORD_MS = 12000;
const MIN_SPEECH_MS = 250;
const MIN_AUDIO_BYTES = 1200;

let warmedStream: MediaStream | null = null;
let warmupPromise: Promise<MediaStream> | null = null;

const micConstraints: MediaStreamConstraints = {
  audio: {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  },
};

export function warmUpVoiceForm() {
  try {
    if (window.speechSynthesis) {
      const unlock = new SpeechSynthesisUtterance(" ");
      unlock.lang = "it-IT";
      unlock.volume = 0;
      window.speechSynthesis.speak(unlock);
    }
  } catch {
    // speech unlock is best-effort
  }

  try {
    const live = warmedStream?.getAudioTracks().some((track) => track.readyState === "live");
    if (warmedStream && live) return Promise.resolve(warmedStream);
    if (warmedStream && !live) {
      warmedStream = null;
      warmupPromise = null;
    }
    if (!warmupPromise) {
      warmupPromise = navigator.mediaDevices.getUserMedia(micConstraints).then((stream) => {
        warmedStream = stream;
        return stream;
      }).catch((error) => {
        warmupPromise = null;
        throw error;
      });
    }
    return warmupPromise;
  } catch (error) {
    return Promise.reject(error);
  }
}

const unitWords: Record<string, number> = {
  zero: 0,
  un: 1,
  uno: 1,
  una: 1,
  due: 2,
  tre: 3,
  quattro: 4,
  cinque: 5,
  sei: 6,
  sette: 7,
  otto: 8,
  nove: 9,
  dieci: 10,
  undici: 11,
  dodici: 12,
  tredici: 13,
  quattordici: 14,
  quindici: 15,
  sedici: 16,
  diciassette: 17,
  diciotto: 18,
  diciannove: 19,
};

const tensWords: Record<string, number> = {
  venti: 20,
  trenta: 30,
  quaranta: 40,
  cinquanta: 50,
  sessanta: 60,
  settanta: 70,
  ottanta: 80,
  novanta: 90,
};

const digitWords: Record<string, string> = {
  zero: "0",
  un: "1",
  uno: "1",
  una: "1",
  due: "2",
  tre: "3",
  quattro: "4",
  cinque: "5",
  sei: "6",
  sette: "7",
  otto: "8",
  nove: "9",
};

const months: Record<string, string> = {
  gennaio: "01",
  febbraio: "02",
  marzo: "03",
  aprile: "04",
  maggio: "05",
  giugno: "06",
  luglio: "07",
  agosto: "08",
  settembre: "09",
  ottobre: "10",
  novembre: "11",
  dicembre: "12",
};

function cleanBase(text: string) {
  return text
    .trim()
    .replace(/[“”]/g, "\"")
    .replace(/[.,;!?]+$/g, "")
    .replace(/^(scrivi|inserisci|metti|campo|il campo|risposta)\s+/i, "")
    .trim();
}

function parseItalianInteger(text: string): number | null {
  const compact = text.toLowerCase().replace(/[^a-zàèéìòù\s]/g, " ").replace(/\s+/g, " ").trim();
  if (!compact) return null;
  if (/^\d+$/.test(compact)) return Number(compact);

  let total = 0;
  let current = 0;
  const words = compact.split(" ");

  for (const word of words) {
    if (unitWords[word] != null) {
      current += unitWords[word];
      continue;
    }
    if (tensWords[word] != null) {
      current += tensWords[word];
      continue;
    }

    const ten = Object.entries(tensWords).find(([prefix]) => word.startsWith(prefix.slice(0, -1)));
    if (ten) {
      const [prefix, value] = ten;
      const rest = word.replace(prefix.slice(0, -1), "").replace(/^[aei]/, "");
      current += value + (unitWords[rest] ?? 0);
      continue;
    }

    if (word === "cento" || word === "cento") {
      current = (current || 1) * 100;
      continue;
    }
    if (word.includes("cento")) {
      const before = word.split("cento")[0];
      const after = word.split("cento")[1];
      current += (unitWords[before] || 1) * 100;
      if (after) current += parseItalianInteger(after) ?? 0;
      continue;
    }
    if (word === "mille" || word === "mila") {
      total += (current || 1) * 1000;
      current = 0;
      continue;
    }
  }

  const result = total + current;
  return result > 0 || compact === "zero" ? result : null;
}

function normalizeNumber(text: string) {
  const raw = cleanBase(text).toLowerCase().replace(/€/g, " euro ");
  const tokens = raw.replace(/[.,]/g, " ").split(/\s+/).filter(Boolean);
  const digitSequence = tokens
    .filter((word) => !/^(euro|grammi?|pezzi?|giorni|numero)$/.test(word))
    .map((word) => digitWords[word] ?? (/^\d$/.test(word) ? word : ""));
  if (digitSequence.length > 1 && digitSequence.every(Boolean)) return digitSequence.join("");

  const digitMatch = raw.match(/\d+(?:[.,]\d+)?/);
  if (digitMatch) return digitMatch[0].replace(",", ".");

  const [intPart, decPart] = raw.split(/\s+virgola\s+|\s+punto\s+/);
  const intNum = parseItalianInteger(intPart.replace(/\beuro\b|\bgrammi?\b|\bpezzi?\b/g, ""));
  if (intNum == null) return cleanBase(text);
  if (!decPart) return String(intNum);

  const decimals = decPart
    .split(/\s+/)
    .map((word) => digitWords[word] ?? (/^\d$/.test(word) ? word : ""))
    .join("");
  return decimals ? `${intNum}.${decimals}` : String(intNum);
}

function normalizeDate(text: string) {
  const raw = cleanBase(text).toLowerCase();
  const numeric = raw.match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
  if (numeric) {
    const dd = numeric[1].padStart(2, "0");
    const mm = numeric[2].padStart(2, "0");
    let yy = numeric[3];
    if (yy.length === 2) yy = (Number(yy) > 30 ? "19" : "20") + yy;
    return `${yy}-${mm}-${dd}`;
  }

  for (const [monthName, monthNumber] of Object.entries(months)) {
    const monthIndex = raw.indexOf(monthName);
    if (monthIndex === -1) continue;
    const dayText = raw.slice(0, monthIndex).trim();
    const yearText = raw.slice(monthIndex + monthName.length).trim();
    const day = Number(dayText.match(/\d{1,2}/)?.[0] ?? parseItalianInteger(dayText));
    let year = Number(yearText.match(/\d{2,4}/)?.[0] ?? parseItalianInteger(yearText));
    if (!day || !year) return cleanBase(text);
    if (year < 100) year += year > 30 ? 1900 : 2000;
    return `${String(year).padStart(4, "0")}-${monthNumber}-${String(day).padStart(2, "0")}`;
  }

  return cleanBase(text);
}

function normalize(text: string, type?: WizardField["type"]): string {
  let t = cleanBase(text);
  if (!t) return "";

  if (type === "email") {
    return t
      .toLowerCase()
      .replace(/\b(chiocciola|at|arroba)\b/g, "@")
      .replace(/\b(punto|dot)\b/g, ".")
      .replace(/\b(trattino basso|underscore)\b/g, "_")
      .replace(/\b(trattino|meno)\b/g, "-")
      .replace(/\s+/g, "")
      .replace(/[^a-z0-9@._+-]/g, "");
  }

  if (type === "phone") {
    const digits = t
      .toLowerCase()
      .split(/[\s-]+/)
      .map((word) => digitWords[word] ?? word)
      .join("")
      .replace(/[^\d+]/g, "");
    return digits || t;
  }

  if (type === "number") return normalizeNumber(t);
  if (type === "date") return normalizeDate(t);

  return t.charAt(0).toUpperCase() + t.slice(1);
}

function voiceCommand(text: string): "skip" | "repeat" | "cancel" | null {
  const t = cleanBase(text).toLowerCase();
  if (/^(salta|passa oltre|prossimo|prossimo campo)$/.test(t)) return "skip";
  if (/^(ripeti|rifai|non va bene|correggi)$/.test(t)) return "repeat";
  if (/^(annulla|chiudi|fermati|stop)$/.test(t)) return "cancel";
  return null;
}

function mimeForRecording() {
  return ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find((mime) => MediaRecorder.isTypeSupported(mime));
}

function micErrorMessage(error: unknown) {
  const name = error instanceof DOMException ? error.name : "";
  if (name === "NotAllowedError") return "Microfono bloccato: autorizzalo dal browser e riprova.";
  if (name === "NotFoundError") return "Nessun microfono trovato.";
  if (name === "NotReadableError") return "Microfono già in uso da un'altra app.";
  return "Microfono non disponibile.";
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
  const transcribe = useServerFn(transcribeVoice);
  const [idx, setIdx] = useState(0);
  const [cycle, setCycle] = useState(0);
  const [started, setStarted] = useState(true);
  const [phase, setPhase] = useState<Phase>("preparing");
  const [heard, setHeard] = useState("");
  const [level, setLevel] = useState(0);
  const [error, setError] = useState("");

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);
  const maxTimerRef = useRef<number | null>(null);
  const closeTimerRef = useRef<number | null>(null);
  const runRef = useRef(0);
  const cancelledRef = useRef(false);
  const onChangeRef = useRef(onChange);
  const onCloseRef = useRef(onClose);

  const field = fields[idx];
  const finished = idx >= fields.length;

  useEffect(() => {
    onChangeRef.current = onChange;
    onCloseRef.current = onClose;
  }, [onChange, onClose]);

  const blob2b64 = useCallback(
    (blob: Blob) =>
      new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve((reader.result as string).split(",")[1] ?? "");
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
      }),
    [],
  );

  const cleanupRecording = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    if (maxTimerRef.current) window.clearTimeout(maxTimerRef.current);
    maxTimerRef.current = null;
    try {
      if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    } catch {
      // ignore recorder cleanup errors
    }
    recorderRef.current = null;
    try {
      audioCtxRef.current?.close();
    } catch {
      // ignore audio context cleanup errors
    }
    audioCtxRef.current = null;
  }, []);

  const releaseEverything = useCallback(() => {
    cancelledRef.current = true;
    runRef.current += 1;
    cleanupRecording();
    if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = null;
    try {
      window.speechSynthesis.cancel();
    } catch {
      // ignore speech cleanup errors
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    warmedStream = null;
    warmupPromise = null;
  }, [cleanupRecording]);

  const ensureMic = useCallback(async () => {
    const tracks = streamRef.current?.getAudioTracks() ?? [];
    const healthy = tracks.length > 0 && tracks.every((track) => track.readyState === "live" && !track.muted && track.enabled);

    if (streamRef.current && healthy) {
      console.log("[VoiceWizard] reusing existing mic stream");
      return streamRef.current;
    }

    const mime = mimeForRecording();
    if (!mime) throw new Error("Questo browser non registra un formato audio supportato.");

    // Stop dead/muted stream so we can grab a fresh one
    if (streamRef.current) {
      console.log("[VoiceWizard] mic stream stale, re-acquiring", {
        readyStates: tracks.map((t) => t.readyState),
        muted: tracks.map((t) => t.muted),
      });
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      warmedStream = null;
      warmupPromise = null;
    }

    const stream = await navigator.mediaDevices.getUserMedia(micConstraints);
    warmedStream = stream;
    streamRef.current = stream;
    console.log("[VoiceWizard] acquired fresh mic stream");
    return stream;
  }, []);

  const speak = useCallback((text: string) => {
    return new Promise<void>((resolve) => {
      let resolved = false;
      let fallbackTimer: number | null = null;
      const done = () => {
        if (resolved) return;
        resolved = true;
        if (fallbackTimer) window.clearTimeout(fallbackTimer);
        resolve();
      };

      try {
        if (!window.speechSynthesis) {
          done();
          return;
        }
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = "it-IT";
        utterance.rate = 1.15;
        utterance.pitch = 1;
        const voice = window.speechSynthesis.getVoices().find((v) => v.lang.toLowerCase().startsWith("it"));
        if (voice) utterance.voice = voice;
        utterance.onend = done;
        utterance.onerror = done;
        window.speechSynthesis.resume();
        window.speechSynthesis.speak(utterance);
        fallbackTimer = window.setTimeout(done, Math.min(5000, Math.max(1200, text.length * 70)));
      } catch {
        done();
      }
    });
  }, []);

  const retrySameField = useCallback(() => {
    cleanupRecording();
    setHeard("");
    setCycle((value) => value + 1);
  }, [cleanupRecording]);

  const startWizard = useCallback(async () => {
    setError("");
    setPhase("preparing");
    try {
      const stream = await warmUpVoiceForm();
      streamRef.current = stream;
      setStarted(true);
      setCycle((value) => value + 1);
    } catch (err) {
      const message = err instanceof DOMException ? micErrorMessage(err) : err instanceof Error ? err.message : micErrorMessage(err);
      setError(message);
      setPhase("error");
      toast.error(message);
    }
  }, []);

  const startRecording = useCallback(
    async (currentField: WizardField, runId: number) => {
      const stream = await ensureMic();
      if (cancelledRef.current || runRef.current !== runId) return;

      const mime = mimeForRecording();
      if (!mime) throw new Error("Formato audio non supportato.");

      chunksRef.current = [];
      const recorder = new MediaRecorder(stream, { mimeType: mime });
      recorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = async () => {
        cleanupRecording();
        if (cancelledRef.current || runRef.current !== runId) return;

        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || mime });
        console.log("[VoiceWizard] recorder stopped", { key: currentField.key, size: blob.size, chunks: chunksRef.current.length });
        if (blob.size < MIN_AUDIO_BYTES) {
          setPhase("speaking");
          await speak("Non ho sentito bene. Ripeti il campo.");
          if (!cancelledRef.current && runRef.current === runId) retrySameField();
          return;
        }

        setPhase("transcribing");
        try {
          const audioBase64 = await blob2b64(blob);
          const response = await transcribe({
            data: {
              audioBase64,
              mime: blob.type || mime,
              language: "it",
              prompt: `Campo: ${currentField.label}. Trascrivi solo la risposta dell'utente in italiano. Se è un numero, una email, una data o un telefono, mantieni il valore esatto.`,
            },
          });
          if (cancelledRef.current || runRef.current !== runId) return;

          const raw = response.text.trim();
          const command = voiceCommand(raw);
          if (command === "cancel") {
            await speak("Chiudo la compilazione vocale.");
            releaseEverything();
            onCloseRef.current();
            return;
          }
          if (command === "skip") {
            setPhase("confirming");
            await speak("Salto questo campo.");
            if (!cancelledRef.current && runRef.current === runId) setIdx((value) => value + 1);
            return;
          }
          if (command === "repeat") {
            setPhase("speaking");
            await speak("Va bene, ripeto il campo.");
            if (!cancelledRef.current && runRef.current === runId) retrySameField();
            return;
          }

          const normalized = normalize(raw, currentField.type);
          if (!normalized || normalized.toLowerCase() === "ok" || normalized.toLowerCase() === "okay") {
            setPhase("speaking");
            await speak("Non ho capito bene. Ripeti il campo.");
            if (!cancelledRef.current && runRef.current === runId) retrySameField();
            return;
          }

          setHeard(normalized);
          onChangeRef.current(currentField.key, normalized);
          setPhase("confirming");
          if (!cancelledRef.current && runRef.current === runId) {
            setIdx((value) => value + 1);
          }
        } catch (err: any) {
          const message = err?.message ?? "Errore trascrizione";
          toast.error(message);
          setPhase("speaking");
          await speak("Non ho capito bene. Ripeti il campo.");
          if (!cancelledRef.current && runRef.current === runId) retrySameField();
        }
      };

      const AudioCtor = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtor) throw new Error("Audio non supportato da questo browser.");
      const audioCtx = new AudioCtor();
      audioCtxRef.current = audioCtx;
      if (audioCtx.state === "suspended") await audioCtx.resume();
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 1024;
      source.connect(analyser);
      const buffer = new Float32Array(analyser.fftSize);
      const startedAt = performance.now();
      let lastVoiceAt = 0;
      let hasSpoken = false;
      let noiseFloor = 0.006;

      const stopRecorder = () => {
        try {
          if (recorder.state === "recording") recorder.stop();
        } catch {
          // ignore stop errors
        }
      };

      const tick = () => {
        if (cancelledRef.current || runRef.current !== runId || recorder.state !== "recording") return;
        analyser.getFloatTimeDomainData(buffer);
        let sum = 0;
        for (let i = 0; i < buffer.length; i += 1) sum += buffer[i] * buffer[i];
        const rms = Math.sqrt(sum / buffer.length);
        setLevel(rms);

        const threshold = Math.max(0.009, noiseFloor + 0.008);
        const now = performance.now();
        if (!hasSpoken) noiseFloor = noiseFloor * 0.96 + Math.min(rms, 0.035) * 0.04;

        if (rms > threshold) {
          lastVoiceAt = now;
          if (now - startedAt > MIN_SPEECH_MS) hasSpoken = true;
        }

        if (hasSpoken && lastVoiceAt && now - lastVoiceAt >= SILENCE_MS) {
          stopRecorder();
          return;
        }
        rafRef.current = requestAnimationFrame(tick);
      };

      recorder.start(250);
      setPhase("listening");
      rafRef.current = requestAnimationFrame(tick);
      maxTimerRef.current = window.setTimeout(stopRecorder, MAX_RECORD_MS);
    },
    [blob2b64, cleanupRecording, ensureMic, releaseEverything, retrySameField, speak, transcribe],
  );

  useEffect(() => {
    cancelledRef.current = false;
    setError("");

    if (!started) {
      setPhase("waiting");
      return undefined;
    }

    if (finished) {
      setPhase("done");
      const runId = ++runRef.current;
      (async () => {
        await speak("Compilazione completata.");
        if (!cancelledRef.current && runRef.current === runId) {
          closeTimerRef.current = window.setTimeout(() => onCloseRef.current(), 900);
        }
      })();
      return () => {
        if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current);
      };
    }

    const currentField = fields[idx];
    if (!currentField) return undefined;

    const runId = ++runRef.current;
    setHeard("");
    setLevel(0);
    setPhase("preparing");

    (async () => {
      try {
        await ensureMic();
        if (cancelledRef.current || runRef.current !== runId) return;
        setPhase("speaking");
        const prompt = currentField.hint ? `${currentField.label}. ${currentField.hint}.` : `${currentField.label}.`;
        console.log("[VoiceWizard] speaking prompt for", currentField.key);
        await speak(prompt);
        if (cancelledRef.current || runRef.current !== runId) return;
        // Give the mic a moment to recover from echo cancellation duck after TTS
        await new Promise((r) => window.setTimeout(r, 350));
        if (cancelledRef.current || runRef.current !== runId) return;
        // Re-check mic is still healthy before recording (it may have been muted during TTS)
        await ensureMic();
        if (cancelledRef.current || runRef.current !== runId) return;
        console.log("[VoiceWizard] starting recorder for", currentField.key);
        await startRecording(currentField, runId);
      } catch (err) {
        console.error("[VoiceWizard] field flow error", err);
        const message = err instanceof DOMException ? micErrorMessage(err) : err instanceof Error ? err.message : micErrorMessage(err);
        setError(message);
        setPhase("error");
        toast.error(message);
      }
    })();

    return () => {
      cancelledRef.current = true;
      cleanupRecording();
      try {
        window.speechSynthesis.cancel();
      } catch {
        // ignore speech cleanup errors
      }
    };
  }, [cleanupRecording, cycle, fields, finished, idx, ensureMic, speak, startRecording, started]);

  useEffect(() => () => releaseEverything(), [releaseEverything]);

  const close = () => {
    releaseEverything();
    onCloseRef.current();
  };

  const meter = Math.min(1, level * 18);

  return (
    <div className="fixed inset-0 bg-background/96 backdrop-blur-xl z-50 flex items-end md:items-center justify-center p-0 md:p-4">
      <div className="bg-card/95 border-2 border-gold/60 rounded-t-3xl md:rounded-3xl p-5 md:p-7 w-full max-w-xl max-h-[92vh] overflow-y-auto space-y-5 shadow-2xl">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-display uppercase tracking-[0.3em] text-gold-muted">
            Meduza Voice · Alexa club {Math.min(idx + 1, fields.length)} / {fields.length}
          </span>
          <button type="button" onClick={close} className="text-gold-muted hover:text-gold" aria-label="Chiudi dettatura">
            <X className="w-4 h-4" />
          </button>
        </div>

        {finished ? (
          <div className="text-center py-6 space-y-3">
            <Check className="w-12 h-12 text-gold mx-auto" />
            <p className="font-display uppercase tracking-widest text-gold text-sm">Completato</p>
          </div>
        ) : (
          <>
            <div className="text-center">
              <div className="text-[10px] uppercase tracking-[0.3em] text-gold-muted">Campo</div>
              <div className="font-display text-3xl md:text-4xl text-gold mt-1">{field?.label}</div>
              {field?.hint && <div className="text-xs text-muted-foreground mt-1">{field.hint}</div>}
            </div>

            <div className="flex flex-col items-center justify-center py-3">
              <div
                className={
                  "w-32 h-32 md:w-36 md:h-36 rounded-full flex items-center justify-center border-4 transition shadow-[0_0_60px_-18px_var(--gold)] " +
                  (phase === "listening"
                    ? "border-destructive bg-destructive/10 text-destructive"
                    : phase === "transcribing"
                      ? "border-gold/60 bg-card text-gold"
                      : phase === "confirming" || phase === "done"
                        ? "border-gold bg-gradient-gold text-primary-foreground"
                        : "border-gold/70 bg-card text-gold")
                }
                style={phase === "listening" ? { transform: `scale(${1 + meter * 0.32})` } : undefined}
              >
                {(phase === "waiting" || phase === "preparing" || phase === "transcribing") && <Loader2 className="w-14 h-14 animate-spin" />}
                {phase === "speaking" && <Volume2 className="w-14 h-14 animate-pulse" />}
                {phase === "listening" && <Mic className="w-14 h-14" />}
                {phase === "confirming" && <Check className="w-14 h-14" />}
                {phase === "error" && <X className="w-14 h-14" />}
              </div>

              <div className="mt-4 text-xs uppercase tracking-[0.25em] text-gold-muted text-center min-h-[1.5rem] leading-relaxed">
                {phase === "waiting" && "Pronto"}
                {phase === "preparing" && "Preparo il microfono…"}
                {phase === "speaking" && "La IA legge il campo…"}
                {phase === "listening" && "Parla ora — chiudo dopo 3 secondi di silenzio"}
                {phase === "transcribing" && "Sto capendo la tua voce…"}
                {phase === "confirming" && "Ok, passo al prossimo campo"}
                {phase === "error" && "Serve il microfono"}
              </div>

              {heard && (
                <div className="mt-3 px-3 py-2 bg-input border border-gold/30 rounded text-base text-foreground text-center max-w-full break-words">
                  {heard}
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {fields.map((item, itemIndex) => (
                <div
                  key={item.key}
                  className={
                    "rounded-xl border px-3 py-2 min-h-14 " +
                    (itemIndex < idx
                      ? "border-gold/40 bg-gold/10 text-gold"
                      : itemIndex === idx
                        ? "border-gold/70 bg-input text-foreground"
                        : "border-border bg-input/40 text-muted-foreground")
                  }
                >
                  <div className="text-[9px] uppercase tracking-[0.2em]">{itemIndex + 1}</div>
                  <div className="text-xs font-display uppercase tracking-wider leading-tight mt-1">{item.label}</div>
                </div>
              ))}
            </div>

            {error ? (
              <button
                type="button"
                onClick={startWizard}
                className="w-full bg-gradient-gold text-primary-foreground py-3 rounded-md font-display uppercase tracking-[0.3em] text-xs"
              >
                Riprova microfono
              </button>
            ) : (
              <div className="rounded-md border border-gold/20 bg-input/50 px-3 py-2 text-center text-[11px] text-muted-foreground">
                Compilazione continua: ascolto ogni campo in ordine. Puoi dire “salta”, “ripeti” o “annulla”.
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}