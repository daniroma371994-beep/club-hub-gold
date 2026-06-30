import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const PERMISSIONS = ["manage_members","manage_products","manage_collaborators","view_reports","use_cash"] as const;
type Perm = typeof PERMISSIONS[number];

function genPassword() {
  const a = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const b = "abcdefghijkmnpqrstuvwxyz";
  const d = "23456789";
  const all = a + b + d;
  const pick = (s: string) => s[Math.floor(Math.random() * s.length)];
  let p = pick(a) + pick(b) + pick(d) + pick(b);
  for (let i = 0; i < 8; i++) p += pick(all);
  return p + "-" + pick(d) + pick(d);
}

async function assertSuperAdmin(context: any) {
  const { data } = await context.supabase.rpc("is_super_admin", { _user_id: context.userId });
  if (!data) throw new Error("Forbidden: super admin only");
}

async function assertClubAdmin(context: any) {
  const { data: isAdmin } = await context.supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" });
  const { data: isSuper } = await context.supabase.rpc("is_super_admin", { _user_id: context.userId });
  if (!isAdmin && !isSuper) throw new Error("Forbidden: admin only");
}

async function currentClubId(context: any): Promise<string> {
  const { data } = await context.supabase.rpc("current_club_id");
  if (!data) throw new Error("No tienes un club asignado");
  return data as string;
}

function loginUrl(req: Request) {
  const u = new URL(req.url);
  return `${u.protocol}//${u.host}/auth`;
}

async function sendWelcomeEmail(opts: {
  recipient: string;
  full_name: string;
  temporary_password: string;
  role_label: string;
  club_name: string;
  login_url: string;
  apiKey: string;
  origin: string;
  userToken: string;
}) {
  const res = await fetch(`${opts.origin}/lovable/email/transactional/send`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${opts.userToken}`,
    },
    body: JSON.stringify({
      templateName: "welcome-user",
      recipientEmail: opts.recipient,
      idempotencyKey: `welcome-${opts.recipient}-${Date.now()}`,
      templateData: {
        full_name: opts.full_name,
        email: opts.recipient,
        temporary_password: opts.temporary_password,
        role_label: opts.role_label,
        club_name: opts.club_name,
        login_url: opts.login_url,
      },
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    console.error("Welcome email failed:", res.status, text);
  }
}

// ─── Super-admin: clubs ───────────────────────────────────────────

export const listClubs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertSuperAdmin(context);
    const { data, error } = await context.supabase.from("clubs").select("*").order("created_at", { ascending: false });
    if (error) throw error;
    return data;
  });

export const createClub = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { name: string; slug: string; city?: string; logo_url?: string }) =>
    z.object({
      name: z.string().min(2).max(80),
      slug: z.string().min(2).max(40).regex(/^[a-z0-9-]+$/),
      city: z.string().max(80).optional(),
      logo_url: z.string().url().optional(),
    }).parse(input))
  .handler(async ({ data, context }) => {
    await assertSuperAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: club, error } = await supabaseAdmin.from("clubs").insert({
      name: data.name, slug: data.slug, city: data.city ?? null, logo_url: data.logo_url ?? null,
    }).select("*").single();
    if (error) throw error;
    return club;
  });

export const createClubAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { club_id: string; email: string; full_name: string }) =>
    z.object({
      club_id: z.string().uuid(),
      email: z.string().email(),
      full_name: z.string().min(2).max(120),
    }).parse(input))
  .handler(async ({ data, context }) => {
    await assertSuperAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: club, error: cErr } = await supabaseAdmin.from("clubs").select("name").eq("id", data.club_id).single();
    if (cErr) throw cErr;

    const password = genPassword();
    const { data: created, error: uErr } = await supabaseAdmin.auth.admin.createUser({
      email: data.email, password, email_confirm: true, user_metadata: { full_name: data.full_name },
    });
    if (uErr) throw uErr;

    const userId = created.user!.id;
    const { error: rErr } = await supabaseAdmin.from("user_roles").insert({
      user_id: userId, role: "admin", club_id: data.club_id,
      permissions: ["manage_members","manage_products","manage_collaborators","view_reports","use_cash"],
    });
    if (rErr) throw rErr;

    const req = (await import("@tanstack/react-start/server")).getRequest();
    await sendWelcomeEmail({
      recipient: data.email, full_name: data.full_name, temporary_password: password,
      role_label: "administrador", club_name: club.name, login_url: loginUrl(req),
      apiKey: process.env.LOVABLE_API_KEY!, origin: new URL(req.url).origin,
      userToken: req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "",
    });

    return { user_id: userId, email: data.email };
  });

// ─── Admin: collaborators ─────────────────────────────────────────

export const listCollaborators = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertClubAdmin(context);
    const clubId = await currentClubId(context);
    const { data: roles, error } = await context.supabase
      .from("user_roles")
      .select("id, user_id, role, permissions")
      .eq("club_id", clubId)
      .neq("role", "super_admin");
    if (error) throw error;
    if (!roles?.length) return [];

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const ids = roles.map((r: any) => r.user_id);
    const { data: profs } = await supabaseAdmin.from("profiles").select("id, full_name").in("id", ids);
    const profMap = new Map((profs ?? []).map((p: any) => [p.id, p.full_name]));

    // emails via admin
    const list = await Promise.all(roles.map(async (r: any) => {
      const { data } = await supabaseAdmin.auth.admin.getUserById(r.user_id);
      return { ...r, full_name: profMap.get(r.user_id) ?? null, email: data?.user?.email ?? null };
    }));
    return list;
  });

export const createCollaborator = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { email: string; full_name: string; permissions: Perm[] }) =>
    z.object({
      email: z.string().email(),
      full_name: z.string().min(2).max(120),
      permissions: z.array(z.enum(PERMISSIONS)).min(1),
    }).parse(input))
  .handler(async ({ data, context }) => {
    await assertClubAdmin(context);
    const clubId = await currentClubId(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: club } = await supabaseAdmin.from("clubs").select("name").eq("id", clubId).single();
    const password = genPassword();
    const { data: created, error: uErr } = await supabaseAdmin.auth.admin.createUser({
      email: data.email, password, email_confirm: true, user_metadata: { full_name: data.full_name },
    });
    if (uErr) throw uErr;

    const userId = created.user!.id;
    const { error: rErr } = await supabaseAdmin.from("user_roles").insert({
      user_id: userId, role: "collaborator", club_id: clubId, permissions: data.permissions,
    });
    if (rErr) throw rErr;

    const req = (await import("@tanstack/react-start/server")).getRequest();
    await sendWelcomeEmail({
      recipient: data.email, full_name: data.full_name, temporary_password: password,
      role_label: "colaborador", club_name: club?.name ?? "", login_url: loginUrl(req),
      apiKey: process.env.LOVABLE_API_KEY!, origin: new URL(req.url).origin,
      userToken: req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "",
    });

    return { user_id: userId, email: data.email };
  });

export const updateCollaboratorPermissions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { role_id: string; permissions: Perm[] }) =>
    z.object({ role_id: z.string().uuid(), permissions: z.array(z.enum(PERMISSIONS)) }).parse(input))
  .handler(async ({ data, context }) => {
    await assertClubAdmin(context);
    const clubId = await currentClubId(context);
    const { error } = await context.supabase
      .from("user_roles")
      .update({ permissions: data.permissions })
      .eq("id", data.role_id)
      .eq("club_id", clubId)
      .eq("role", "collaborator");
    if (error) throw error;
    return { ok: true };
  });

export const deleteCollaborator = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { role_id: string }) => z.object({ role_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertClubAdmin(context);
    const clubId = await currentClubId(context);
    const { data: row, error: fErr } = await context.supabase
      .from("user_roles").select("user_id").eq("id", data.role_id).eq("club_id", clubId).eq("role","collaborator").maybeSingle();
    if (fErr) throw fErr;
    if (!row) throw new Error("Colaborador no encontrado");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("user_roles").delete().eq("id", data.role_id);
    await supabaseAdmin.auth.admin.deleteUser(row.user_id);
    return { ok: true };
  });
