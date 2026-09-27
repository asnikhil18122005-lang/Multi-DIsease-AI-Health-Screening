import { createFileRoute, Link, useNavigate, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Alert, Badge, Card, Field, TextInput } from "@/components/ui";
import { useAuth } from "@/lib/auth-context";
import { apiForgotPassword, apiResetPassword } from "@/lib/api";

export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [
      { title: "Sign In | Multi-Disease AI Health Screening" },
      {
        name: "description",
        content: "Sign in to access your secure patient screenings, reports, and clinical records.",
      },
    ],
  }),
  component: LoginPage,
});

export function LoginPage() {
  const { user, login, logout } = useAuth();
  const navigate = useNavigate();
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Forgot password flow
  const [showForgot, setShowForgot] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");
  const [resetToken, setResetToken] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [resetStep, setResetStep] = useState<"request" | "reset">("request");
  const [resetMessage, setResetMessage] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!email || !password) {
      setError("Please provide both email and password.");
      return;
    }

    setLoading(true);
    try {
      await login({ email, password });
      router.invalidate();
      navigate({ to: "/screen" });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to sign in.");
    } finally {
      setLoading(false);
    }
  };

  const handleRequestReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setResetMessage(null);
    if (!forgotEmail) {
      setError("Please enter your email address.");
      return;
    }
    setLoading(true);
    try {
      const res = await apiForgotPassword(forgotEmail);
      if (res.reset_token) {
        setResetToken(res.reset_token);
        setResetStep("reset");
        setResetMessage("Reset token generated below. Please set your new password.");
      } else {
        setResetMessage(res.message);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not request password reset.");
    } finally {
      setLoading(false);
    }
  };

  const handleExecuteReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setResetMessage(null);
    if (!forgotEmail || !newPassword) {
      setError("Please provide your email address and your new password.");
      return;
    }
    if (newPassword.length < 4) {
      setError("New password must be at least 4 characters long.");
      return;
    }
    setLoading(true);
    try {
      const res = await apiResetPassword(resetToken, newPassword, forgotEmail);
      setResetMessage(res.message);
      setShowForgot(false);
      setEmail(forgotEmail);
      setPassword(newPassword);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to reset password.");
    } finally {
      setLoading(false);
    }
  };

  if (user) {
    return (
      <AppShell>
        <div className="mx-auto max-w-md py-12 text-center">
          <Badge tone="primary">Signed In</Badge>
          <h1 className="mt-3 text-2xl font-bold">You are signed in</h1>
          <p className="mt-2 text-xs text-muted-foreground">
            Signed in as <strong className="text-foreground">{user.email}</strong> ({user.name})
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Link to="/screen" className="btn-primary text-xs">
              Go to Screening
            </Link>
            <Link to="/history" className="btn-ghost text-xs">
              View History
            </Link>
            <button
              type="button"
              onClick={() => {
                void logout();
              }}
              className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-2 text-xs font-bold text-destructive hover:bg-destructive/20 transition-colors cursor-pointer"
            >
              Sign Out
            </button>
          </div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-md py-8">
        <div className="text-center">
          <Badge tone="primary">Secure Clinical Portal</Badge>
          <h1 className="mt-2 text-2xl font-extrabold md:text-3xl">Sign In to Your Account</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            Access patient screening history, uploaded reports, and risk assessments.
          </p>
        </div>

        <Card className="mt-6">
          {!showForgot ? (
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && <Alert>{error}</Alert>}

              <Field label="Email Address">
                <TextInput
                  type="email"
                  required
                  placeholder="clinician@hospital.org"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                />
              </Field>

              <Field label="Password">
                <TextInput
                  type="password"
                  required
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                />
              </Field>

              <div className="flex items-center justify-between text-xs">
                <button
                  type="button"
                  onClick={() => {
                    setShowForgot(true);
                    setForgotEmail(email);
                    setError(null);
                  }}
                  className="font-medium text-primary hover:underline cursor-pointer"
                >
                  Forgot password?
                </button>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="btn-primary w-full justify-center py-2.5 text-xs font-bold cursor-pointer"
              >
                {loading ? "Signing In…" : "Sign In"}
              </button>
            </form>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between border-b border-border pb-2">
                <h3 className="text-sm font-bold">Password Reset</h3>
                <button
                  type="button"
                  onClick={() => setShowForgot(false)}
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  Back to Sign In
                </button>
              </div>

              {error && <Alert>{error}</Alert>}
              {resetMessage && (
                <div className="rounded-xl border border-primary/30 bg-primary/10 p-3 text-xs text-foreground">
                  {resetMessage}
                </div>
              )}

              {resetStep === "request" ? (
                <form onSubmit={handleRequestReset} className="space-y-4">
                  <Field label="Enter Registered Email">
                    <TextInput
                      type="email"
                      required
                      placeholder="clinician@hospital.org"
                      value={forgotEmail}
                      onChange={(e) => setForgotEmail(e.target.value)}
                    />
                  </Field>
                  <button
                    type="submit"
                    disabled={loading}
                    className="btn-primary w-full justify-center py-2 text-xs"
                  >
                    {loading ? "Generating…" : "Request Password Reset"}
                  </button>
                </form>
              ) : (
                <form onSubmit={handleExecuteReset} className="space-y-4">
                  <Field label="Reset Token">
                    <TextInput
                      type="text"
                      required
                      placeholder="Paste reset token"
                      value={resetToken}
                      onChange={(e) => setResetToken(e.target.value)}
                    />
                  </Field>
                  <Field label="New Password (min 8 chars)">
                    <TextInput
                      type="password"
                      required
                      placeholder="••••••••"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                    />
                  </Field>
                  <button
                    type="submit"
                    disabled={loading}
                    className="btn-primary w-full justify-center py-2 text-xs"
                  >
                    {loading ? "Updating…" : "Set New Password"}
                  </button>
                </form>
              )}
            </div>
          )}
        </Card>
      </div>
    </AppShell>
  );
}
