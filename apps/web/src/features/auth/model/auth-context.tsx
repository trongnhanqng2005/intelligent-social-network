import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { AuthApiError, login as loginRequest, logout as logoutRequest, register as registerRequest, restoreSession, type AuthSession, type AuthUser } from '../api/auth-api';

type AuthState =
  | { status: 'loading' }
  | { status: 'anonymous' }
  | { status: 'authenticated'; session: AuthSession }
  | { status: 'unavailable'; message: string };

interface AuthContextValue {
  state: AuthState;
  login(email: string, password: string): Promise<void>;
  register(email: string, password: string): Promise<AuthUser>;
  logout(): Promise<void>;
  retry(): void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [instanceId] = useState(() => crypto.randomUUID());
  const [state, setState] = useState<AuthState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    restoreSession().then(
      (session) => { if (active) setState({ status: 'authenticated', session }); },
      (error: unknown) => {
        if (!active) return;
        if (error instanceof AuthApiError && error.status === 401) setState({ status: 'anonymous' });
        else setState({ status: 'unavailable', message: 'Chưa thể kết nối. Vui lòng thử lại.' });
      },
    );
    return () => { active = false; };
  }, [attempt]);

  useEffect(() => {
    if (state.status !== 'authenticated') return;
    const remaining = Date.parse(state.session.expiresAt) - Date.now();
    if (remaining <= 0) {
      setState({ status: 'anonymous' });
      return;
    }
    const timer = window.setTimeout(() => setState({ status: 'anonymous' }), remaining);
    return () => window.clearTimeout(timer);
  }, [state]);

  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    const channel = new BroadcastChannel('isn-auth');
    channel.onmessage = (event: MessageEvent<{ type?: string; source?: string }>) => {
      if (event.data?.source === instanceId) return;
      if (event.data?.type === 'session-ended') {
        setState({ status: 'anonymous' });
      } else if (event.data?.type === 'session-changed') {
        setState({ status: 'loading' });
        setAttempt((current) => current + 1);
      }
    };
    return () => channel.close();
  }, [instanceId]);

  useEffect(() => {
    const refreshOnFocus = () => {
      if (document.visibilityState !== 'visible') return;
      setAttempt((current) => current + 1);
    };
    window.addEventListener('focus', refreshOnFocus);
    return () => window.removeEventListener('focus', refreshOnFocus);
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const session = await loginRequest(email, password);
    setState({ status: 'authenticated', session });
    broadcastSession('session-changed', instanceId);
  }, [instanceId]);

  const register = useCallback(registerRequest, []);

  const logout = useCallback(async () => {
    try {
      await logoutRequest();
    } catch (error) {
      if (!(error instanceof AuthApiError) || error.status !== 401) throw error;
    }
      setState({ status: 'anonymous' });
      broadcastSession('session-ended', instanceId);
  }, [instanceId]);

  const value = useMemo<AuthContextValue>(() => ({
    state,
    login,
    register,
    logout,
    retry: () => setAttempt((current) => current + 1),
  }), [state, login, register, logout]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

function broadcastSession(type: 'session-changed' | 'session-ended', source: string): void {
  if (typeof BroadcastChannel === 'undefined') return;
  const channel = new BroadcastChannel('isn-auth');
  channel.postMessage({ type, source });
  channel.close();
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}
