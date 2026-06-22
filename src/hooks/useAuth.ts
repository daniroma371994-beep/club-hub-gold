import { useEffect, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export type Permission =
  | "manage_members"
  | "manage_products"
  | "manage_collaborators"
  | "view_reports"
  | "use_cash";

export interface UserAccess {
  role: "admin" | "collaborator" | null;
  permissions: Permission[];
}

export function useAuth() {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [access, setAccess] = useState<UserAccess>({ role: null, permissions: [] });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      setUser(s?.user ?? null);
      if (s?.user) {
        setTimeout(() => loadAccess(s.user.id), 0);
      } else {
        setAccess({ role: null, permissions: [] });
        setLoading(false);
      }
    });

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setUser(data.session?.user ?? null);
      if (data.session?.user) loadAccess(data.session.user.id);
      else setLoading(false);
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  async function loadAccess(uid: string) {
    const { data } = await supabase
      .from("user_roles")
      .select("role, permissions")
      .eq("user_id", uid)
      .maybeSingle();
    if (data) {
      const perms = (data.permissions ?? []) as Permission[];
      setAccess({
        role: data.role as "admin" | "collaborator",
        permissions: data.role === "admin"
          ? ["manage_members","manage_products","manage_collaborators","view_reports","use_cash"]
          : perms,
      });
    } else {
      setAccess({ role: null, permissions: [] });
    }
    setLoading(false);
  }

  const can = (p: Permission) => access.permissions.includes(p);
  const isAdmin = access.role === "admin";

  return { session, user, access, loading, can, isAdmin };
}
