import React, { useState } from 'react';
import { motion } from 'motion/react';
import { Film, KeyRound, ShieldCheck, AlertCircle, ExternalLink, X, Cloud, Loader2 } from 'lucide-react';
import { useFirebaseAuth } from '../contexts/FirebaseContext';
import { saveApiKey, validateApiKey } from '../services/tmdb';

interface ApiKeySetupProps {
  onSuccess: () => void;
  initialKey?: string;
  isModal?: boolean;
  onClose?: () => void;
}

export const ApiKeySetup: React.FC<ApiKeySetupProps> = ({
  onSuccess,
  initialKey = '',
  isModal = false,
  onClose,
}) => {
  const [apiKey, setApiKey] = useState(initialKey);
  const [validating, setValidating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { user, signingIn, authError, loginWithGoogle, logout } = useFirebaseAuth();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = apiKey.trim();
    if (!trimmed) {
      setError('Please paste your TMDB API key before continuing.');
      return;
    }

    setValidating(true);
    setError(null);
    try {
      await validateApiKey(trimmed);
      saveApiKey(trimmed);
      onSuccess();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Could not verify this TMDB API key. Please double-check and try again.'
      );
    } finally {
      setValidating(false);
    }
  };

  const cardContent = (
    <motion.div
      initial={{ opacity: 0, y: 18, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
      className="glass-panel relative w-full max-w-lg rounded-3xl p-6 sm:p-8 text-slate-100"
    >
      {isModal && onClose && (
        <button
          type="button"
          onClick={onClose}
          aria-label="Close settings"
          className="absolute top-5 right-5 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-slate-300 hover:bg-white/20 hover:text-white transition-colors"
        >
          <X className="h-5 w-5" />
        </button>
      )}

      <div className="mb-6 flex items-center gap-3.5">
        <div className="accent-gradient flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl shadow-lg shadow-violet-500/25">
          <Film className="h-6 w-6 text-white" />
        </div>
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-white">
            {isModal ? 'TMDB API Key Settings' : 'Welcome to Moviac'}
          </h1>
          <p className="text-sm text-slate-300">
            {isModal
              ? 'Update your personal TMDB API v3 key or Read Access Token.'
              : 'Connect your personal TMDB API key to unlock live discovery.'}
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label
            htmlFor="tmdb-api-key"
            className="mb-2 block text-sm font-medium text-slate-200"
          >
            TMDB API Key (v3) or Read Access Token
          </label>
          <div className="relative">
            <KeyRound className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              id="tmdb-api-key"
              type="password"
              value={apiKey}
              onChange={(e) => {
                setApiKey(e.target.value);
                if (error) setError(null);
              }}
              placeholder="Paste your TMDB API key here..."
              autoFocus
              className="w-full rounded-xl border border-white/15 bg-black/40 py-3 pr-4 pl-10 text-sm text-white placeholder-slate-400 transition-all focus:border-cyan-400/70 focus:bg-black/55 focus:outline-none"
            />
          </div>
        </div>

        {error && (
          <div
            role="alert"
            className="flex items-start gap-2.5 rounded-xl border border-rose-400/30 bg-rose-500/15 px-3.5 py-2.5 text-sm text-rose-200"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-300" />
            <span>{error}</span>
          </div>
        )}

        <button
          type="submit"
          disabled={validating}
          className="accent-gradient flex w-full items-center justify-center gap-2 rounded-xl px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-violet-500/25 transition-all hover:brightness-110 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {validating ? 'Verifying with TMDB...' : isModal ? 'Save & Verify Key' : 'Verify & Enter Moviac'}
        </button>
      </form>

      <div className="mt-6 space-y-3 border-t border-white/10 pt-5 text-xs leading-relaxed text-slate-300">
        <div className="rounded-2xl border border-white/10 bg-white/5 p-3.5 space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-slate-200 font-medium">
              <Cloud className="h-4 w-4 text-cyan-300 shrink-0" />
              <span>
                {user
                  ? `Synced with ${user.email}`
                  : 'Sync lists & key permanently with Gmail'}
              </span>
            </div>
            {user ? (
              <button
                type="button"
                onClick={() => void logout()}
                className="text-rose-300 hover:text-rose-200 font-semibold shrink-0"
              >
                Sign out
              </button>
            ) : (
              <button
                type="button"
                disabled={signingIn}
                onClick={() => void loginWithGoogle()}
                className="rounded-lg bg-white/10 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/20 disabled:opacity-60 shrink-0 inline-flex items-center gap-1.5"
              >
                {signingIn && <Loader2 className="h-3 w-3 animate-spin" />}
                {signingIn ? 'Signing in...' : 'Sign in with Google'}
              </button>
            )}
          </div>
          {authError && (
            <p className="text-[11px] text-rose-300">{authError}</p>
          )}
        </div>

        <div className="flex items-start gap-2.5">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-cyan-300" />
          <p>
            Stored locally in your browser and synced privately to your Gmail account when signed in.
          </p>
        </div>
        <p className="text-slate-400">
          Need a free key? Create an account at{' '}
          <a
            href="https://www.themoviedb.org/settings/api"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-cyan-300 underline decoration-cyan-400/40 underline-offset-2 hover:text-cyan-200"
          >
            themoviedb.org/settings/api
            <ExternalLink className="h-3 w-3" />
          </a>{' '}
          and copy your API Key (v3 auth).
        </p>
      </div>
    </motion.div>
  );

  if (isModal) {
    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-md"
        onClick={(e) => {
          if (e.target === e.currentTarget && onClose) onClose();
        }}
      >
        {cardContent}
      </div>
    );
  }

  return (
    <div className="aurora-canvas relative flex min-h-screen items-center justify-center overflow-hidden p-4 sm:p-6">
      <div className="pointer-events-none absolute -top-32 left-1/4 h-96 w-96 rounded-full bg-violet-600/20 blur-[120px]" />
      <div className="pointer-events-none absolute -bottom-32 right-1/4 h-96 w-96 rounded-full bg-cyan-500/20 blur-[120px]" />
      {cardContent}
    </div>
  );
};
