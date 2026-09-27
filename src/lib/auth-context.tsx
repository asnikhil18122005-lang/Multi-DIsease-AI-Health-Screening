import React, { createContext, useContext, useEffect, useState } from "react";
import {
  apiChangePassword,
  apiGetMe,
  apiLogin,
  apiLogout,
  apiSignup,
  apiUpdateProfile,
  getCachedUser,
  getAuthToken,
  type AuthUser,
} from "./api";

interface AuthContextType {
  user: AuthUser | null;
  isAuthenticated: boolean;
  loading: boolean;
  login: (data: { email: string; password: string; name?: string }) => Promise<void>;
  signup: (data: { email: string; password: string; name: string }) => Promise<void>;
  updateProfile: (data: { name?: string; email?: string }) => Promise<AuthUser>;
  changePassword: (data: {
    currentPassword?: string;
    newPassword: string;
    email?: string;
  }) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  const refreshUser = async () => {
    const token = getAuthToken();
    const cached = getCachedUser();
    if (!token) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      const u = await apiGetMe();
      setUser(u);
    } catch {
      // Keep cached user if token exists so transient network errors do not drop signed-in state
      if (cached) {
        setUser(cached);
      } else {
        setUser(null);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const cached = getCachedUser();
    if (cached) {
      setUser(cached);
    }
    void refreshUser();
  }, []);

  const login = async (data: { email: string; password: string; name?: string }) => {
    const res = await apiLogin(data);
    setUser(res.user);
  };

  const signup = async (data: { email: string; password: string; name: string }) => {
    const res = await apiSignup(data);
    setUser(res.user);
  };

  const updateProfile = async (data: { name?: string; email?: string }) => {
    const res = await apiUpdateProfile(data);
    setUser(res.user);
    return res.user;
  };

  const changePassword = async (data: {
    currentPassword?: string;
    newPassword: string;
    email?: string;
  }) => {
    const res = await apiChangePassword(data);
    if (res.user) {
      setUser(res.user);
    }
  };

  const logout = async () => {
    setUser(null);
    await apiLogout();
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: Boolean(user),
        loading,
        login,
        signup,
        updateProfile,
        changePassword,
        logout,
        refreshUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return ctx;
}
