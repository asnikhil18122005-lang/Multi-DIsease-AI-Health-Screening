import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { AppShell } from "../components/AppShell";
import { DISEASE_CONFIGS } from "../lib/diseases";
import { deleteScreeningRecord, fetchScreeningDetail, fetchScreeningHistory } from "../lib/api";
import { INITIAL_PATIENT_INPUT, useScreeningStore } from "../lib/store";
import type { PredictionResponse, ScreeningRecord } from "../lib/types";

export const Route = createFileRoute("/history")({
  component: HistoryBrowserPage,
});

function formatDateTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function HistoryBrowserPage() {
  const navigate = useNavigate();
  const { setPatientInput, setCurrentResults, setActiveScreeningId, setActiveReportId } =
    useScreeningStore();

  const [records, setRecords] = useState<ScreeningRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Browser-style Omni-Search & Filters (Requirement 10)
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedDisease, setSelectedDisease] = useState("all");
  const [selectedRiskFilter, setSelectedRiskFilter] = useState("all");
  const [timeRangeFilter, setTimeRangeFilter] = useState<"all" | "today" | "7d" | "30d">("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  // Selected record for detailed inspection
  const [selectedRecordId, setSelectedRecordId] = useState<string | null>(null);
  const [detailedRecord, setDetailedRecord] = useState<{
    screening: ScreeningRecord;
    predictions: PredictionResponse[];
    report: Record<string, unknown> | null;
  } | null>(null);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);

  const loadHistory = useCallback(async () => {
    setIsLoading(true);
    setErrorMsg(null);
    try {
      const res = await fetchScreeningHistory({
        search: searchQuery.trim() || undefined,
        disease: selectedDisease !== "all" ? selectedDisease : undefined,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
      });
      setRecords(res.screenings || []);
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to load persistent history.");
    } finally {
      setIsLoading(false);
    }
  }, [searchQuery, selectedDisease, dateFrom, dateTo]);

  useEffect(() => {
    const timer = setTimeout(() => {
      loadHistory();
    }, 180);
    return () => clearTimeout(timer);
  }, [loadHistory]);

  const handleInspectRecord = async (record: ScreeningRecord) => {
    if (selectedRecordId === record.id) {
      setSelectedRecordId(null);
      setDetailedRecord(null);
      return;
    }
    setSelectedRecordId(record.id);
    setIsLoadingDetail(true);
    try {
      const detail = await fetchScreeningDetail(record.id);
      setDetailedRecord(detail);
    } catch {
      setDetailedRecord({
        screening: record,
        predictions: record.predictions || record.results_payload?.results || [],
        report: record.uploaded_document || null,
      });
    } finally {
      setIsLoadingDetail(false);
    }
  };

  const handleDeleteRecord = async (id: string) => {
    try {
      await deleteScreeningRecord(id);
      setRecords((prev) => prev.filter((r) => r.id !== id));
      if (selectedRecordId === id) {
        setSelectedRecordId(null);
        setDetailedRecord(null);
      }
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to delete history record.");
    }
  };

  const handleOpenInResultsView = (record: ScreeningRecord) => {
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

  // Client-side instant refinement (browser-like omni-search across all fields + risk/time filters)
  const filteredRecords = useMemo(() => {
    const now = Date.now();
    return records.filter((rec) => {
      // Time range quick filter
      if (timeRangeFilter !== "all") {
        const createdMs = new Date(rec.created_at).getTime();
        if (Number.isFinite(createdMs)) {
          const diffHours = (now - createdMs) / (1000 * 60 * 60);
          if (timeRangeFilter === "today" && diffHours > 24) return false;
          if (timeRangeFilter === "7d" && diffHours > 24 * 7) return false;
          if (timeRangeFilter === "30d" && diffHours > 24 * 30) return false;
        }
      }

      const preds = rec.predictions || rec.results_payload?.results || [];

      // Risk category filter
      if (selectedRiskFilter !== "all") {
        const hasRisk = preds.some((p) => {
          const rc = (p.risk_category || "").toLowerCase();
          if (selectedRiskFilter === "high") return rc.includes("high");
          if (selectedRiskFilter === "moderate") return rc.includes("moderate");
          if (selectedRiskFilter === "low") return rc.includes("low");
          return false;
        });
        if (!hasRisk) return false;
      }

      // Omni-search query matching
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const searchableText = [
          rec.id,
          rec.record_id,
          rec.patient_ref,
          rec.patient_name,
          rec.patient_sex,
          rec.patient_age ? String(rec.patient_age) : "",
          rec.uploaded_document_name,
          rec.uploaded_document_type,
          rec.summary,
          rec.created_at,
          formatDateTime(rec.created_at),
          JSON.stringify(rec.input_payload || {}),
          JSON.stringify(preds.map((p) => `${p.disease} ${p.risk_category} ${p.prediction}`)),
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();

        if (!searchableText.includes(q)) return false;
      }

      return true;
    });
  }, [records, timeRangeFilter, selectedRiskFilter, searchQuery]);

  return (
    <AppShell>
      <div className="space-y-6">
        {/* Browser-Like History Search Header (Requirement 9 & 10) */}
        <div className="rounded-xl border border-border bg-card p-6 shadow-xs space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <span className="inline-flex items-center rounded-md bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary">
                Persistent SQLite Clinical History
              </span>
              <h1 className="mt-1 text-xl font-bold tracking-tight text-foreground sm:text-2xl">
                Patient Screening &amp; Prediction History Browser
              </h1>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Search across patient names, record IDs, uploaded documents, biomarkers, 10-disease
                predictions, risk levels, and timestamps. All records persist across browser
                refreshes.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => loadHistory()}
                className="rounded-lg border border-border bg-secondary px-3.5 py-2 text-xs font-semibold text-foreground hover:bg-secondary/80 cursor-pointer"
              >
                Refresh History
              </button>
              <Link
                to="/screen"
                className="rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground shadow-xs hover:opacity-95"
              >
                + New Screening
              </Link>
            </div>
          </div>

          {/* Browser-Style Omni-Search Bar */}
          <div className="relative">
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search history like a browser — enter Patient Name, Record ID, Document Name, Disease, Risk Category (e.g. High Risk), or Date..."
              className="w-full rounded-xl border border-input bg-background px-4 py-3 text-sm text-foreground shadow-2xs focus:border-primary focus:outline-none"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md bg-secondary px-2 py-1 text-xs font-medium text-muted-foreground hover:text-foreground cursor-pointer"
              >
                Clear
              </button>
            )}
          </div>

          {/* Quick Filter Bar: Timeframe, Risk Level, Disease, Date Range */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-1 text-xs">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-muted-foreground font-medium mr-1">Timeframe:</span>
              {[
                { id: "all", label: "All Time" },
                { id: "today", label: "Today" },
                { id: "7d", label: "Last 7 Days" },
                { id: "30d", label: "Last 30 Days" },
              ].map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTimeRangeFilter(t.id as "all" | "today" | "7d" | "30d")}
                  className={`rounded-lg px-2.5 py-1 font-medium transition-colors cursor-pointer ${
                    timeRangeFilter === t.id
                      ? "bg-primary text-primary-foreground"
                      : "border border-border bg-secondary/40 text-foreground hover:bg-secondary"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <select
                value={selectedRiskFilter}
                onChange={(e) => setSelectedRiskFilter(e.target.value)}
                className="rounded-lg border border-input bg-background px-2.5 py-1.5 text-xs text-foreground"
              >
                <option value="all">All Risk Categories</option>
                <option value="high">High Risk Flagged</option>
                <option value="moderate">Moderate Risk Flagged</option>
                <option value="low">Low Risk</option>
              </select>

              <select
                value={selectedDisease}
                onChange={(e) => setSelectedDisease(e.target.value)}
                className="rounded-lg border border-input bg-background px-2.5 py-1.5 text-xs text-foreground"
              >
                <option value="all">All 10 Diseases</option>
                {DISEASE_CONFIGS.map((d) => (
                  <option key={d.id} value={d.name}>
                    {d.name}
                  </option>
                ))}
              </select>

              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                title="From Date"
                className="rounded-lg border border-input bg-background px-2.5 py-1 text-xs text-foreground"
              />
              <span className="text-muted-foreground">to</span>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                title="To Date"
                className="rounded-lg border border-input bg-background px-2.5 py-1 text-xs text-foreground"
              />
            </div>
          </div>
        </div>

        {errorMsg && (
          <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-xs font-medium text-destructive">
            {errorMsg}
          </div>
        )}

        {/* Results Count */}
        <div className="flex items-center justify-between text-xs text-muted-foreground px-1">
          <span>
            Showing <strong className="text-foreground">{filteredRecords.length}</strong> saved
            screening record(s)
          </span>
          <span>
            Click any history entry to inspect all 10 disease predictions &amp; patient data
          </span>
        </div>

        {/* History List */}
        {isLoading ? (
          <div className="rounded-xl border border-border bg-card p-12 text-center text-sm text-muted-foreground">
            Loading persistent patient history records...
          </div>
        ) : filteredRecords.length === 0 ? (
          <div className="rounded-xl border border-border bg-card p-12 text-center space-y-3">
            <p className="text-base font-semibold text-foreground">
              No matching patient history records found
            </p>
            <p className="text-xs text-muted-foreground max-w-md mx-auto">
              Enter patient details or upload a medical document on the Patient Screening page —
              predictions run automatically and every completed screening is saved directly to
              History.
            </p>
            <div>
              <Link
                to="/screen"
                className="inline-flex items-center rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground"
              >
                Start Patient Screening →
              </Link>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {filteredRecords.map((rec) => {
              const isExpanded = selectedRecordId === rec.id;
              const preds = rec.predictions || rec.results_payload?.results || [];
              const input = rec.entered_patient_info || rec.input_payload || {};
              const extracted =
                rec.extracted_medical_info || rec.results_payload?.extracted_medical_info || null;
              const patientName =
                rec.patient_name || String(input["name"] || rec.patient_ref || "Unnamed Patient");
              const patientAge = rec.patient_age ?? (input["age"] ? Number(input["age"]) : null);
              const patientSex = rec.patient_sex || (input["sex"] ? String(input["sex"]) : null);
              const docName =
                rec.uploaded_document_name ||
                (input["uploaded_document_name"] as string) ||
                rec.uploaded_document?.filename ||
                null;
              const docType =
                rec.uploaded_document_type ||
                (input["uploaded_document_type"] as string) ||
                rec.uploaded_document?.mime_type ||
                null;

              const highCount = preds.filter((p) =>
                (p.risk_category || "").toLowerCase().includes("high"),
              ).length;
              const modCount = preds.filter((p) =>
                (p.risk_category || "").toLowerCase().includes("moderate"),
              ).length;
              const lowCount = preds.filter((p) =>
                (p.risk_category || "").toLowerCase().includes("low"),
              ).length;

              return (
                <div
                  key={rec.id}
                  className="rounded-xl border border-border bg-card shadow-xs overflow-hidden transition-colors"
                >
                  {/* Browser History Row Summary */}
                  <div
                    onClick={() => handleInspectRecord(rec)}
                    className="flex flex-col gap-3 p-5 hover:bg-secondary/25 transition-colors cursor-pointer lg:flex-row lg:items-center lg:justify-between"
                  >
                    <div className="space-y-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-base font-bold text-foreground">{patientName}</span>
                        <span className="rounded-md border border-border bg-secondary px-2 py-0.5 font-mono text-[11px] text-muted-foreground">
                          Record ID: {rec.id}
                        </span>
                        <span className="rounded-md bg-primary/10 px-2 py-0.5 font-mono text-[11px] font-medium text-primary">
                          Ref: {rec.patient_ref}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          • {formatDateTime(rec.created_at)}
                        </span>
                      </div>

                      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                        <span>
                          Age:{" "}
                          <strong className="text-foreground">
                            {patientAge !== null ? `${patientAge} yrs` : "N/A"}
                          </strong>
                        </span>
                        <span>
                          Sex: <strong className="text-foreground">{patientSex || "N/A"}</strong>
                        </span>
                        {docName && (
                          <span className="inline-flex items-center gap-1 rounded bg-secondary/70 px-2 py-0.5 text-[11px] text-foreground">
                            📄 Document: <strong>{docName}</strong> ({docType || "Document"})
                          </span>
                        )}
                      </div>

                      <p className="text-xs text-muted-foreground">{rec.summary}</p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      {highCount > 0 && (
                        <span className="rounded-full border border-destructive/40 bg-destructive/15 px-2.5 py-1 text-[11px] font-bold text-destructive">
                          {highCount} High Risk
                        </span>
                      )}
                      {modCount > 0 && (
                        <span className="rounded-full border border-amber-500/40 bg-amber-500/15 px-2.5 py-1 text-[11px] font-bold text-amber-800">
                          {modCount} Moderate Risk
                        </span>
                      )}
                      {lowCount > 0 && (
                        <span className="rounded-full border border-emerald-500/40 bg-emerald-500/15 px-2.5 py-1 text-[11px] font-bold text-emerald-700">
                          {lowCount} Low Risk
                        </span>
                      )}

                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleOpenInResultsView(rec);
                        }}
                        className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-95 cursor-pointer"
                      >
                        Open in Results
                      </button>

                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteRecord(rec.id);
                        }}
                        className="rounded-lg border border-destructive/30 bg-destructive/10 px-2.5 py-1.5 text-xs font-semibold text-destructive hover:bg-destructive/20 cursor-pointer"
                      >
                        Delete
                      </button>
                    </div>
                  </div>

                  {/* Expanded Full Record Details (Requirement 9) */}
                  {isExpanded && (
                    <div className="border-t border-border bg-secondary/10 p-5 space-y-5 text-xs">
                      {isLoadingDetail ? (
                        <p className="text-muted-foreground">Loading full record details...</p>
                      ) : (
                        <>
                          {/* Top Metadata Grid */}
                          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                            {/* 1. Patient & Timestamp Details */}
                            <div className="rounded-lg border border-border bg-card p-4 space-y-2">
                              <h3 className="font-semibold text-foreground uppercase tracking-wider text-[11px] border-b border-border pb-1.5">
                                Record &amp; Patient Identity
                              </h3>
                              <div className="space-y-1">
                                <p>
                                  <span className="text-muted-foreground">Record ID:</span>{" "}
                                  <span className="font-mono font-semibold">{rec.id}</span>
                                </p>
                                <p>
                                  <span className="text-muted-foreground">Date &amp; Time:</span>{" "}
                                  <span className="font-semibold">
                                    {formatDateTime(rec.created_at)}
                                  </span>
                                </p>
                                <p>
                                  <span className="text-muted-foreground">ISO Timestamp:</span>{" "}
                                  <span className="font-mono">{rec.created_at}</span>
                                </p>
                                <p>
                                  <span className="text-muted-foreground">Patient Name:</span>{" "}
                                  <span className="font-semibold">{patientName}</span>
                                </p>
                                <p>
                                  <span className="text-muted-foreground">Patient Age:</span>{" "}
                                  <span className="font-semibold">
                                    {patientAge !== null ? `${patientAge} years` : "Not specified"}
                                  </span>
                                </p>
                                <p>
                                  <span className="text-muted-foreground">Patient Sex:</span>{" "}
                                  <span className="font-semibold">
                                    {patientSex || "Not specified"}
                                  </span>
                                </p>
                              </div>
                            </div>

                            {/* 2. Entered Patient Clinical Information */}
                            <div className="rounded-lg border border-border bg-card p-4 space-y-2">
                              <h3 className="font-semibold text-foreground uppercase tracking-wider text-[11px] border-b border-border pb-1.5">
                                Entered Patient Information
                              </h3>
                              <div className="grid grid-cols-2 gap-1.5">
                                {Object.entries(input)
                                  .filter(
                                    ([k, v]) =>
                                      v !== null &&
                                      v !== undefined &&
                                      v !== "" &&
                                      v !== false &&
                                      ![
                                        "extracted_data",
                                        "remote_predictions",
                                        "uploaded_document_name",
                                        "uploaded_document_type",
                                        "uploaded_document_size",
                                      ].includes(k),
                                  )
                                  .slice(0, 14)
                                  .map(([k, v]) => (
                                    <div key={k} className="truncate">
                                      <span className="text-muted-foreground">{k}: </span>
                                      <span className="font-semibold text-foreground">
                                        {Array.isArray(v) ? v.join(", ") : String(v)}
                                      </span>
                                    </div>
                                  ))}
                              </div>
                            </div>

                            {/* 3. Uploaded Document & Extracted Medical Information */}
                            <div className="rounded-lg border border-border bg-card p-4 space-y-2">
                              <h3 className="font-semibold text-foreground uppercase tracking-wider text-[11px] border-b border-border pb-1.5">
                                Uploaded Document &amp; Extracted Info
                              </h3>
                              {docName || rec.report_id ? (
                                <div className="space-y-1.5">
                                  <p>
                                    <span className="text-muted-foreground">Document Name:</span>{" "}
                                    <span className="font-semibold">
                                      {docName || "Uploaded Report"}
                                    </span>
                                  </p>
                                  <p>
                                    <span className="text-muted-foreground">Document Type:</span>{" "}
                                    <span className="font-semibold">{docType || "Document"}</span>
                                  </p>
                                  {rec.report_id && (
                                    <div className="pt-1">
                                      <a
                                        href={`/api/reports/${rec.report_id}/download`}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="inline-flex items-center rounded-md bg-primary/10 px-2.5 py-1 text-[11px] font-semibold text-primary hover:bg-primary/20"
                                      >
                                        Download / View Original Document ↗
                                      </a>
                                    </div>
                                  )}
                                  {extracted && Object.keys(extracted).length > 0 && (
                                    <div className="pt-2 border-t border-border">
                                      <span className="text-[10px] font-semibold uppercase text-muted-foreground block mb-1">
                                        Extracted Report Values:
                                      </span>
                                      <div className="flex flex-wrap gap-1">
                                        {Object.entries(extracted)
                                          .filter(
                                            ([, v]) => v !== null && v !== undefined && v !== "",
                                          )
                                          .slice(0, 8)
                                          .map(([k, v]) => (
                                            <span
                                              key={k}
                                              className="rounded border border-border bg-secondary/30 px-1.5 py-0.5 text-[10px]"
                                            >
                                              {k}: <strong>{String(v)}</strong>
                                            </span>
                                          ))}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              ) : (
                                <p className="text-muted-foreground italic">
                                  No medical document was uploaded with this screening.
                                </p>
                              )}
                            </div>
                          </div>

                          {/* All 10 Disease Prediction Results Table */}
                          <div className="rounded-lg border border-border bg-card overflow-hidden">
                            <div className="border-b border-border bg-secondary/30 px-4 py-2.5 font-semibold text-foreground">
                              Prediction Results Across All 10 Disease Models
                            </div>
                            <div className="overflow-x-auto">
                              <table className="w-full text-left border-collapse text-xs">
                                <thead>
                                  <tr className="border-b border-border bg-secondary/15 text-[11px] text-muted-foreground">
                                    <th className="py-2.5 px-3">Disease</th>
                                    <th className="py-2.5 px-3">Prediction</th>
                                    <th className="py-2.5 px-3">Risk Category</th>
                                    <th className="py-2.5 px-3">Probability / Confidence</th>
                                    <th className="py-2.5 px-3">Explanation</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-border">
                                  {(detailedRecord?.predictions?.length
                                    ? detailedRecord.predictions
                                    : preds
                                  ).map((p) => {
                                    const probStr =
                                      typeof p.probability === "number"
                                        ? `${(p.probability > 1 ? p.probability : p.probability * 100).toFixed(2)}%`
                                        : "N/A";
                                    return (
                                      <tr key={p.disease} className="hover:bg-secondary/10">
                                        <td className="py-2.5 px-3 font-semibold text-foreground">
                                          {p.disease}
                                        </td>
                                        <td className="py-2.5 px-3 text-foreground">
                                          {p.prediction || "Insufficient data for this model"}
                                        </td>
                                        <td className="py-2.5 px-3 font-semibold">
                                          {p.risk_category}
                                        </td>
                                        <td className="py-2.5 px-3 font-mono">{probStr}</td>
                                        <td className="py-2.5 px-3 text-muted-foreground max-w-md">
                                          {p.explanation}
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </AppShell>
  );
}
