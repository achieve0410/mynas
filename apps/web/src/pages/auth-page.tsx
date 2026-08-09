import { useQuery } from "@tanstack/react-query";
import { KeyRound, LockKeyhole } from "lucide-react";
import { type FormEvent, useState } from "react";

import { api, RETURN_TO_KEY, SESSION_KEY } from "../api";
import { navigate } from "../router";

type AuthPageProps = {
  readonly onAuthenticated: () => void;
};

export const AuthPage = ({ onAuthenticated }: AuthPageProps) => {
  const setupStatus = useQuery({
    queryFn: api.getSetupStatus,
    queryKey: ["setup-status"],
  });
  const [username, setUsername] = useState("owner");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      if (!setupStatus.data?.setupComplete) {
        await api.setup(username, password);
      }
      const session = await api.login(username, password);
      window.localStorage.setItem(SESSION_KEY, session.token);
      const returnTo = window.sessionStorage.getItem(RETURN_TO_KEY);
      window.sessionStorage.removeItem(RETURN_TO_KEY);
      navigate(returnTo ?? "/");
      onAuthenticated();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Authentication failed");
    } finally {
      setSubmitting(false);
    }
  };

  const isSetup = setupStatus.data?.setupComplete === false;
  return (
    <main className="auth-layout">
      <section className="auth-copy">
        <div className="wordmark large">
          <span className="wordmark-mark">M</span>
          <span>MyNAS</span>
        </div>
        <p className="eyebrow">Your storage. Your network.</p>
        <h1>{isSetup ? "Prepare your private storage" : "Welcome back"}</h1>
        <p className="lede">
          A quiet, local-first home for mirrored files and the photos you care about.
        </p>
        <div className="trust-list">
          <span>
            <LockKeyhole size={17} /> Localhost-first access
          </span>
          <span>
            <KeyRound size={17} /> Credentials stay on this device
          </span>
        </div>
      </section>
      <form className="auth-panel" onSubmit={submit}>
        <div>
          <span className="eyebrow">{isSetup ? "First owner" : "Owner access"}</span>
          <h2>{isSetup ? "Create your account" : "Sign in"}</h2>
        </div>
        <label>
          Username
          <input
            autoComplete="username"
            onChange={(event) => setUsername(event.target.value)}
            required
            value={username}
          />
        </label>
        <label>
          Password
          <input
            autoComplete={isSetup ? "new-password" : "current-password"}
            minLength={12}
            onChange={(event) => setPassword(event.target.value)}
            required
            type="password"
            value={password}
          />
        </label>
        {error === null ? null : (
          <p aria-live="polite" className="form-error">
            {error}
          </p>
        )}
        <button
          className="button primary"
          disabled={submitting || setupStatus.isLoading}
          type="submit"
        >
          {submitting ? "Working..." : isSetup ? "Create owner" : "Sign in"}
        </button>
        <p className="form-note">MyNAS accepts owner setup only from the loopback interface.</p>
      </form>
    </main>
  );
};
