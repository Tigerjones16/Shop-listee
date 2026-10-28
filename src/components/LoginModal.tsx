import { useState, type FormEvent } from 'react';

interface LoginModalProps {
  enabled: boolean;
  onClose: () => void;
  onLogin: (password: string) => Promise<void>;
}

export function LoginModal({ enabled, onClose, onLogin }: LoginModalProps) {
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      await onLogin(password);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (msg.includes('Too many login attempts')) {
        setError('Too many login attempts. Please wait a few minutes and try again.');
      } else {
        setError('That password did not work. Try again.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="modal"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section className="sheet" role="dialog" aria-modal="true" aria-labelledby="login-title">
        <h2 id="login-title">Shop admin</h2>
        {enabled ? (
          <form onSubmit={handleSubmit}>
            <label className="field">
              Admin password
              <input
                type="password"
                autoComplete="current-password"
                autoFocus
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
                maxLength={256}
              />
            </label>
            {error && (
              <div className="form-error" role="alert">
                {error}
              </div>
            )}
            <div className="form-actions">
              <button className="button ghost" type="button" onClick={onClose}>
                Cancel
              </button>
              <button className="button primary" type="submit" disabled={submitting}>
                {submitting ? 'Signing in…' : 'Sign in'}
              </button>
            </div>
          </form>
        ) : (
          <>
            <p className="sub">
              Admin access is not set up yet. Add an admin password in Secrets to enable editing.
            </p>
            <div className="form-actions">
              <button className="button primary" type="button" onClick={onClose}>
                Close
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
