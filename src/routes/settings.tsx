import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Alert, Badge, Card, Field, TextInput } from "@/components/ui";
import { useAuth } from "@/lib/auth-context";
import { useScreeningStore } from "@/lib/store";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Settings | Multi-Disease AI Health Screening" },
      {
        name: "description",
        content:
          "Manage your account email, password, profile details, and active health screening draft.",
      },
    ],
  }),
  component: SettingsPage,
});

function SettingsPage() {
  const { user, login, updateProfile, changePassword, logout } = useAuth();
  const { resetSession } = useScreeningStore();

  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  // Guest / Auth mode state ("signin" | "reset")
  const [authMode, setAuthMode] = useState<"signin" | "reset">("signin");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authConfirmPassword, setAuthConfirmPassword] = useState("");

  // Signed-in profile edit state
  const [profileName, setProfileName] = useState(user?.name || "");
  const [profileEmail, setProfileEmail] = useState(user?.email || "");

  // Signed-in password change state
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");

  useEffect(() => {
    if (user) {
      setProfileName(user.name || "");
      setProfileEmail(user.email || "");
    }
  }, [user]);

  const showSuccess = (msg: string) => {
    setErrorMsg(null);
    setSavedMsg(msg);
    setTimeout(() => setSavedMsg(null), 4500);
  };

  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSavedMsg(null);

    const trimmedEmail = authEmail.trim().toLowerCase();
    if (!trimmedEmail || !trimmedEmail.includes("@")) {
      setErrorMsg("Please enter a valid email address.");
      return;
    }

    if (!authPassword || authPassword.length < 4) {
      setErrorMsg("Password must be at least 4 characters long.");
      return;
    }

    if (authMode === "reset") {
      if (authConfirmPassword && authPassword !== authConfirmPassword) {
        setErrorMsg("Passwords do not match.");
        return;
      }
    }

    setLoading(true);
    try {
      if (authMode === "signin") {
        await login({
          email: trimmedEmail,
          password: authPassword,
        });
        setAuthPassword("");
        setAuthConfirmPassword("");
        showSuccess("Signed in and connected your account successfully.");
      } else if (authMode === "reset") {
        await changePassword({
          email: trimmedEmail,
          newPassword: authPassword,
        });
        await login({
          email: trimmedEmail,
          password: authPassword,
        });
        setAuthPassword("");
        setAuthConfirmPassword("");
        setAuthMode("signin");
        showSuccess("Password updated and account connected successfully.");
      }
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : "Unable to connect account.");
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSavedMsg(null);

    if (!profileEmail.trim() || !profileEmail.includes("@")) {
      setErrorMsg("Please enter a valid email address.");
      return;
    }
    if (!profileName.trim()) {
      setErrorMsg("Please enter your name.");
      return;
    }

    setLoading(true);
    try {
      await updateProfile({
        name: profileName.trim(),
        email: profileEmail.trim().toLowerCase(),
      });
      showSuccess("Account name and email updated successfully.");
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to update profile.");
    } finally {
      setLoading(false);
    }
  };

  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSavedMsg(null);

    if (!newPassword || newPassword.length < 4) {
      setErrorMsg("New password must be at least 4 characters long.");
      return;
    }
    if (confirmNewPassword && newPassword !== confirmNewPassword) {
      setErrorMsg("New passwords do not match.");
      return;
    }

    setLoading(true);
    try {
      await changePassword({ newPassword });
      setNewPassword("");
      setConfirmNewPassword("");
      showSuccess("Account password updated successfully.");
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to update password.");
    } finally {
      setLoading(false);
    }
  };

  const handleClearSessionDraft = () => {
    resetSession();
    window.localStorage.removeItem("mdai.screenings_history");
    window.sessionStorage.removeItem("mdai.lastResult");
    window.sessionStorage.removeItem("mdai.prefillLabs");
    showSuccess("Current screening draft and temporary form data cleared.");
  };

  return (
    <AppShell>
      <div className="max-w-2xl">
        <Badge tone="primary">Account &amp; Preferences</Badge>
        <h1 className="mt-3 text-2xl font-extrabold md:text-3xl">Settings</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Manage your email and password credentials, user profile, and active health screening
          draft.
        </p>

        {savedMsg && (
          <div className="mt-4 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-xs font-semibold text-emerald-800">
            ✓ {savedMsg}
          </div>
        )}

        {errorMsg && (
          <div className="mt-4">
            <Alert>{errorMsg}</Alert>
          </div>
        )}

        <section className="mt-6 space-y-6">
          {/* Account & Email / Password Connection */}
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-lg font-bold">Account Profile &amp; Email / Password</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  {user
                    ? "Your account is connected. You can update your email address, display name, or password, or sign out below."
                    : "Sign in with your email and password to connect your account and keep your screening history linked to your profile."}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Badge tone={user ? "primary" : "muted"}>
                  {user ? "Signed In" : "Guest Session"}
                </Badge>
                {user && (
                  <button
                    type="button"
                    onClick={() => {
                      void logout();
                      showSuccess("Signed out of your account.");
                    }}
                    className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-1.5 text-xs font-semibold text-destructive hover:bg-destructive/20 transition-colors cursor-pointer"
                  >
                    Sign Out
                  </button>
                )}
              </div>
            </div>

            {!user ? (
              <div className="mt-5">
                <form onSubmit={handleAuthSubmit} className="space-y-4">
                  <Field label="Email Address">
                    <TextInput
                      type="email"
                      required
                      placeholder="you@example.com"
                      value={authEmail}
                      onChange={(e) => setAuthEmail(e.target.value)}
                      autoComplete="email"
                    />
                  </Field>

                  <Field label={authMode === "reset" ? "New Password" : "Password"}>
                    <div className="relative">
                      <TextInput
                        type={showPassword ? "text" : "password"}
                        required
                        placeholder="Enter password"
                        value={authPassword}
                        onChange={(e) => setAuthPassword(e.target.value)}
                        autoComplete={authMode === "signin" ? "current-password" : "new-password"}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((v) => !v)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium text-muted-foreground hover:text-foreground cursor-pointer"
                      >
                        {showPassword ? "Hide" : "Show"}
                      </button>
                    </div>
                  </Field>

                  {authMode === "reset" && (
                    <Field label="Confirm New Password">
                      <TextInput
                        type={showPassword ? "text" : "password"}
                        required
                        placeholder="Confirm new password"
                        value={authConfirmPassword}
                        onChange={(e) => setAuthConfirmPassword(e.target.value)}
                        autoComplete="new-password"
                      />
                    </Field>
                  )}

                  <div className="flex items-center justify-between pt-1">
                    {authMode === "signin" ? (
                      <button
                        type="button"
                        onClick={() => {
                          setAuthMode("reset");
                          setErrorMsg(null);
                        }}
                        className="text-xs font-medium text-primary hover:underline cursor-pointer"
                      >
                        Forgot or want to change password?
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setAuthMode("signin");
                          setErrorMsg(null);
                        }}
                        className="text-xs font-medium text-primary hover:underline cursor-pointer"
                      >
                        Back to Sign In
                      </button>
                    )}

                    <button
                      type="submit"
                      disabled={loading}
                      className="rounded-xl bg-primary px-5 py-2.5 text-xs font-bold text-primary-foreground shadow-xs hover:opacity-95 disabled:opacity-50 cursor-pointer"
                    >
                      {loading
                        ? "Signing In…"
                        : authMode === "signin"
                          ? "Sign In"
                          : "Update Password & Sign In"}
                    </button>
                  </div>
                </form>
              </div>
            ) : (
              <div className="mt-5 space-y-6">
                {/* Active Account Overview */}
                <div className="rounded-xl border border-border bg-secondary/30 p-4 text-xs space-y-2.5">
                  <div className="flex justify-between items-center">
                    <span className="text-muted-foreground">Account Status:</span>
                    <span className="font-bold text-emerald-700">Connected &amp; Signed In</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-muted-foreground">Name:</span>
                    <span className="font-medium text-foreground">{user.name}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-muted-foreground">Email Address:</span>
                    <span className="font-medium text-foreground">{user.email}</span>
                  </div>
                  <div className="pt-2 border-t border-border flex justify-end">
                    <button
                      type="button"
                      onClick={() => {
                        void logout();
                        showSuccess("Signed out of your account.");
                      }}
                      className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-1.5 text-xs font-semibold text-destructive hover:bg-destructive/20 transition-colors cursor-pointer"
                    >
                      Sign Out
                    </button>
                  </div>
                </div>

                {/* Update Profile & Email Form */}
                <form
                  onSubmit={handleUpdateProfile}
                  className="space-y-4 border-t border-border pt-5"
                >
                  <h3 className="text-sm font-bold text-foreground">
                    Update Name &amp; Email Address
                  </h3>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Full Name">
                      <TextInput
                        type="text"
                        required
                        value={profileName}
                        onChange={(e) => setProfileName(e.target.value)}
                        placeholder="Your full name"
                      />
                    </Field>
                    <Field label="Email Address">
                      <TextInput
                        type="email"
                        required
                        value={profileEmail}
                        onChange={(e) => setProfileEmail(e.target.value)}
                        placeholder="you@example.com"
                      />
                    </Field>
                  </div>
                  <div className="flex justify-end">
                    <button
                      type="submit"
                      disabled={loading}
                      className="rounded-xl bg-primary px-4 py-2 text-xs font-bold text-primary-foreground shadow-xs hover:opacity-95 disabled:opacity-50 cursor-pointer"
                    >
                      {loading ? "Saving…" : "Save Email & Profile"}
                    </button>
                  </div>
                </form>

                {/* Change Password Form */}
                <form
                  onSubmit={handleUpdatePassword}
                  className="space-y-4 border-t border-border pt-5"
                >
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold text-foreground">Change Password</h3>
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      className="text-xs font-medium text-muted-foreground hover:text-foreground cursor-pointer"
                    >
                      {showPassword ? "Hide Password" : "Show Password"}
                    </button>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="New Password">
                      <TextInput
                        type={showPassword ? "text" : "password"}
                        required
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        placeholder="Enter new password"
                        autoComplete="new-password"
                      />
                    </Field>
                    <Field label="Confirm New Password">
                      <TextInput
                        type={showPassword ? "text" : "password"}
                        required
                        value={confirmNewPassword}
                        onChange={(e) => setConfirmNewPassword(e.target.value)}
                        placeholder="Confirm new password"
                        autoComplete="new-password"
                      />
                    </Field>
                  </div>
                  <div className="flex justify-end">
                    <button
                      type="submit"
                      disabled={loading}
                      className="rounded-xl border border-border bg-background px-4 py-2 text-xs font-bold text-foreground hover:bg-secondary disabled:opacity-50 cursor-pointer"
                    >
                      {loading ? "Updating…" : "Update Password"}
                    </button>
                  </div>
                </form>
              </div>
            )}
          </Card>

          {/* Session Reset */}
          <Card>
            <h2 className="text-lg font-bold">Current Screening Draft</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Reset the current in-progress patient form draft without deleting saved History
              records.
            </p>

            <div className="mt-4">
              <button
                type="button"
                onClick={handleClearSessionDraft}
                className="rounded-lg border border-destructive/30 px-3.5 py-2 text-xs font-semibold text-destructive hover:bg-destructive/10 transition-colors cursor-pointer"
              >
                Reset Screening Draft
              </button>
            </div>
          </Card>
        </section>
      </div>
    </AppShell>
  );
}
