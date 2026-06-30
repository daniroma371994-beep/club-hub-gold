import { useEffect, useRef, useState, useCallback } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { Mic, MicOff, Loader2, X, Trash2, Volume2, Ear } from "lucide-react";
import { toast } from "sonner";
import { agentRespond, synthesizeSpeech } from "@/lib/voice-agent.functions";

type Status = "off" | "listening" | "processing" | "speaking";
type Msg = { role: "user" | "assistant"; content: string };

// Client-side navigation intents (so home wake word can dispatch commands quickly).
// Order matters: more specific intents first.
const NAV_INTENTS: Array<{ to: string; rx: RegExp; label: string; tab?: string }> = [
  { to: "/productos", rx: /\b(crear?|nuevo|alta|nueva|a[nñ]adir|agregar|registrar)\s+(un\s+)?producto\b/i, label: "Crear producto", tab: "nuevo" },
  { to: "/productos", rx: /\b(crear?|nueva|alta|a[nñ]adir|agregar)\s+(una\s+)?categor[ií]a\b/i, label: "Crear categoría", tab: "categoria" },
  { to: "/soci/nuovo", rx: /\b(nuevo socio|crear socio|alta socio|registrar socio)\b/i, label: "Nuevo socio" },
  { to: "/soci/gestisci", rx: /\b(gestionar socios?|buscar socios?|socios|ver socios)\b/i, label: "Gestionar socios" },
  { to: "/ajustes/cuotas", rx: /\b(cuotas|cuotas? mensual|planes)\b/i, label: "Cuotas" },
  { to: "/ajustes/colaboradores", rx: /\b(colaboradores|colaborador|colaboradoras|staff|equipo)\b/i, label: "Colaboradores" },
  { to: "/ajustes", rx: /\b(ajustes|configuraci[oó]n|settings|impostazioni)\b/i, label: "Ajustes" },
  { to: "/caja", rx: /\b(caja|cassa|cash|ventas del d[ií]a|informe)\b/i, label: "Caja" },
  { to: "/productos", rx: /\b(producto|productos|prodotti|inventario|stock)\b/i, label: "Productos" },
  { to: "/", rx: /\b(inicio|home|principal|men[uú] principal)\b/i, label: "Inicio" },
];

// Acepta "snoop ..." a secas, además de "hola/oye/hey/ok snoop".
const WAKE_RX = /\b(?:hola|oye|hey|ok|okay|vale)?\s*,?\s*snoop\b[\s,:]*/i;

function getSpeechRecognition(): any {
  if (typeof window === "undefined") return null;
  return (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition || null;
}

export function VoiceAgent({ clubName }: { clubName?: string | null } = {}) {
  const [status, setStatus] = useState<Status>("off");
  const [enabled, setEnabled] = useState(false); // always-on toggle
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [interim, setInterim] = useState("");
  const recRef = useRef<any>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const wantOnRef = useRef(false);
  const processingRef = useRef(false);
  const speakingRef = useRef(false);
  const greetedRef = useRef(false);
  const muteUntilRef = useRef(0);
  const navigate = useNavigate();
  const location = useLocation();
  const locRef = useRef(location);
  const messagesRef = useRef<Msg[]>([]);
  useEffect(() => { locRef.current = location; }, [location]);
  useEffect(() => { messagesRef.current = messages; }, [messages]);

  const respond = useServerFn(agentRespond);
  const tts = useServerFn(synthesizeSpeech);

  // --- TTS playback with barge-in ---
  const stopSpeaking = useCallback(() => {
    const a = audioRef.current;
    if (a) { try { a.pause(); a.currentTime = 0; } catch {} }
    speakingRef.current = false;
    setStatus((s) => (s === "speaking" ? (wantOnRef.current ? "listening" : "off") : s));
  }, []);

  const speak = useCallback(async (text: string) => {
    try {
      stopSpeaking();
      speakingRef.current = true;
      setStatus("speaking");
      const { audioBase64, mimeType } = await tts({ data: { text } });
      if (!speakingRef.current) return; // got interrupted while loading
      const audio = new Audio(`data:${mimeType};base64,${audioBase64}`);
      audioRef.current = audio;
      audio.onended = () => {
        speakingRef.current = false;
        muteUntilRef.current = Date.now() + 700; // ignora eco residual
        setStatus(wantOnRef.current ? "listening" : "off");
      };
      await audio.play().catch(() => {});
    } catch (e: any) {
      console.warn("TTS error:", e?.message);
      speakingRef.current = false;
      setStatus(wantOnRef.current ? "listening" : "off");
    }
  }, [stopSpeaking, tts]);

  // --- Process a final transcript ---
  const handleTranscript = useCallback(async (raw: string) => {
    const text = raw.trim();
    if (!text) return;
    if (processingRef.current) return;
    processingRef.current = true;
    setStatus("processing");
    setOpen(true);
    setInterim("");
    setMessages((m) => [...m, { role: "user", content: text }]);

    try {
      const path = locRef.current.pathname;
      const lower = text.toLowerCase();

      // --- 1) Global navigation intents (always win — user said a section name) ---
      const navHit = NAV_INTENTS.find((n) => n.rx.test(lower));
      if (navHit) {
        setMessages((m) => [...m, { role: "assistant", content: `→ ${navHit.label}` }]);
        if (navHit.tab) {
          try { window.localStorage.setItem("snoop:productos-tab", navHit.tab); } catch {}
          // Forward the full transcript so the destination page can auto-parse it
          try { window.localStorage.setItem("snoop:productos-cmd", JSON.stringify({ text, at: Date.now() })); } catch {}
        }
        if (path !== navHit.to) navigate({ to: navHit.to as any });
        else {
          // ya estamos ahí: dispara evento por si la página quiere reaccionar
          window.dispatchEvent(new CustomEvent("snoop:productos-voice", { detail: { text } }));
        }
        return;
      }

      // --- 2) Productos: any voice = category filter OR search ---
      if (path === "/productos") {
        window.dispatchEvent(new CustomEvent("snoop:productos-voice", { detail: { text } }));
        setMessages((m) => [...m, { role: "assistant", content: `→ ${text}` }]);
        return;
      }

      // From elsewhere: "categoría flores", "ver flores en productos", etc.
      const catMatch = lower.match(/(?:categor[ií]a|ver|mostrar|abre|abrir|ir a|ve a)\s+([a-záéíóúñ\s]+?)(?:\s+en\s+productos)?\.?$/i);
      if (catMatch && /\b(flores?|extracci|hash|comestibles?|bebidas?|merch|vapes?|cigarr|joints?|prerolls?|edibles?)/i.test(catMatch[1])) {
        const cat = catMatch[1].trim();
        try { window.localStorage.setItem("snoop:productos-pending", JSON.stringify({ text: cat, at: Date.now() })); } catch {}
        setMessages((m) => [...m, { role: "assistant", content: `→ Productos · ${cat}` }]);
        navigate({ to: "/productos" });
        return;
      }

      // --- 3) Route-specific shortcuts ---
      if (path === "/soci/nuovo") {
        const payload = JSON.stringify({ text, at: Date.now() });
        window.localStorage.setItem("snoop:new-member-transcript", payload);
        window.dispatchEvent(new StorageEvent("storage", { key: "snoop:new-member-transcript", newValue: payload }));
        setMessages((m) => [...m, { role: "assistant", content: "→ rellenando" }]);
        return;
      }

      if (path === "/soci/gestisci" || path === "/soci") {
        const cleaned = text
          .replace(/^(buscar?|busca|buscame|encuentra|encontrar|cerca|cercar|trova|trovami|busca a|busca el|busca la)\s+/i, "")
          .replace(/[.,;:!?]+$/g, "")
          .trim();
        window.dispatchEvent(new CustomEvent("snoop:search-members", { detail: { query: cleaned } }));
        setMessages((m) => [...m, { role: "assistant", content: `→ Buscando ${cleaned}` }]);
        return;
      }

      if (/^\/soci\/[^/]+\/pedido/.test(path)) {
        window.dispatchEvent(new CustomEvent("snoop:pedido-transcript", { detail: { text } }));
        return;
      }

      if (path.startsWith("/soci/") && path !== "/soci/nuovo" && path !== "/soci/gestisci") {
        if (/(hacer|nuevo|crear)\s+(un\s+)?(pedido|orden|ordine)/i.test(lower) || /^(pedido|ordine|orden)\.?$/i.test(lower.trim())) {
          window.dispatchEvent(new CustomEvent("snoop:member-action", { detail: { action: "order" } }));
          setMessages((m) => [...m, { role: "assistant", content: "→ pedido" }]);
          return;
        }
        if (/(renovar|renueva|rinnova)/i.test(lower)) {
          window.dispatchEvent(new CustomEvent("snoop:member-action", { detail: { action: "renew" } }));
          setMessages((m) => [...m, { role: "assistant", content: "→ renovar" }]);
          return;
        }
        if (/(volver|atr[aá]s|indietro|back)/i.test(lower)) {
          navigate({ to: "/soci/gestisci" });
          return;
        }
      }

      // --- 4) Fallback: full agent ---
      const { reply, navigateTo } = await respond({
        data: { transcript: text, history: messagesRef.current.slice(-20) },
      });
      setMessages((m) => [...m, { role: "assistant", content: reply }]);
      // Voz solo en el saludo inicial; las respuestas del agente se muestran en pantalla.
      if (navigateTo) setTimeout(() => navigate({ to: navigateTo as any }), 400);
    } catch (e: any) {
      toast.error(e.message ?? "Error en el asistente");
    } finally {
      processingRef.current = false;
      if (!speakingRef.current) setStatus(wantOnRef.current ? "listening" : "off");
    }
  }, [navigate, respond, speak]);

  // --- Continuous SpeechRecognition (always-on) ---
  const ensureRec = useCallback(() => {
    if (recRef.current) return recRef.current;
    const SR = getSpeechRecognition();
    if (!SR) return null;
    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = "es-ES";
    rec.onresult = (e: any) => {
      // HARD MUTE while Snoop habla (y un pequeño margen después) para evitar
      // que el micro recoja su propia voz y se dispare en bucle ("hola hola hola").
      if (speakingRef.current || Date.now() < muteUntilRef.current) {
        return;
      }
      let finalText = "";
      let interimText = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        const t = String(r[0].transcript || "");
        if (r.isFinal) finalText += t + " ";
        else interimText += t;
      }
      if (interimText) setInterim(interimText);
      if (finalText.trim()) {
        const txt = finalText.trim();
        const cleaned = txt.replace(WAKE_RX, "").trim();
        if (!cleaned) return;
        // Ignora frases muy cortas que suelen ser ruido / eco
        if (cleaned.length < 2) return;
        handleTranscript(cleaned);
      }
    };
    rec.onend = () => {
      // auto-restart while user wants it on
      if (wantOnRef.current) {
        try { rec.start(); } catch {}
      }
    };
    rec.onerror = (ev: any) => {
      // 'not-allowed' = mic permission denied; everything else: restart loop handles it
      if (ev?.error === "not-allowed" || ev?.error === "service-not-allowed") {
        wantOnRef.current = false;
        setEnabled(false);
        setStatus("off");
        toast.error("Permiso de micrófono denegado.");
      }
    };
    recRef.current = rec;
    return rec;
  }, [handleTranscript, stopSpeaking]);

  const startListening = useCallback(async () => {
    const SR = getSpeechRecognition();
    if (!SR) {
      toast.error("Tu navegador no soporta reconocimiento de voz continuo. Usa Chrome.");
      return;
    }
    // request mic perm explicitly so the prompt fires from user gesture
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      s.getTracks().forEach((t) => t.stop());
    } catch {
      toast.error("Permiso de micrófono denegado.");
      return;
    }
    const rec = ensureRec();
    if (!rec) return;
    wantOnRef.current = true;
    setEnabled(true);
    setOpen(true);
    setStatus("listening");
    try { rec.start(); } catch {}
    if (!greetedRef.current) {
      greetedRef.current = true;
      const greet = `Hola ${clubName || "club"}, ¿cómo te puedo ayudar?`;
      setMessages((m) => [...m, { role: "assistant", content: greet }]);
      // Solo aquí hablamos en voz alta — el resto de comandos es silencioso.
      speak(greet);
    }
  }, [clubName, ensureRec, speak]);

  const stopListening = useCallback(() => {
    wantOnRef.current = false;
    setEnabled(false);
    stopSpeaking();
    try { recRef.current?.stop?.(); } catch {}
    setStatus("off");
    setInterim("");
  }, [stopSpeaking]);

  // Cleanup on unmount
  useEffect(() => () => {
    wantOnRef.current = false;
    try { recRef.current?.stop?.(); } catch {}
    audioRef.current?.pause();
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, status, interim]);

  // External trigger
  useEffect(() => {
    function onStart() { startListening(); }
    window.addEventListener("snoop:voice-start", onStart);
    return () => window.removeEventListener("snoop:voice-start", onStart);
  }, [startListening]);

  function toggle() {
    if (enabled) stopListening();
    else startListening();
  }

  const ringClass =
    status === "speaking" ? "bg-gradient-neon text-primary-foreground glow-neon animate-pulse"
    : status === "processing" ? "bg-gradient-neon text-primary-foreground glow-neon"
    : status === "listening" ? "bg-gradient-neon text-primary-foreground glow-neon shadow-[0_0_40px_-5px_oklch(0.85_0.25_140)] animate-pulse"
    : "bg-card border border-neon/40 text-neon";

  return (
    <>
      <button
        type="button"
        onClick={toggle}
        aria-label={enabled ? "Apagar Snoop" : "Encender Snoop"}
        className={`fixed z-40 bottom-5 right-5 md:bottom-8 md:right-8 h-16 w-16 rounded-full flex items-center justify-center transition-all ${ringClass}`}
      >
        {status === "processing" ? <Loader2 className="w-6 h-6 animate-spin" />
          : status === "speaking" ? <Volume2 className="w-6 h-6" />
          : status === "listening" ? <Ear className="w-7 h-7" />
          : enabled ? <Mic className="w-7 h-7" />
          : <MicOff className="w-7 h-7" />}
      </button>

      {open && (
        <div className="fixed z-40 bottom-24 right-3 md:right-8 w-[min(92vw,400px)] rounded-2xl border border-neon/40 bg-card/95 backdrop-blur-xl shadow-2xl glow-neon-soft overflow-hidden flex flex-col">
          <div className="flex items-center justify-between px-4 py-2 border-b border-neon/20">
            <span className="text-[10px] uppercase tracking-[0.3em] text-neon-dim font-display">
              Snoop {enabled ? "· escuchando" : "· apagado"}
            </span>
            <div className="flex items-center gap-2">
              {messages.length > 0 && (
                <button
                  onClick={() => { setMessages([]); stopSpeaking(); }}
                  className="text-muted-foreground hover:text-neon"
                  aria-label="Reiniciar"
                  title="Reiniciar conversación"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
              <button onClick={() => setOpen(false)} className="text-muted-foreground hover:text-neon" aria-label="Cerrar">
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
            {interim && status === "listening" && (
              <p className="text-xs text-neon-dim italic">… {interim}</p>
            )}
            {status === "processing" && (
              <p className="text-xs text-neon-dim flex items-center gap-2"><Loader2 className="w-3 h-3 animate-spin" /> Procesando…</p>
            )}
            {status === "speaking" && (
              <p className="text-xs text-neon flex items-center gap-2"><Volume2 className="w-3 h-3" /> Hablando… habla para interrumpirme.</p>
            )}
            {!enabled && messages.length === 0 && (
              <p className="text-[11px] text-neon-dim">Pulsa el micro para activar a Snoop. Una vez encendido, habla cuando quieras — no hace falta volver a pulsar.</p>
            )}
          </div>
        </div>
      )}
    </>
  );
}
