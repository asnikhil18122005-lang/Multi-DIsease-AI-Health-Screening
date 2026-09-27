import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import React, { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Card, Badge, Alert } from "@/components/ui";
import { getAnalytics, getHistory } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { INITIAL_PATIENT_INPUT, useScreeningStore } from "@/lib/store";
import type { ScreeningRecord } from "@/lib/types";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Multi-Disease AI Health Screening & Risk Analysis" },
      {
        name: "description",
        content:
          "Professional multi-disease health screening, biometric risk stratification, and clinical report analysis.",
      },
      { property: "og:title", content: "Multi-Disease AI Health Screening & Risk Analysis" },
      {
        property: "og:description",
        content: "Clinical screening support and biometric risk stratification.",
      },
    ],
  }),
  component: OverviewPage,
});

interface NavSuggestion {
  label: string;
  description: string;
  keywords: string[];
  to: "/" | "/screen" | "/results" | "/history" | "/about" | "/settings";
  step?: "patient" | "review";
}

const NAVIGATION_SECTIONS: NavSuggestion[] = [
  {
    label: "Patient Screening",
    description: "Enter patient information, clinical vitals, lab values, or upload a report",
    keywords: [
      "patient",
      "screening",
      "report",
      "entry",
      "vitals",
      "labs",
      "new",
      "start",
      "upload",
    ],
    to: "/screen",
    step: "patient",
  },
  {
    label: "Results",
    description: "View AI-assisted health screening results and recommended next steps",
    keywords: ["prediction", "predict", "results", "risk", "outcome", "analysis"],
    to: "/results",
  },
  {
    label: "History",
    description: "Browse and search automatically saved patient screening records",
    keywords: ["history", "records", "past", "archive", "saved", "previous"],
    to: "/history",
  },
  {
    label: "About",
    description: "Learn about clinical screening methodology and educational guidance",
    keywords: ["about", "methodology", "info", "help", "documentation"],
    to: "/about",
  },
  {
    label: "Settings",
    description: "Manage your account profile and application preferences",
    keywords: ["settings", "config", "account", "preferences"],
    to: "/settings",
  },
];

function buildRiskSummary(record: ScreeningRecord): string {
  const preds = record.predictions || record.results_payload?.results || [];
  if (preds.length === 0) {
    return record.summary || "Screening completed";
  }

  let high = 0;
  let moderate = 0;
  let low = 0;
  for (const p of preds) {
    if (p.status !== "available") continue;
    const rc = (p.risk_category || "").toLowerCase();
    if (rc.includes("high")) high++;
    else if (rc.includes("moderate")) moderate++;
    else if (rc.includes("low")) low++;
  }

  const parts: string[] = [];
  if (high > 0) parts.push(`${high} High Risk`);
  if (moderate > 0) parts.push(`${moderate} Moderate Risk`);
  if (low > 0) parts.push(`${low} Low Risk`);

  if (parts.length > 0) {
    return parts.join(", ");
  }
  return record.summary || "Additional clinical inputs needed";
}

function OverviewPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const {
    setWorkflowStep,
    setPatientInput,
    setCurrentResults,
    setActiveScreeningId,
    setActiveReportId,
  } = useScreeningStore();

  const [analytics, setAnalytics] = useState<{
    totalScreenings: number;
    totalReports: number;
  } | null>(null);
  const [recentRecords, setRecentRecords] = useState<ScreeningRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [navSearch, setNavSearch] = useState("");

  useEffect(() => {
    let active = true;
    setIsLoading(true);

    Promise.all([getAnalytics().catch(() => null), getHistory({ limit: 5 }).catch(() => null)])
      .then(([analyticsData, historyData]) => {
        if (!active) return;
        const records = historyData?.screenings || analyticsData?.recentScreenings || [];
        setRecentRecords(records);
        setAnalytics({
          totalScreenings: analyticsData?.totalScreenings ?? records.length,
          totalReports: analyticsData?.totalReports ?? 0,
        });
      })
      .catch((e: Error) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  const matchingNavSuggestions = useMemo(() => {
    const q = navSearch.trim().toLowerCase();
    if (!q) return [];
    return NAVIGATION_SECTIONS.filter(
      (sec) =>
        sec.label.toLowerCase().includes(q) ||
        sec.description.toLowerCase().includes(q) ||
        sec.keywords.some((kw) => kw.includes(q) || q.includes(kw)),
    );
  }, [navSearch]);

  const handleNavigateSection = (sec: NavSuggestion) => {
    if (sec.step) {
      setWorkflowStep(sec.step);
    }
    setNavSearch("");
    navigate({ to: sec.to });
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const q = navSearch.trim().toLowerCase();
    if (!q) return;

    if (q.includes("review")) {
      setWorkflowStep("review");
      navigate({ to: "/screen" });
      return;
    }
    if (q.includes("patient") || q.includes("screening") || q.includes("report")) {
      setWorkflowStep("patient");
      navigate({ to: "/screen" });
      return;
    }
    if (q.includes("history") || q.includes("record")) {
      navigate({ to: "/history" });
      return;
    }
    if (q.includes("predict") || q.includes("result") || q.includes("risk")) {
      navigate({ to: "/results" });
      return;
    }
    if (q.includes("about")) {
      navigate({ to: "/about" });
      return;
    }
    if (q.includes("setting")) {
      navigate({ to: "/settings" });
      return;
    }

    if (matchingNavSuggestions.length > 0) {
      handleNavigateSection(matchingNavSuggestions[0]);
    }
  };

  const handleOpenRecentResult = (record: ScreeningRecord) => {
    const input = record.entered_patient_info || record.input_payload || {};
    const predictions = record.predictions || record.results_payload?.results || [];

    setPatientInput({
      ...INITIAL_PATIENT_INPUT,
      ...(input as Record<string, unknown>),
      name: String(record.patient_name || input["name"] || record.patient_ref || ""),
      patient_ref: record.patient_ref,
      age:
        typeof record.patient_age === "number"
          ? record.patient_age
          : (input["age"] as number | "") || "",
      sex:
        (record.patient_sex as "Male" | "Female" | "") ||
        (input["sex"] as "Male" | "Female" | "") ||
        "",
      symptoms: Array.isArray(input["symptoms"]) ? (input["symptoms"] as string[]) : [],
    });
    setCurrentResults(predictions);
    setActiveScreeningId(record.id);
    setActiveReportId(record.report_id || null);
    navigate({ to: "/results" });
  };

  const totalScreeningsCount = analytics?.totalScreenings ?? recentRecords.length;
  const totalReportsCount = analytics?.totalReports ?? 0;

  return (
    <AppShell>
      <div className="space-y-8">
        {/* Welcome & Quick Actions Section */}
        <section className="rounded-2xl border border-border bg-card p-6 sm:p-8 shadow-xs">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
            <div className="max-w-2xl space-y-3">
              <Badge tone="primary">
                {user ? `Welcome, ${user.name}` : "Health Screening Overview"}
              </Badge>
              <h1 className="text-2xl font-extrabold tracking-tight text-foreground sm:text-4xl">
                Welcome to Multi-Disease AI Health Screening
              </h1>
              <p className="text-sm text-muted-foreground sm:text-base leading-relaxed">
                Analyze patient clinical information, vital signs, and laboratory reports to receive
                clear, AI-assisted health screening insights and next-step clinical guidance through
                an automatic{" "}
                <strong className="text-foreground">
                  Patient Screening → Processing → Results → Auto-Saved History
                </strong>{" "}
                workflow.
              </p>

              {/* Quick Actions */}
              <div className="pt-2 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setWorkflowStep("patient");
                    navigate({ to: "/screen" });
                  }}
                  className="rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-xs hover:opacity-95 transition-opacity cursor-pointer"
                >
                  Start Health Screening
                </button>
                <Link
                  to="/history"
                  className="rounded-lg border border-border bg-secondary/60 px-5 py-2.5 text-sm font-semibold text-foreground hover:bg-secondary transition-colors"
                >
                  View History
                </Link>
              </div>
            </div>

            {/* Real Database Statistics */}
            <div className="grid grid-cols-2 gap-4 sm:min-w-[320px]">
              <Card>
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Total Screenings
                </span>
                <p className="mt-2 text-3xl font-extrabold text-foreground">
                  {isLoading ? "…" : totalScreeningsCount}
                </p>
                <p className="mt-1 text-[11px] text-muted-foreground">Saved screening records</p>
              </Card>

              <Card>
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Reports Processed
                </span>
                <p className="mt-2 text-3xl font-extrabold text-foreground">
                  {isLoading ? "…" : totalReportsCount}
                </p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Analyzed clinical documents
                </p>
              </Card>
            </div>
          </div>

          {/* Overview Navigation Search */}
          <div className="mt-6 border-t border-border pt-5">
            <form onSubmit={handleSearchSubmit} className="relative max-w-xl">
              <label
                htmlFor="overview-nav-search"
                className="block text-xs font-semibold text-muted-foreground mb-1.5"
              >
                Quick Section Navigation
              </label>
              <div className="flex gap-2">
                <input
                  id="overview-nav-search"
                  type="search"
                  value={navSearch}
                  onChange={(e) => setNavSearch(e.target.value)}
                  placeholder='Search sections (e.g., "patient", "screening", "review", "results", "history")...'
                  className="w-full rounded-lg border border-input bg-background px-3.5 py-2 text-xs text-foreground focus:border-primary focus:outline-none"
                />
                <button
                  type="submit"
                  className="rounded-lg border border-border bg-secondary px-4 py-2 text-xs font-semibold text-foreground hover:bg-secondary/80 cursor-pointer shrink-0"
                >
                  Go
                </button>
              </div>

              {matchingNavSuggestions.length > 0 && (
                <div className="mt-2 rounded-xl border border-border bg-card p-2 shadow-sm space-y-1">
                  {matchingNavSuggestions.map((sec) => (
                    <button
                      key={sec.label}
                      type="button"
                      onClick={() => handleNavigateSection(sec)}
                      className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-xs hover:bg-secondary transition-colors cursor-pointer"
                    >
                      <div>
                        <span className="font-semibold text-foreground">{sec.label}</span>
                        <span className="ml-2 text-muted-foreground">{sec.description}</span>
                      </div>
                      <span className="font-semibold text-primary">Open →</span>
                    </button>
                  ))}
                </div>
              )}
            </form>
          </div>
        </section>

        {/* Simple Health-Screening Guidance */}
        <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div className="rounded-2xl border border-border bg-card p-5 shadow-xs flex flex-col justify-between space-y-3">
            <div className="space-y-1.5">
              <span className="inline-flex items-center rounded-md bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary">
                Step 1 · Patient Intake
              </span>
              <h2 className="text-base font-bold text-foreground">Enter Patient Details</h2>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Provide patient demographics, vital signs, laboratory test values, or upload a
                clinical report inside the Patient screening page.
              </p>
            </div>
            <div>
              <button
                type="button"
                onClick={() => {
                  setWorkflowStep("patient");
                  navigate({ to: "/screen" });
                }}
                className="text-xs font-semibold text-primary hover:underline cursor-pointer"
              >
                Open Patient Page →
              </button>
            </div>
          </div>

          <div className="rounded-2xl border border-border bg-card p-5 shadow-xs flex flex-col justify-between space-y-3">
            <div className="space-y-1.5">
              <span className="inline-flex items-center rounded-md bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary">
                Step 2 · Automatic Processing
              </span>
              <h2 className="text-base font-bold text-foreground">Instant Screening Evaluation</h2>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Submitted patient details or uploaded clinical documents are processed automatically
                to evaluate applicable health conditions without duplicate steps.
              </p>
            </div>
            <div>
              <button
                type="button"
                onClick={() => {
                  setWorkflowStep("patient");
                  navigate({ to: "/screen" });
                }}
                className="text-xs font-semibold text-primary hover:underline cursor-pointer"
              >
                Start Screening →
              </button>
            </div>
          </div>

          <div className="rounded-2xl border border-border bg-card p-5 shadow-xs flex flex-col justify-between space-y-3">
            <div className="space-y-1.5">
              <span className="inline-flex items-center rounded-md bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary">
                Step 3 · Results &amp; History
              </span>
              <h2 className="text-base font-bold text-foreground">
                Screening Results &amp; Guidance
              </h2>
              <p className="text-xs text-muted-foreground leading-relaxed">
                View clear risk summaries, contributing health factors, and recommended clinical
                next steps, or revisit previous records in History.
              </p>
            </div>
            <div className="flex items-center gap-4">
              <Link to="/results" className="text-xs font-semibold text-primary hover:underline">
                View Results →
              </Link>
              <Link
                to="/history"
                className="text-xs font-semibold text-muted-foreground hover:text-foreground hover:underline"
              >
                Browse History →
              </Link>
            </div>
          </div>
        </section>

        {error && <Alert>{error}</Alert>}

        {/* Recent Screening Activity */}
        <section className="rounded-2xl border border-border bg-card p-6 shadow-xs space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-3">
            <div>
              <h2 className="text-lg font-bold text-foreground">Recent Screening Activity</h2>
              <p className="text-xs text-muted-foreground">
                Recent patient health screenings and risk summaries saved in your history
              </p>
            </div>
            <Link
              to="/history"
              className="rounded-lg border border-border bg-secondary/50 px-3.5 py-1.5 text-xs font-semibold text-foreground hover:bg-secondary transition-colors"
            >
              View History
            </Link>
          </div>

          {recentRecords.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border py-10 px-6 text-center space-y-3">
              <p className="text-sm font-medium text-muted-foreground">
                No screening records have been saved yet.
              </p>
              <div>
                <button
                  type="button"
                  onClick={() => {
                    setWorkflowStep("patient");
                    navigate({ to: "/screen" });
                  }}
                  className="rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground shadow-xs hover:opacity-95 cursor-pointer"
                >
                  New Screening
                </button>
              </div>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-border text-muted-foreground">
                    <th className="py-2.5 pr-4 font-semibold">Patient Name</th>
                    <th className="py-2.5 px-4 font-semibold">Date</th>
                    <th className="py-2.5 px-4 font-semibold">Screening Status</th>
                    <th className="py-2.5 px-4 font-semibold">Risk Summary</th>
                    <th className="py-2.5 pl-4 text-right font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {recentRecords.slice(0, 5).map((item) => {
                    const patientName = item.patient_name || item.patient_ref || "Unnamed Patient";
                    const formattedDate = item.created_at
                      ? new Date(item.created_at).toLocaleString(undefined, {
                          year: "numeric",
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })
                      : "N/A";
                    const statusText =
                      item.status === "completed" ? "Completed" : item.status || "Completed";
                    const riskSummary = buildRiskSummary(item);

                    return (
                      <tr key={item.id} className="hover:bg-secondary/20 transition-colors">
                        <td className="py-3 pr-4 font-semibold text-foreground">
                          {patientName}
                          {item.patient_ref && item.patient_name && (
                            <span className="ml-1.5 font-mono text-[11px] font-normal text-muted-foreground">
                              ({item.patient_ref})
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-muted-foreground whitespace-nowrap">
                          {formattedDate}
                        </td>
                        <td className="py-3 px-4">
                          <span className="inline-flex items-center rounded-md bg-emerald-500/15 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                            {statusText}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-foreground">{riskSummary}</td>
                        <td className="py-3 pl-4 text-right whitespace-nowrap space-x-3">
                          <button
                            type="button"
                            onClick={() => handleOpenRecentResult(item)}
                            className="font-semibold text-primary hover:underline cursor-pointer"
                          >
                            View Results
                          </button>
                          <Link
                            to="/history"
                            className="font-semibold text-muted-foreground hover:text-foreground hover:underline"
                          >
                            History →
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </AppShell>
  );
}
