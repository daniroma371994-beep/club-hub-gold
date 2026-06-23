import { useEffect, useRef, useState, useCallback } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { Mic, MicOff, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { parseVoiceIntent, type VoiceIntent } from "@/lib/voice.functions";
import { supabase } from "@/integrations/supabase/client";
import { voiceBus } from "./voice-bus";
import { cn } from "@/lib/utils";

type State = "idle" | "listening" | "thinking" | "executing";

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
  const parseIntent = useServerFn(parseVoiceIntent);

  const [state, setState] = useState<State>("idle");
  const [interim, setInterim] = useState("");
  const [finalText, setFinalText] = useState("");
  const [lastSpoken, setLastSpoken] = useState("");
  const [supported, setSupported] = useState(true);

  const srRef = useRef<any>(null);
  const stoppingRef = useRef(false);
  const interimRef = useRef("");
  const finalRef = useRef("");

  useEffect(() => {
    const SR: any = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) setSupported(false);
  }, []);

  const executeIntent = useCallback(
    async (intent: VoiceIntent) => {
      setState("executing");
      if (intent.speak) setLastSpoken(intent.speak);
      const { action } = intent;
      try {
        if (action === "navigate" && intent.target) {
          const to = ROUTE_MAP[intent.target];
          if (!to) return toast.error(`Non conosco "${intent.target}"`);
          await nav({ to });
          toast.success(intent.speak ?? `Apro ${intent.target}`);
        } else if (action === "create_member") {
          if (!intent.first_name || !intent.last_name) {
            toast.error("Mancano nome o cognome");
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
        } else if (action === "cancel") {
          toast.message(intent.speak ?? "Annullato");
        } else {
          toast.error(intent.speak ?? "Non ho capito.");
        }
        qc.invalidateQueries();
      } catch (e: any) {
        toast.error(e.message ?? "Error");
      } finally {
        setState("idle");
      }
    },
    [nav, route, qc],
  );

  useEffect(() => {
    voiceBus.setReplayer((i) => executeIntent(i));
    return () => voiceBus.setReplayer(null);
  }, [executeIntent]);

  const handleFinal = useCallback(
    async (text: string) => {
      setState("thinking");
      try {
        const [{ data: prods }, { data: plansData }] = await Promise.all([
          supabase.from("products").select("id, name").eq("active", true),
          supabase.from("membership_plans").select("id, name, duration_days").eq("active", true),
        ]);
        const intent = await parseIntent({
          data: { text, route, products: prods ?? [], plans: plansData ?? [] },
        });
        await executeIntent(intent);
      } catch (e: any) {
        toast.error(e.message ?? "Errore durante l'elaborazione");
        setState("idle");
      }
    },
    [parseIntent, route, executeIntent],
  );

  const stop = useCallback(() => {
    stoppingRef.current = true;
    try { srRef.current?.stop(); } catch {}
  }, []);

  const start = useCallback(() => {
    const SR: any = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) {
      toast.error("Il browser non supporta il comando vocale. Usa Chrome.");
      return;
    }
    try { srRef.current?.stop(); } catch {}
    stoppingRef.current = false;
    setInterim("");
    setFinalText("");
    interimRef.current = "";
    finalRef.current = "";
    const sr = new SR();
    sr.lang = "it-IT";
    sr.continuous = false;
    sr.interimResults = true;
    sr.maxAlternatives = 1;
    sr.onstart = () => setState("listening");
    sr.onresult = (ev: any) => {
      let interimStr = "";
      let finalStr = "";
      for (let i = 0; i < ev.results.length; i++) {
        const t = ev.results[i][0].transcript;
        if (ev.results[i].isFinal) finalStr += t;
        else interimStr += t;
      }
      setInterim(interimStr);
      interimRef.current = interimStr;
      if (finalStr) {
        finalRef.current = `${finalRef.current} ${finalStr}`.trim();
        setFinalText(finalRef.current);
      }
    };
    sr.onerror = (e: any) => {
      if (e.error === "not-allowed") toast.error("Microfono bloccato");
      else if (e.error === "no-speech") toast.message("Non ho sentito nulla");
      else if (e.error !== "aborted") toast.error(`Errore voce: ${e.error}`);
      setState("idle");
    };
    sr.onend = () => {
      const text = `${finalRef.current} ${interimRef.current}`.trim();
      setInterim("");
      interimRef.current = "";
      if (stoppingRef.current || !text) {
        setState("idle");
        return;
      }
      setFinalText(text);
      handleFinal(text);
    };
    srRef.current = sr;
    try {
      sr.start();
    } catch (e: any) {
      toast.error("Non riesco ad avviare il microfono");
      setState("idle");
    }
  }, [handleFinal]);

  const onMicClick = () => {
    if (state === "listening") stop();
    else if (state === "idle") start();
  };

  const busy = state === "thinking" || state === "executing";
  const listening = state === "listening";
  const showOverlay = listening || busy || !!finalText;

  return (
    <>
      {showOverlay && (
        <div className="fixed inset-x-0 bottom-36 md:bottom-24 z-40 flex justify-center pointer-events-none px-4">
          <div className="bg-card/95 border-2 border-gold/60 rounded-2xl px-4 py-3 max-w-md w-full backdrop-blur-md shadow-2xl pointer-events-auto">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] font-display uppercase tracking-widest text-gold">
                {listening ? "Ascolto…" : state === "thinking" ? "Capisco…" : state === "executing" ? "Eseguo…" : "Ultimo comando"}
              </span>
              <button onClick={() => { stop(); setFinalText(""); setLastSpoken(""); }} className="text-gold-muted hover:text-gold">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="text-sm text-foreground min-h-[1.5rem] leading-snug">
              {finalText}
              {interim && <span className="text-gold-muted italic"> {interim}</span>}
              {listening && !finalText && !interim && (
                <span className="text-gold-muted italic">Parla ora…</span>
              )}
            </div>
            {lastSpoken && !listening && (
              <div className="text-[11px] text-gold italic mt-1">→ {lastSpoken}</div>
            )}
          </div>
        </div>
      )}

      <div className="fixed z-30 bottom-20 md:bottom-6 right-4">
        <button
          onClick={onMicClick}
          disabled={busy || !supported}
          className={cn(
            "relative w-16 h-16 rounded-full border-2 flex items-center justify-center shadow-xl backdrop-blur transition",
            listening
              ? "bg-destructive border-destructive text-white animate-pulse"
              : busy
                ? "bg-card/80 border-gold/50 text-gold"
                : supported
                  ? "bg-gradient-gold border-gold text-primary-foreground hover:scale-105"
                  : "bg-muted border-muted text-muted-foreground opacity-50",
          )}
          title={!supported ? "Voce non supportata" : listening ? "Ferma" : "Parla"}
        >
          {busy ? (
            <Loader2 className="w-7 h-7 animate-spin" />
          ) : listening ? (
            <Mic className="w-7 h-7" />
          ) : supported ? (
            <Mic className="w-7 h-7" />
          ) : (
            <MicOff className="w-7 h-7" />
          )}
        </button>
      </div>
    </>
  );
}
