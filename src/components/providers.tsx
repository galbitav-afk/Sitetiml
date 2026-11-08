"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import type { Session, User } from "@supabase/supabase-js";
import { queryClient } from "@/lib/data";
import { isConfigured, supabase } from "@/lib/supabase";
import { pipeline } from "@/lib/pipeline";
import { RecorderProvider } from "./recorder-provider";
import { ToastProvider } from "./ui";

interface AuthState {
  user: User | null;
  session: Session | null;
  loading: boolean;
  displayName: string;
  /** Set when the user arrived via a password-reset email link. */
  recovery: boolean;
}

const AuthContext = createContext<AuthState>({
  user: null,
  session: null,
  loading: true,
  displayName: "",
  recovery: false,
});

export const useAuth = () => useContext(AuthContext);

function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null,
    session: null,
    loading: isConfigured,
    displayName: "",
    recovery: false,
  });

  useEffect(() => {
    if (!isConfigured) return;
    const sb = supabase();
    const apply = (session: Session | null, recovery = false) => {
      const user = session?.user ?? null;
      const meta = (user?.user_metadata ?? {}) as { name?: string };
      setState((s) => ({
        user,
        session,
        loading: false,
        displayName: meta.name || user?.email?.split("@")[0] || "",
        recovery: recovery || s.recovery,
      }));
      if (user) pipeline.start(user.id);
      else {
        pipeline.stop();
        queryClient.clear();
      }
    };
    void sb.auth.getSession().then(({ data }) => apply(data.session));
    const { data: sub } = sb.auth.onAuthStateChange((event, session) => {
      apply(session, event === "PASSWORD_RECOVERY");
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>;
}

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <AuthProvider>
          <RecorderProvider>{children}</RecorderProvider>
        </AuthProvider>
      </ToastProvider>
    </QueryClientProvider>
  );
}
