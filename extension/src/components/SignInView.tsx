import type { AuthController } from "../hooks/useAuth";
import { BrandMark, SparkleIcon } from "./Icons";

interface SignInViewProps {
  auth: AuthController;
  message?: string | null;
}

/** Main-page sign-in surface shown when the user is not authenticated. */
export function SignInView({ auth, message }: SignInViewProps) {
  return (
    <div className="center-state">
      <span className="state-icon">
        <BrandMark size={22} />
      </span>
      <h3>Sign in to read with AI</h3>
      <p>{message ?? "Use your Google account to generate a reading guide and chat with the video."}</p>
      <button
        type="button"
        className="button primary"
        disabled={!auth.configured || auth.loading}
        onClick={() => void auth.signInWithGoogle()}
      >
        <SparkleIcon size={14} />
        {auth.loading ? "Checking…" : "Continue with Google"}
      </button>
      {!auth.configured ? (
        <p className="muted small">
          Sign-in is not configured in this build (set VITE_SUPABASE_URL and
          VITE_SUPABASE_ANON_KEY).
        </p>
      ) : null}
      {auth.error ? <p className="health-line bad">{auth.error}</p> : null}
    </div>
  );
}
