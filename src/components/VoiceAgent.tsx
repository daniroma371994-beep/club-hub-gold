import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { Mic, Square, Loader2, X, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { agentRespond, transcribeAudio } from "@/lib/voice-agent.functions";

type Status = "idle" | "recording" | "processing";
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

export function VoiceAgent() {
  const [status, setStatus] = useState<Status>("idle");
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const navigate = useNavigate();
  const location = useLocation();

  const transcribe = useServerFn(transcribeAudio);
  const respond = useServerFn(agentRespond);

  useEffect(() => () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, status]);

  useEffect(() => {
    function onStart() { if (status === "idle") startRec(); }
    window.addEventListener("snoop:voice-start", onStart);
    return () => window.removeEventListener("snoop:voice-start", onStart);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  async function startRec() {
    try {
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
          const nextUser: Msg = { role: "user", content: text };
          setMessages((m) => [...m, nextUser]);

          if (location.pathname === "/soci/nuovo") {
            window.localStorage.setItem("snoop:new-member-transcript", JSON.stringify({ text, at: Date.now() }));
            window.dispatchEvent(new StorageEvent("storage", {
              key: "snoop:new-member-transcript",
              newValue: JSON.stringify({ text, at: Date.now() }),
            }));
            setMessages((m) => [...m, { role: "assistant", content: "Perfecto, estoy rellenando las casillas con los datos que has dictado." }]);
            return;
          }

          if (location.pathname === "/soci/gestisci" || location.pathname === "/soci") {
            const cleaned = text
              .replace(/^(buscar?|busca|buscame|encuentra|encontrar|cerca|cercar|trova|trovami|busca a|busca el|busca la)\s+/i, "")
              .replace(/[.,;:!?]+$/g, "")
              .trim();
            window.dispatchEvent(new CustomEvent("snoop:search-members", { detail: { query: cleaned } }));
            setMessages((m) => [...m, { role: "assistant", content: `Buscando "${cleaned}"…` }]);
            return;
          }

          // Pedido screen: forward transcript to the page (so it can confirm/cancel/add)
          if (/^\/soci\/[^/]+\/pedido/.test(location.pathname)) {
            window.dispatchEvent(new CustomEvent("snoop:pedido-transcript", { detail: { text } }));
            setMessages((m) => [...m, { role: "assistant", content: "Procesando en el pedido…" }]);
            return;
          }

          if (location.pathname.startsWith("/soci/") && location.pathname !== "/soci/nuovo" && location.pathname !== "/soci/gestisci") {
            const lower = text.toLowerCase();
            if (/(hacer|nuevo|crear|hac[eé]me|fai|fa[mt]e|fare)\s+(un\s+)?(pedido|orden|ordine|order)/i.test(lower) || /^pedido$|^ordine$|^orden$/i.test(lower.trim())) {
              window.dispatchEvent(new CustomEvent("snoop:member-action", { detail: { action: "order" } }));
              setMessages((m) => [...m, { role: "assistant", content: "Abriendo nuevo pedido…" }]);
              return;
            }
            if (/(renovar|renueva|rinnova|renew)/i.test(lower)) {
              window.dispatchEvent(new CustomEvent("snoop:member-action", { detail: { action: "renew" } }));
              setMessages((m) => [...m, { role: "assistant", content: "Renovando cuota…" }]);
              return;
            }
            if (/(eliminar|borrar|elimina|cancella|delete)/i.test(lower)) {
              window.dispatchEvent(new CustomEvent("snoop:member-action", { detail: { action: "delete" } }));
              return;
            }
            if (/(volver|atr[aá]s|indietro|back)/i.test(lower)) {
              navigate({ to: "/soci/gestisci" });
              return;
            }
          }

          const { reply, navigateTo } = await respond({ data: { transcript: text, history } });
          setMessages((m) => [...m, { role: "assistant", content: reply }]);
          if (navigateTo) {
            toast.success("Socio creado. Abriendo ficha para foto del DNI y firma…");
            setTimeout(() => navigate({ to: navigateTo }), 600);
          }
        } catch (e: any) {
          toast.error(e.message ?? "Error en el asistente");
        } finally {
          setStatus("idle");
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
    else if (status === "idle") startRec();
  }

  return (
    <>
      <button
        type="button"
        onClick={toggle}
        disabled={status === "processing"}
        aria-label={status === "recording" ? "Detener" : "Hablar con el asistente"}
        className={`fixed z-40 bottom-5 right-5 md:bottom-8 md:right-8 h-16 w-16 rounded-full flex items-center justify-center transition-all
          ${status === "recording"
            ? "bg-destructive text-destructive-foreground animate-pulse shadow-[0_0_40px_-5px_oklch(0.65_0.25_25)]"
            : "bg-gradient-neon text-primary-foreground glow-neon"}
          disabled:opacity-60`}
      >
        {status === "processing" ? <Loader2 className="w-6 h-6 animate-spin" />
          : status === "recording" ? <Square className="w-6 h-6" />
          : <Mic className="w-7 h-7" />}
      </button>

      {open && (messages.length > 0 || status !== "idle") && (
        <div className="fixed z-40 bottom-24 right-3 md:right-8 w-[min(92vw,400px)] rounded-2xl border border-neon/40 bg-card/95 backdrop-blur-xl shadow-2xl glow-neon-soft overflow-hidden flex flex-col">
          <div className="flex items-center justify-between px-4 py-2 border-b border-neon/20">
            <span className="text-[10px] uppercase tracking-[0.3em] text-neon-dim font-display">Asistente SNOOP</span>
            <div className="flex items-center gap-2">
              {messages.length > 0 && (
                <button
                  onClick={() => setMessages([])}
                  className="text-muted-foreground hover:text-neon"
                  aria-label="Reiniciar conversación"
                  title="Reiniciar"
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
            {status === "recording" && (
              <p className="text-xs text-destructive animate-pulse">● Escuchando… pulsa para parar.</p>
            )}
            {status === "processing" && (
              <p className="text-xs text-neon-dim flex items-center gap-2"><Loader2 className="w-3 h-3 animate-spin" /> Procesando…</p>
            )}
          </div>
        </div>
      )}
    </>
  );
}
