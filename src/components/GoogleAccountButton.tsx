import React, { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Cloud, CloudOff, Loader2, LogOut, RefreshCw } from 'lucide-react';
import { useFirebaseAuth } from '../contexts/FirebaseContext';

interface GoogleAccountButtonProps {
  compact?: boolean;
}

const GoogleGIcon: React.FC<{ className?: string }> = ({ className = 'h-4 w-4' }) => (
  <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
    <path
      fill="#EA4335"
      d="M12 10.2v3.9h5.4c-.2 1.2-.9 2.3-2 3l3.2 2.5c1.9-1.7 3-4.3 3-7.4 0-.7-.1-1.4-.2-2H12z"
    />
    <path
      fill="#34A853"
      d="M12 22c2.7 0 5-.9 6.6-2.4l-3.2-2.5c-.9.6-2 .9-3.4.9-2.6 0-4.8-1.7-5.6-4.1H3.1v2.6C4.7 19.7 8.1 22 12 22z"
    />
    <path
      fill="#4A90E2"
      d="M6.4 13.9c-.2-.6-.3-1.2-.3-1.9s.1-1.3.3-1.9V7.5H3.1C2.4 8.9 2 10.4 2 12s.4 3.1 1.1 4.5l3.3-2.6z"
    />
    <path
      fill="#FBBC05"
      d="M12 6c1.5 0 2.8.5 3.8 1.5l2.9-2.9C17 2.9 14.7 2 12 2 8.1 2 4.7 4.3 3.1 7.5l3.3 2.6C7.2 7.7 9.4 6 12 6z"
    />
  </svg>
);

export const GoogleAccountButton: React.FC<GoogleAccountButtonProps> = ({ compact = false }) => {
  const { user, signingIn, syncStatus, loginWithGoogle, logout } = useFirebaseAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [menuOpen]);

  if (!user) {
    return (
      <button
        type="button"
        onClick={() => void loginWithGoogle()}
        disabled={signingIn}
        title="Sign in with Gmail to save your watchlists permanently"
        className={`glass-chip inline-flex items-center gap-2 whitespace-nowrap shrink-0 rounded-xl font-semibold text-slate-100 transition-all hover:border-cyan-400/50 hover:text-white disabled:opacity-60 ${
          compact ? 'h-9 px-2.5 text-xs' : 'h-9 px-3.5 text-xs'
        }`}
      >
        {signingIn ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-cyan-300" />
        ) : (
          <GoogleGIcon className="h-3.5 w-3.5 shrink-0" />
        )}
        <span>{compact ? 'Gmail' : 'Sign in'}</span>
      </button>
    );
  }

  const initial = (user.displayName || user.email || 'G').charAt(0).toUpperCase();

  return (
    <div ref={containerRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setMenuOpen((prev) => !prev)}
        title={user.email ? `Synced to ${user.email}` : 'Gmail Cloud Sync'}
        className={`glass-chip inline-flex items-center gap-2 rounded-xl transition-all hover:border-cyan-400/50 ${
          compact ? 'h-9 px-2' : 'h-9 px-2.5 pr-3'
        }`}
      >
        {user.photoURL ? (
          <img
            src={user.photoURL}
            alt={user.displayName || 'Gmail profile'}
            referrerPolicy="no-referrer"
            className="h-6 w-6 rounded-full object-cover ring-1 ring-white/20"
          />
        ) : (
          <span className="accent-gradient flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold text-white">
            {initial}
          </span>
        )}

        {!compact && (
          <span className="max-w-[110px] truncate text-xs font-medium text-slate-200">
            {user.displayName?.split(' ')[0] || user.email?.split('@')[0]}
          </span>
        )}

        {syncStatus === 'syncing' || syncStatus === 'connecting' ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-cyan-300" />
        ) : syncStatus === 'error' ? (
          <CloudOff className="h-3.5 w-3.5 text-rose-400" />
        ) : (
          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
        )}
      </button>

      {menuOpen && (
        <div className="glass-panel absolute right-0 mt-2 w-64 rounded-2xl p-3 shadow-2xl shadow-black/60 z-50">
          <div className="border-b border-white/10 pb-2.5">
            <p className="truncate text-xs font-semibold text-white">
              {user.displayName || 'Gmail Account'}
            </p>
            <p className="truncate text-[11px] text-slate-400">{user.email}</p>
            <div className="mt-1.5 inline-flex items-center gap-1.5 text-[11px] font-medium text-emerald-300">
              <Cloud className="h-3 w-3" />
              {syncStatus === 'syncing'
                ? 'Syncing changes...'
                : syncStatus === 'error'
                ? 'Sync paused — check connection'
                : 'Lists synced to cloud'}
            </div>
          </div>

          <div className="mt-2 space-y-1">
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                void loginWithGoogle();
              }}
              className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-xs font-medium text-slate-200 hover:bg-white/10 hover:text-white"
            >
              <RefreshCw className="h-3.5 w-3.5 text-cyan-300" />
              Switch Gmail account
            </button>

            <button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                void logout();
              }}
              className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-xs font-medium text-rose-300 hover:bg-rose-500/15"
            >
              <LogOut className="h-3.5 w-3.5" />
              Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
