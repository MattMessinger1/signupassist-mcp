import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { useNavigate } from 'react-router-dom';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signOut: () => Promise<void>;
  isSessionValid: () => boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    // Set up auth state listener FIRST
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        console.log('[AuthContext] Auth state changed:', event, !!session);
        
        // Handle session expiry
        if (event === 'SIGNED_OUT' || event === 'TOKEN_REFRESHED') {
          setSession(session);
          setUser(session?.user ?? null);
        } else if (session) {
          setSession(session);
          setUser(session.user);
        } else {
          // Clear stale session data
          setSession(null);
          setUser(null);
        }
        
        setLoading(false);
      }
    );

    // THEN check for existing session
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        // Validate session is not expired
        const expiresAt = session.expires_at ? session.expires_at * 1000 : 0;
        const now = Date.now();
        
        if (expiresAt > now) {
          setSession(session);
          setUser(session.user);
        } else {
          console.warn('[AuthContext] Session expired, clearing');
          setSession(null);
          setUser(null);
          // Sign out to clear stale data
          supabase.auth.signOut();
        }
      }
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const signOut = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setSession(null);
    navigate('/auth');
  };

  const isSessionValid = (): boolean => {
    if (!session) return false;
    
    const expiresAt = session.expires_at ? session.expires_at * 1000 : 0;
    const now = Date.now();
    
    // Only invalidate if session has ALREADY expired, not if expiring soon
    // This prevents false positives during session refresh
    if (expiresAt <= now) {
      console.warn('[AuthContext] Session has expired');
      return false;
    }
    
    // Warn if expiring soon (< 5 min) but don't invalidate yet
    if (expiresAt - now < 5 * 60 * 1000) {
      console.warn('[AuthContext] Session expiring soon, but still valid');
    }
    
    return true;
  };

  return (
    <AuthContext.Provider value={{ user, session, loading, signOut, isSessionValid }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
