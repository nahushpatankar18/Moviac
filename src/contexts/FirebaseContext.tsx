import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { auth, signInWithGoogle, signOutFirebase } from '../firebase';
import { ensureUserProfile } from '../services/cloudSync';

export type CloudSyncStatus = 'signed-out' | 'connecting' | 'synced' | 'syncing' | 'error';

interface FirebaseContextValue {
  user: User | null;
  authReady: boolean;
  profileReadyUid: string | null;
  signingIn: boolean;
  authError: string | null;
  syncStatus: CloudSyncStatus;
  setSyncStatus: (status: CloudSyncStatus) => void;
  clearAuthError: () => void;
  loginWithGoogle: () => Promise<User | null>;
  logout: () => Promise<void>;
}

const FirebaseContext = createContext<FirebaseContextValue | null>(null);

function formatAuthError(err: unknown): string {
  const code =
    err && typeof err === 'object' && 'code' in err ? String((err as { code?: unknown }).code) : '';
  const message = err instanceof Error ? err.message : String(err);

  if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
    return 'Google sign-in was cancelled.';
  }
  if (code === 'auth/popup-blocked') {
    return 'Popup was blocked by your browser. Please allow popups for this site and try again.';
  }
  if (code === 'auth/unauthorized-domain') {
    const host = typeof window !== 'undefined' ? window.location.hostname : 'this domain';
    return `Domain "${host}" is not authorized in Firebase Authentication yet. Add it under Firebase Console → Authentication → Settings → Authorized domains.`;
  }
  if (code === 'auth/network-request-failed') {
    return 'Network error while signing in with Google. Check your internet connection.';
  }
  return message || 'Failed to sign in with Google.';
}

export const FirebaseProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [profileReadyUid, setProfileReadyUid] = useState<string | null>(null);
  const [signingIn, setSigningIn] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<CloudSyncStatus>('signed-out');

  useEffect(() => {
    let active = true;
    const unsub = onAuthStateChanged(auth, async (nextUser) => {
      if (!active) return;
      setUser(nextUser);
      setAuthReady(true);

      if (!nextUser) {
        setProfileReadyUid(null);
        setSyncStatus('signed-out');
        return;
      }

      setSyncStatus('connecting');
      setProfileReadyUid(null);
      try {
        await ensureUserProfile(nextUser);
        if (!active) return;
        setProfileReadyUid(nextUser.uid);
        setSyncStatus('synced');
      } catch (err) {
        if (!active) return;
        setSyncStatus('error');
        setAuthError(
          err instanceof Error ? err.message : 'Could not initialize your Firebase profile.'
        );
      }
    });

    return () => {
      active = false;
      unsub();
    };
  }, []);

  const loginWithGoogle = useCallback(async (): Promise<User | null> => {
    setSigningIn(true);
    setAuthError(null);
    try {
      const signedInUser = await signInWithGoogle();
      return signedInUser;
    } catch (err) {
      const msg = formatAuthError(err);
      if (msg !== 'Google sign-in was cancelled.') {
        setAuthError(msg);
      }
      return null;
    } finally {
      setSigningIn(false);
    }
  }, []);

  const logout = useCallback(async () => {
    setAuthError(null);
    try {
      await signOutFirebase();
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Could not sign out.');
    }
  }, []);

  const clearAuthError = useCallback(() => setAuthError(null), []);

  return (
    <FirebaseContext.Provider
      value={{
        user,
        authReady,
        profileReadyUid,
        signingIn,
        authError,
        syncStatus,
        setSyncStatus,
        clearAuthError,
        loginWithGoogle,
        logout,
      }}
    >
      {children}
    </FirebaseContext.Provider>
  );
};

export function useFirebaseAuth(): FirebaseContextValue {
  const ctx = useContext(FirebaseContext);
  if (!ctx) {
    throw new Error('useFirebaseAuth must be used inside FirebaseProvider');
  }
  return ctx;
}
