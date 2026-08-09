import { useMutation } from "@tanstack/react-query";
import { Check, Copy, KeyRound, Server } from "lucide-react";
import { type FormEvent, useState } from "react";

import { api } from "../api";

export const SettingsPage = () => {
  const [name, setName] = useState("Mac automation");
  const [createdToken, setCreatedToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const createToken = useMutation({ mutationFn: () => api.createToken(name) });

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const result = await createToken.mutateAsync();
    setCreatedToken(result.token);
    setCopied(false);
  };

  return (
    <div className="page narrow-page">
      <header className="page-heading">
        <div>
          <span className="eyebrow">Owner controls</span>
          <h1>Settings</h1>
          <p>Service identity and credentials for trusted local automation.</p>
        </div>
      </header>
      <section className="settings-section">
        <div className="settings-heading">
          <span className="row-icon">
            <Server size={18} />
          </span>
          <div>
            <h2>Service</h2>
            <p>MyNAS v0.1.0, bound to this machine by default.</p>
          </div>
        </div>
        <dl className="definition-list">
          <div>
            <dt>Endpoint</dt>
            <dd className="mono">http://127.0.0.1:7331</dd>
          </div>
          <div>
            <dt>Authentication</dt>
            <dd>Owner sessions and revocable API tokens</dd>
          </div>
        </dl>
      </section>
      <section className="settings-section">
        <div className="settings-heading">
          <span className="row-icon">
            <KeyRound size={18} />
          </span>
          <div>
            <h2>New API token</h2>
            <p>The plaintext token is shown once. Store it in a secrets manager.</p>
          </div>
        </div>
        <form className="inline-form token-form" onSubmit={submit}>
          <label>
            Token name
            <input onChange={(event) => setName(event.target.value)} required value={name} />
          </label>
          <button className="button secondary" type="submit">
            Create token
          </button>
        </form>
        {createToken.isError ? (
          <p aria-live="polite" className="form-error">
            {createToken.error.message}
          </p>
        ) : null}
        {createdToken === null ? null : (
          <div className="token-result">
            <code>{createdToken}</code>
            <button
              aria-label="Copy API token"
              className="button quiet"
              onClick={async () => {
                await navigator.clipboard.writeText(createdToken);
                setCopied(true);
              }}
              type="button"
            >
              {copied ? <Check size={16} /> : <Copy size={16} />}
            </button>
          </div>
        )}
      </section>
    </div>
  );
};
