import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, KeyRound, Server, Trash2 } from "lucide-react";
import { type FormEvent, useState } from "react";

import { api } from "../api";
import { MaintenanceSettings } from "../components/maintenance-settings";

export const SettingsPage = () => {
  const queryClient = useQueryClient();
  const [name, setName] = useState("Mac automation");
  const [createdToken, setCreatedToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const tokens = useQuery({ queryFn: api.listTokens, queryKey: ["api-tokens"] });
  const createToken = useMutation({
    mutationFn: () => api.createToken(name),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ["api-tokens"] }),
  });
  const revokeToken = useMutation({
    mutationFn: api.revokeToken,
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ["api-tokens"] }),
  });

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
      <MaintenanceSettings />
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
        <h3>Active API tokens</h3>
        {tokens.isPending ? <p>Loading tokens…</p> : null}
        {tokens.isError ? (
          <p aria-live="polite" className="form-error">
            {tokens.error.message}
          </p>
        ) : null}
        {tokens.data?.length === 0 ? <p>No active API tokens.</p> : null}
        <ul className="definition-list">
          {tokens.data?.map((token) => (
            <li key={token.id}>
              <span>
                <strong>{token.name}</strong>
                <small>Created {new Date(token.createdAt).toLocaleString()}</small>
              </span>
              <button
                aria-label={`Revoke ${token.name}`}
                className="button quiet"
                disabled={revokeToken.isPending}
                onClick={() => revokeToken.mutate(token.id)}
                type="button"
              >
                <Trash2 size={16} /> Revoke
              </button>
            </li>
          ))}
        </ul>
        {revokeToken.isError ? (
          <p aria-live="polite" className="form-error">
            {revokeToken.error.message}
          </p>
        ) : null}
      </section>
    </div>
  );
};
