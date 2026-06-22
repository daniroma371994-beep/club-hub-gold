import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { MeduzaLayout } from "@/components/MeduzaLayout";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEffect, useRef } from "react";
import QRCode from "qrcode";
import { ArrowLeft, Download, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";

export const Route = createFileRoute("/_authenticated/soci/$id")({
  component: SocioDetail,
});

function SocioDetail() {
  const { id } = Route.useParams();
  const nav = useNavigate();
  const { isAdmin } = useAuth();
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const { data: m, isLoading } = useQuery({
    queryKey: ["member", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("members").select("*").eq("id", id).single();
      if (error) throw error;
      return data;
    },
  });

  useEffect(() => {
    if (m?.qr_token && canvasRef.current) {
      QRCode.toCanvas(canvasRef.current, `MEDUZA:${m.qr_token}`, {
        width: 280,
        margin: 2,
        color: { dark: "#c9a84c", light: "#0a0a0a" },
      });
    }
  }, [m?.qr_token]);

  function downloadQR() {
    if (!canvasRef.current) return;
    const url = canvasRef.current.toDataURL("image/png");
    const a = document.createElement("a");
    a.href = url;
    a.download = `meduza-tessera-${m?.card_number}.png`;
    a.click();
  }

  async function remove() {
    if (!confirm("Eliminare definitivamente questo socio?")) return;
    const { error } = await supabase.from("members").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Socio eliminato");
    nav({ to: "/soci" });
  }

  if (isLoading) return <MeduzaLayout><div className="text-muted-foreground">Caricamento...</div></MeduzaLayout>;
  if (!m) return <MeduzaLayout><div className="text-muted-foreground">Socio non trovato.</div></MeduzaLayout>;

  return (
    <MeduzaLayout>
      <Link to="/soci" className="inline-flex items-center gap-2 text-gold-muted hover:text-gold text-xs uppercase tracking-widest mb-6">
        <ArrowLeft className="w-3 h-3" /> Tutti i soci
      </Link>

      <div className="grid md:grid-cols-[1fr_300px] gap-6">
        <div className="bg-card/60 border border-gold/30 rounded-lg p-6 md:p-8">
          <div className="flex items-center gap-5 mb-6 pb-6 border-b border-gold/20">
            {m.photo_url ? (
              <img src={m.photo_url} alt="" className="w-24 h-24 rounded-full object-cover border-2 border-gold" />
            ) : (
              <div className="w-24 h-24 rounded-full bg-accent border-2 border-gold flex items-center justify-center text-gold font-display text-3xl">
                {m.first_name[0]}{m.last_name[0]}
              </div>
            )}
            <div>
              <div className="text-xs uppercase tracking-[0.3em] text-gold-muted">Tessera N° {m.card_number}</div>
              <h2 className="font-display text-3xl text-gradient-gold tracking-wider mt-1">{m.first_name} {m.last_name}</h2>
            </div>
          </div>

          <dl className="grid md:grid-cols-2 gap-4 text-sm">
            <Row label="Data nascita" value={m.birth_date} />
            <Row label="Telefono" value={m.phone} />
            <Row label="Email" value={m.email} />
            <Row label="Indirizzo" value={m.address} className="md:col-span-2" />
            <Row label="Documento" value={m.document_number ? `${m.document_type} ${m.document_number}` : null} />
            <Row label="Scadenza doc." value={m.document_expiry} />
            <Row label="Iscritto il" value={m.joined_at} />
            <Row label="Tessera scade" value={m.expires_at} />
            {m.notes && <Row label="Note" value={m.notes} className="md:col-span-2" />}
          </dl>

          {isAdmin && (
            <button onClick={remove} className="mt-8 flex items-center gap-2 text-destructive text-xs uppercase tracking-widest hover:underline">
              <Trash2 className="w-3 h-3" /> Elimina socio
            </button>
          )}
        </div>

        <div className="bg-card/60 border border-gold/30 rounded-lg p-6 text-center">
          <div className="text-[10px] uppercase tracking-[0.3em] text-gold-muted mb-4">Chiave QR Socio</div>
          <div className="inline-block bg-[#0a0a0a] p-3 rounded">
            <canvas ref={canvasRef} />
          </div>
          <div className="font-mono text-[10px] text-gold-muted mt-3 break-all">{m.qr_token}</div>
          <button onClick={downloadQR} className="mt-4 w-full bg-gradient-gold text-primary-foreground py-2.5 rounded-md text-xs uppercase tracking-widest flex items-center gap-2 justify-center">
            <Download className="w-3 h-3" /> Scarica QR
          </button>
          <p className="text-[10px] text-muted-foreground mt-3">Scansiona dalla Cassa per identificare il socio.</p>
        </div>
      </div>
    </MeduzaLayout>
  );
}

function Row({ label, value, className = "" }: any) {
  return (
    <div className={className}>
      <dt className="text-[10px] uppercase tracking-[0.3em] text-gold-muted">{label}</dt>
      <dd className="text-foreground mt-1">{value || "—"}</dd>
    </div>
  );
}
