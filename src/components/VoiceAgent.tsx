import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Mic, Square, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { agentRespond, transcribeAudio } from "@/lib/voice-agent.functions";

type Status = "idle" | "recording" | "processing";

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
  const [transcript, setTranscript] = useState("");
  const [reply, setReply] = useState("");
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  const transcribe = useServerFn(transcribeAudio);
  const respond = useServerFn(agentRespond);

  useEffect(() => () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
  }, []);

  async function startRec() {
    setTranscript(""); setReply("");
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
          toast.error("Grabación demasiado corta, vuelve a intentar.");
          return;
        }
        setStatus("processing");
        try {
          const b64 = await blobToBase64(blob);
          const { text } = await transcribe({ data: { audioBase64: b64, mimeType: rec.mimeType } });
          if (!text) { setStatus("idle"); toast.error("No se entendió nada."); return; }
          setTranscript(text);
          const { reply } = await respond({ data: { transcript: text } });
          setReply(reply);
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

  function stopRec() {
    recorderRef.current?.stop();
  }

  function toggle() {
    if (status === "recording") stopRec();
    else if (status === "idle") startRec();
  }

  return (
    <>
      {/* Floating mic */}
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

      {/* Panel */}
      {open && (transcript || reply || status !== "idle") && (
        <div className="fixed z-40 bottom-24 right-3 md:right-8 w-[min(92vw,400px)] rounded-2xl border border-neon/40 bg-card/95 backdrop-blur-xl shadow-2xl glow-neon-soft overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2 border-b border-neon/20">
            <span className="text-[10px] uppercase tracking-[0.3em] text-neon-dim font-display">Asistente SNOOP</span>
            <button onClick={() => setOpen(false)} className="text-muted-foreground hover:text-neon">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="p-4 space-y-3 max-h-[60vh] overflow-y-auto">
            {status === "recording" && (
              <p className="text-xs text-destructive animate-pulse">● Grabando… pulsa para parar.</p>
            )}
            {status === "processing" && !reply && (
              <p className="text-xs text-neon-dim flex items-center gap-2"><Loader2 className="w-3 h-3 animate-spin" /> Procesando…</p>
            )}
            {transcript && (
              <div>
                <div className="text-[10px] uppercase tracking-widest text-neon-dim mb-1">Tú</div>
                <p className="text-sm text-muted-foreground italic">"{transcript}"</p>
              </div>
            )}
            {reply && (
              <div>
                <div className="text-[10px] uppercase tracking-widest text-neon mb-1">Snoop</div>
                <p className="text-sm text-foreground whitespace-pre-wrap">{reply}</p>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
