import { KeyRound } from "lucide-react";
import { type FormEvent, useState } from "react";

import { api, SESSION_KEY } from "../api";

export const PasswordSettings = () => {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (newPassword !== confirmation) {
      setError("New passwords do not match.");
      return;
    }

    setError(null);
    setSaving(true);
    void api
      .changePassword(currentPassword, newPassword)
      .then(() => {
        window.localStorage.removeItem(SESSION_KEY);
        window.history.replaceState(null, "", "/login");
        window.dispatchEvent(new PopStateEvent("popstate"));
      })
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : "Password change failed.");
        setSaving(false);
      });
  };

  return (
    <section className="password-settings surface-panel">
      <div className="section-heading">
        <div>
          <span className="eyebrow">Owner access</span>
          <h2>Change password</h2>
        </div>
        <KeyRound aria-hidden="true" size={20} />
      </div>
      <p className="section-copy">
        Confirm the current owner password. MyNAS signs out every browser session after the change;
        API tokens remain active.
      </p>
      <form onSubmit={submit}>
        <label>
          Current password
          <input
            autoComplete="current-password"
            onChange={(event) => setCurrentPassword(event.target.value)}
            required
            type="password"
            value={currentPassword}
          />
        </label>
        <label>
          New password
          <input
            autoComplete="new-password"
            minLength={12}
            onChange={(event) => setNewPassword(event.target.value)}
            required
            type="password"
            value={newPassword}
          />
        </label>
        <label>
          Confirm new password
          <input
            autoComplete="new-password"
            minLength={12}
            onChange={(event) => setConfirmation(event.target.value)}
            required
            type="password"
            value={confirmation}
          />
        </label>
        {error === null ? null : (
          <p aria-live="polite" className="form-error">
            {error}
          </p>
        )}
        <button className="button primary" disabled={saving} type="submit">
          {saving ? "Changing password..." : "Change password"}
        </button>
      </form>
    </section>
  );
};
