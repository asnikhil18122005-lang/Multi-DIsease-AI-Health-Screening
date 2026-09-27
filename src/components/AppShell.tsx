import React from "react";
import { Link, useLocation } from "@tanstack/react-router";
import { useScreeningStore } from "../lib/store";
import { useAuth } from "../lib/auth-context";

const NAV_ITEMS: {
  id: string;
  to: "/" | "/screen" | "/results" | "/history" | "/about" | "/settings";
  label: string;
  step?: "patient" | "review";
}[] = [
  { id: "overview", to: "/", label: "Overview" },
  { id: "patient", to: "/screen", label: "Patient Screening", step: "patient" },
  { id: "results", to: "/results", label: "Results" },
  { id: "history", to: "/history", label: "History" },
  { id: "about", to: "/about", label: "About" },
  { id: "settings", to: "/settings", label: "Settings" },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const { workflowStep, setWorkflowStep } = useScreeningStore();
  const { user, isAuthenticated, logout } = useAuth();

  const isNavItemActive = (item: (typeof NAV_ITEMS)[number]) => {
    if (item.to === "/") {
      return location.pathname === "/";
    }
    if (item.to === "/screen" || location.pathname === "/report") {
      if (location.pathname !== "/screen" && location.pathname !== "/report") {
        return false;
      }
      return item.step ? workflowStep === item.step : true;
    }
    return location.pathname.startsWith(item.to);
  };

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      {/* Top Clinical Navigation Bar */}
      <header className="sticky top-0 z-30 border-b border-border bg-card/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <Link to="/" className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground font-bold text-base shadow-xs">
                MD
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-semibold tracking-tight text-foreground text-base">
                    Multi-Disease AI Screening
                  </span>
                </div>
                <p className="text-xs text-muted-foreground hidden lg:block">
                  AI-Assisted Health Screening &amp; Patient Clinical Record System
                </p>
              </div>
            </Link>
          </div>

          <div className="flex items-center gap-3">
            <nav className="hidden md:flex items-center gap-1" aria-label="Main Navigation">
              {NAV_ITEMS.map((item) => {
                const isActive = isNavItemActive(item);
                return (
                  <Link
                    key={item.id}
                    to={item.to}
                    onClick={() => {
                      if (item.step) {
                        setWorkflowStep(item.step);
                      }
                    }}
                    className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                      isActive
                        ? "bg-primary text-primary-foreground shadow-xs"
                        : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                    }`}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </nav>

            <div className="flex items-center gap-2 border-l border-border pl-3">
              {isAuthenticated && user ? (
                <div className="flex items-center gap-2.5">
                  <div className="hidden text-right text-[11px] leading-tight sm:block">
                    <p className="font-semibold text-foreground">{user.name}</p>
                    <p className="text-muted-foreground">{user.email}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      void logout();
                    }}
                    className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-1.5 text-xs font-semibold text-destructive transition-colors hover:bg-destructive/20 cursor-pointer"
                  >
                    Sign Out
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-1.5">
                  <Link
                    to="/login"
                    className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground shadow-xs transition-opacity hover:opacity-95"
                  >
                    Sign In
                  </Link>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Mobile Bottom-row Nav */}
        <div className="flex md:hidden overflow-x-auto border-t border-border px-4 py-2 gap-1.5 bg-card">
          {NAV_ITEMS.map((item) => {
            const isActive = isNavItemActive(item);
            return (
              <Link
                key={item.id}
                to={item.to}
                onClick={() => {
                  if (item.step) {
                    setWorkflowStep(item.step);
                  }
                }}
                className={`whitespace-nowrap rounded-md px-2.5 py-1 text-xs font-medium ${
                  isActive
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-secondary"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">{children}</main>

      {/* Clinical Footer Disclaimer */}
      <footer className="border-t border-border bg-card py-4 mt-12">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            <span className="inline-block h-2 w-2 rounded-full bg-amber-500"></span>
            <p>
              <strong>Clinical Decision Support Disclaimer:</strong> This system provides
              multi-disease statistical screening only and is not a substitute for professional
              medical diagnosis.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
