import React, { createContext, useState, useContext, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { queryClientInstance } from "@/lib/query-client";

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [authError, setAuthError] = useState(null);

  const isEmailVerified = (supabaseUser) =>
    Boolean(supabaseUser?.email_confirmed_at);

  const forceSignOutUnverified = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setIsAuthenticated(false);
    setAuthError({
      type: "email_not_verified",
      message:
        "Please verify your email address before signing in. Check your inbox for the confirmation link.",
    });
  };

  useEffect(() => {
    // Get initial session
    supabase.auth
      .getSession()
      .then(({ data: { session } }) => {
        if (session?.user) {
          if (isEmailVerified(session.user)) {
            setUser(buildUser(session.user));
            setIsAuthenticated(true);
          } else {
            forceSignOutUnverified();
          }
        }
        setIsLoadingAuth(false);
      })
      .catch(() => {
        setIsLoadingAuth(false);
      });

    // Listen for auth state changes (sign in, sign out, token refresh)
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (session?.user) {
        if (isEmailVerified(session.user)) {
          setUser(buildUser(session.user));
          setIsAuthenticated(true);
          setAuthError(null);
        } else {
          forceSignOutUnverified();
        }
      } else {
        setUser(null);
        setIsAuthenticated(false);
      }
      // Only wipe the cache on an explicit sign-out so that token
      // refreshes and sign-in events don't discard in-flight queries.
      if (event === "SIGNED_OUT") {
        queryClientInstance.clear();
      }
      setIsLoadingAuth(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const buildUser = (supabaseUser) => ({
    id: supabaseUser.id,
    email: supabaseUser.email,
    name:
      supabaseUser.user_metadata?.name ||
      supabaseUser.email?.split("@")[0] ||
      "User",
    tracked_bill_ids: [],
  });

  const login = async (email, password) => {
    setIsLoadingAuth(true);
    setAuthError(null);
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    setIsLoadingAuth(false);
    if (error) {
      setAuthError({ type: "login_failed", message: error.message });
      throw error;
    }

    if (!isEmailVerified(data?.user)) {
      await forceSignOutUnverified();
      throw new Error(
        "Please verify your email address before signing in. Check your inbox for the confirmation link.",
      );
    }

    return data;
  };

  const register = async (name, email, password) => {
    setIsLoadingAuth(true);
    setAuthError(null);
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { name } },
    });
    setIsLoadingAuth(false);
    if (error) {
      setAuthError({ type: "register_failed", message: error.message });
      throw error;
    }
    return data;
  };

  const logout = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setIsAuthenticated(false);
    // Clear persisted team-page preferences so they reset to defaults on next login
    if (typeof window !== "undefined") {
      localStorage.removeItem("team-members-open");
      localStorage.removeItem("team-bills-open");
      sessionStorage.removeItem("team-scroll-y");
      window.location.href = "/login";
    }
  };

  const navigateToLogin = () => {
    if (typeof window !== "undefined") {
      window.location.href = "/login";
    }
  };

  // Legacy compat: kept so existing code still works
  const checkUserAuth = async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (session?.user) {
      setUser(buildUser(session.user));
      setIsAuthenticated(true);
    } else {
      setIsAuthenticated(false);
    }
    setIsLoadingAuth(false);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated,
        isLoadingAuth,
        isLoadingPublicSettings: false,
        authError,
        appPublicSettings: null,
        login,
        register,
        logout,
        navigateToLogin,
        checkUserAuth,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};
