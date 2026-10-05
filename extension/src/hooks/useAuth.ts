import { useCallback, useEffect, useState } from "react";
import {
  authConfigured,
  getSession,
  onAuthChange,
  signIn as authSignIn,
  signInWithGoogle as authSignInWithGoogle,
  signOut as authSignOut,
  signUp as authSignUp,
  type AuthSession,
} from "../lib/auth";

export interface AuthController {
  configured: boolean;
  session: AuthSession | null;
  loading: boolean;
  error: string | null;
  signInWithGoogle: () => Promise<boolean>;
  signIn: (email: string, password: string) => Promise<boolean>;
  signUp: (email: string, password: string) => Promise<{ needsConfirmation: boolean } | null>;
  signOut: () => Promise<void>;
  clearError: () => void;
}

export function useAuth(): AuthController {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getSession().then((value) => {
      if (!cancelled) {
        setSession(value);
        setLoading(false);
      }
    });
    const unsubscribe = onAuthChange((next) => {
      if (!cancelled) setSession(next);
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    setError(null);
    try {
      const next = await authSignIn(email, password);
      setSession(next);
      return true;
    } catch (err) {
      setError((err as Error).message);
      return false;
    }
  }, []);

  const signInWithGoogle = useCallback(async () => {
    setError(null);
    try {
      const next = await authSignInWithGoogle();
      setSession(next);
      return true;
    } catch (err) {
      setError((err as Error).message);
      return false;
    }
  }, []);

  const signUp = useCallback(async (email: string, password: string) => {
    setError(null);
    try {
      const result = await authSignUp(email, password);
      if (result.session) setSession(result.session);
      return { needsConfirmation: result.needsConfirmation };
    } catch (err) {
      setError((err as Error).message);
      return null;
    }
  }, []);

  const signOut = useCallback(async () => {
    await authSignOut();
    setSession(null);
  }, []);

  const clearError = useCallback(() => setError(null), []);

  return { configured: authConfigured, session, loading, error, signInWithGoogle, signIn, signUp, signOut, clearError };
}
