import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { Mic, Square, Loader2, X, Trash2, Volume2 } from "lucide-react";
import { toast } from "sonner";
import { agentRespond, transcribeAudio, synthesizeSpeech } from "@/lib/voice-agent.functions";

type Status = "idle" | "recording" | "processing" | "speaking";
type Msg = { role: "user" | "assistant"; content: string };

function pickMime(): string | null {
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/mpeg"];
  for (const t of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(t)) return t;
  }
  return null;
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
  return btoa(bin);
}

// Client-side navigation intents (so home wake word can dispatch commands quickly).
const NAV_INTENTS: Array<{ to: string; rx: RegExp; label: string }> = [
  { to: "/productos", rx: /\b(producto|productos|prodotti|inventario|stock)\b/i, label: "Productos" },
  { to: "/caja", rx: /\b(caja|cassa|cash|ventas del d[ií]a|informe)\b/i, label: "Caja" },
  { to: "/ajustes", rx: /\b(ajustes|configuraci[oó]n|settings|impostazioni)\b/i, label: "Ajustes" },
  { to: "/ajustes/cuotas", rx: /\b(cuotas|cuotas? mensual|planes)\b/i, label: "Cuotas" },
  { to: "/ajustes/colaboradores", rx: /\b(colaboradores|colaborador|colaboradoras|staff|equipo)\b/i, label: "Colaboradores" },
  { to: "/soci/nuovo", rx: /\b(nuevo socio|crear socio|alta socio|registrar socio)\b/i, label: "Nuevo socio" },
  { to: "/soci/gestisci", rx: /\b(gestionar socios?|buscar socios?|socios|ver socios)\b/i, label: "Gestionar socios" },
  { to: "/", rx: /\b(inicio|home|principal|men[uú] principal)\b/i, label: "Inicio" },
];

export function VoiceAgent({ clubName }: { clubName?: string | null } = {}) {
  const [status, setStatus] = useState<Status>("idle");
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const wakeRef = useRef<any>(null);
  const wakeActiveRef = useRef(false);
  const navigate = useNavigate();
  const location = useLocation();

  const transcribe = useServerFn(transcribeAudio);
  const respond = useServerFn(agentRespond);
  const tts = useServerFn(synthesizeSpeech);

  useEffect(() => () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    try { wakeRef.current?.stop?.(); } catch {}
    audioRef.current?.pause();
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, status]);

  // External trigger (e.g. SnoopLayout buttons)
  useEffect(() => {
    function onStart() { if (status === "idle") startRec(); }
    window.addEventListener("snoop:voice-start", onStart);
    return () => window.removeEventListener("snoop:voice-start", onStart);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  // Wake-word listener — ONLY on home route, using Web Speech API
  useEffect(() => {
    const isHome = location.pathname === "/";
    const SR: any =
      typeof window !== "undefined"
        ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
        : null;
    if (!isHome || !SR) {
      try { wakeRef.current?.stop?.(); } catch {}
      wakeRef.current = null;
      wakeActiveRef.current = false;
      return;
    }
    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = "es-ES";
    rec.onresult = (e: any) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = String(e.results[i][0].transcript || "").toLowerCase();
        if (/\b(hola|oye|hey|ok)\s*,?\s*snoop\b/.test(t)) {
          try { rec.stop(); } catch {}
          wakeActiveRef.current = false;
          handleWake();
          return;
        }
      }
    };
    rec.onend = () => {
      // Auto-restart wake listener while we're on home and not busy
      if (wakeActiveRef.current && location.pathname === "/") {
        try { rec.start(); } catch {}
      }
    };
    rec.onerror = () => { /* swallow no-speech / aborted */ };

    wakeRef.current = rec;
    wakeActiveRef.current = true;
    try { rec.start(); } catch {}

    return () => {
      wakeActiveRef.current = false;
      try { rec.stop(); } catch {}
      wakeRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  function stopSpeaking() {
    const a = audioRef.current;
    if (a) {
      a.pause();
      a.currentTime = 0;
    }
    if (status === "speaking") setStatus("idle");
  }

  async function speak(text: string) {
    try {
      stopSpeaking();
      setStatus("speaking");
      const { audioBase64, mimeType } = await tts({ data: { text } });
      const audio = new Audio(`data:${mimeType};base64,${audioBase64}`);
      audioRef.current = audio;
      audio.onended = () => { if (status !== "recording") setStatus("idle"); };
      await audio.play().catch(() => {});
    } catch (e: any) {
      console.warn("TTS error:", e?.message);
      setStatus("idle");
    }
  }

  async function handleWake() {
    setOpen(true);
    const greet = `¡Hola${clubName ? " " + clubName : ""}! ¿En qué te puedo ayudar?`;
    setMessages((m) => [...m, { role: "assistant", content: greet }]);
    await speak(greet);
    // After greeting, open the mic automatically
    setTimeout(() => { if (status !== "recording") startRec(); }, 250);
  }

  async function startRec() {
    try {
      stopSpeaking();
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mime = pickMime();
      if (!mime) {
        stream.getTracks().forEach((t) => t.stop());
        toast.error("Este navegador no soporta grabación de audio compatible.");
        return;
      }
      const rec = new MediaRecorder(stream, { mimeType: mime });
      chunksRef.current = [];
      rec.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        const blob = new Blob(chunksRef.current, { type: rec.mimeType });
        if (blob.size < 1500) {
          setStatus("idle");
          toast.error("No te he oído, vuelve a intentar.");
          return;
        }
        setStatus("processing");
        try {
          const b64 = await blobToBase64(blob);
          const { text } = await transcribe({ data: { audioBase64: b64, mimeType: rec.mimeType } });
          if (!text) { setStatus("idle"); toast.error("No se entendió nada."); return; }
          const history = messages;
          setMessages((m) => [...m, { role: "user", content: text }]);

          // Route-specific shortcuts
          if (location.pathname === "/soci/nuovo") {
            window.localStorage.setItem("snoop:new-member-transcript", JSON.stringify({ text, at: Date.now() }));
            window.dispatchEvent(new StorageEvent("storage", {
              key: "snoop:new-member-transcript",
              newValue: JSON.stringify({ text, at: Date.now() }),
            }));
            const reply = "Perfecto, voy rellenando las casillas.";
            setMessages((m) => [...m, { role: "assistant", content: reply }]);
            speak(reply);
            return;
          }

          if (location.pathname === "/soci/gestisci" || location.pathname === "/soci") {
            const cleaned = text
              .replace(/^(buscar?|busca|buscame|encuentra|encontrar|cerca|cercar|trova|trovami|busca a|busca el|busca la)\s+/i, "")
              .replace(/[.,;:!?]+$/g, "")
              .trim();
            window.dispatchEvent(new CustomEvent("snoop:search-members", { detail: { query: cleaned } }));
            const reply = `Buscando ${cleaned}.`;
            setMessages((m) => [...m, { role: "assistant", content: reply }]);
            speak(reply);
            return;
          }

          if (/^\/soci\/[^/]+\/pedido/.test(location.pathname)) {
            window.dispatchEvent(new CustomEvent("snoop:pedido-transcript", { detail: { text } }));
            return;
          }

          if (location.pathname.startsWith("/soci/") && location.pathname !== "/soci/nuovo" && location.pathname !== "/soci/gestisci") {
            const lower = text.toLowerCase();
            if (/(hacer|nuevo|crear)\s+(un\s+)?(pedido|orden|ordine)/i.test(lower) || /^(pedido|ordine|orden)\.?$/i.test(lower.trim())) {
              window.dispatchEvent(new CustomEvent("snoop:member-action", { detail: { action: "order" } }));
              const r = "Abro un pedido."; setMessages((m) => [...m, { role: "assistant", content: r }]); speak(r);
              return;
            }
            if (/(renovar|renueva|rinnova)/i.test(lower)) {
              window.dispatchEvent(new CustomEvent("snoop:member-action", { detail: { action: "renew" } }));
              const r = "Renovando."; setMessages((m) => [...m, { role: "assistant", content: r }]); speak(r);
              return;
            }
            if (/(volver|atr[aá]s|indietro|back)/i.test(lower)) {
              navigate({ to: "/soci/gestisci" });
              return;
            }
          }

          // From home: try a client-side navigation intent first (fast & cheap)
          if (location.pathname === "/") {
            const lower = text.toLowerCase();
            const hit = NAV_INTENTS.find((n) => n.rx.test(lower));
            if (hit) {
              const r = `Voy a ${hit.label}.`;
              setMessages((m) => [...m, { role: "assistant", content: r }]);
              await speak(r);
              navigate({ to: hit.to as any });
              return;
            }
          }

          // Fallback: full agent
          const { reply, navigateTo } = await respond({ data: { transcript: text, history } });
          setMessages((m) => [...m, { role: "assistant", content: reply }]);
          speak(reply);
          if (navigateTo) {
            setTimeout(() => navigate({ to: navigateTo as any }), 1200);
          }
        } catch (e: any) {
          toast.error(e.message ?? "Error en el asistente");
          setStatus("idle");
        } finally {
          if (status !== "speaking") setStatus("idle");
        }
      };
      recorderRef.current = rec;
      rec.start();
      setStatus("recording");
      setOpen(true);
    } catch {
      toast.error("Permiso de micrófono denegado.");
    }
  }

  function stopRec() { recorderRef.current?.stop(); }
  function toggle() {
    if (status === "recording") stopRec();
    else if (status === "speaking") { stopSpeaking(); startRec(); }
    else if (status === "processing") return;
    else startRec();
  }

  const ringClass =
    status === "recording" ? "bg-destructive text-destructive-foreground animate-pulse shadow-[0_0_40px_-5px_oklch(0.65_0.25_25)]"
    : status === "speaking" ? "bg-gradient-neon text-primary-foreground glow-neon animate-pulse"
    : "bg-gradient-neon text-primary-foreground glow-neon";

  return (
    <>
      <button
        type="button"
        onClick={toggle}
        disabled={status === "processing"}
        aria-label={status === "recording" ? "Detener" : "Hablar con Snoop"}
        className={`fixed z-40 bottom-5 right-5 md:bottom-8 md:right-8 h-16 w-16 rounded-full flex items-center justify-center transition-all ${ringClass} disabled:opacity-60`}
      >
        {status === "processing" ? <Loader2 className="w-6 h-6 animate-spin" />
          : status === "recording" ? <Square className="w-6 h-6" />
          : status === "speaking" ? <Volume2 className="w-6 h-6" />
          : <Mic className="w-7 h-7" />}
      </button>

      {open && (messages.length > 0 || status !== "idle") && (
        <div className="fixed z-40 bottom-24 right-3 md:right-8 w-[min(92vw,400px)] rounded-2xl border border-neon/40 bg-card/95 backdrop-blur-xl shadow-2xl glow-neon-soft overflow-hidden flex flex-col">
          <div className="flex items-center justify-between px-4 py-2 border-b border-neon/20">
            <span className="text-[10px] uppercase tracking-[0.3em] text-neon-dim font-display">Snoop</span>
            <div className="flex items-center gap-2">
              {messages.length > 0 && (
                <button
                  onClick={() => { setMessages([]); stopSpeaking(); }}
                  className="text-muted-foreground hover:text-neon"
                  aria-label="Reiniciar"
                  title="Reiniciar"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
              <button onClick={() => { setOpen(false); stopSpeaking(); }} className="text-muted-foreground hover:text-neon" aria-label="Cerrar">
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
          <div ref={scrollRef} className="p-4 space-y-3 max-h-[60vh] overflow-y-auto">
            {messages.map((m, i) => (
              <div key={i}>
                <div className={`text-[10px] uppercase tracking-widest mb-1 ${m.role === "user" ? "text-neon-dim" : "text-neon"}`}>
                  {m.role === "user" ? "Tú" : "Snoop"}
                </div>
                <p className={`text-sm whitespace-pre-wrap ${m.role === "user" ? "text-muted-foreground italic" : "text-foreground"}`}>
                  {m.role === "user" ? `"${m.content}"` : m.content}
                </p>
              </div>
            ))}
            {status === "recording" && (
              <p className="text-xs text-destructive animate-pulse">● Escuchando… pulsa para parar.</p>
            )}
            {status === "processing" && (
              <p className="text-xs text-neon-dim flex items-center gap-2"><Loader2 className="w-3 h-3 animate-spin" /> Procesando…</p>
            )}
            {status === "speaking" && (
              <p className="text-xs text-neon flex items-center gap-2"><Volume2 className="w-3 h-3" /> Hablando… pulsa para interrumpir.</p>
            )}
            {location.pathname === "/" && status === "idle" && messages.length === 0 && (
              <p className="text-[11px] text-neon-dim">Di <span className="text-neon">"Hola Snoop"</span> o pulsa el micro.</p>
            )}
          </div>
        </div>
      )}
    </>
  );
}
