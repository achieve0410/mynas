type ProtectionErrorProps = {
  readonly message: string;
  readonly onRetry: () => void;
};

export const ProtectionError = ({ message, onRetry }: ProtectionErrorProps) => (
  <section className="protection-error" role="alert">
    <div>
      <strong>Protection history unavailable</strong>
      <p>{message}</p>
    </div>
    <button
      className="button secondary protection-retry"
      data-testid="retry-protection"
      onClick={onRetry}
      type="button"
    >
      Retry protection history
    </button>
  </section>
);

export const ProtectionLoading = () => (
  <section
    aria-busy="true"
    aria-label="Loading protection history"
    className="protection-skeleton"
    data-testid="protection-skeleton"
  >
    <div aria-hidden="true" className="protection-skeleton-line wide" />
    <div aria-hidden="true" className="protection-skeleton-line" />
    <div aria-hidden="true" className="protection-skeleton-line short" />
  </section>
);
