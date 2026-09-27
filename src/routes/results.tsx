import React, { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { AppShell } from "../components/AppShell";
import { DISEASE_CONFIGS } from "../lib/diseases";
import { useScreeningStore } from "../lib/store";
import { runPatientScreening, saveScreeningToHistory } from "../lib/api";
import type { PredictionResponse, RiskCategory } from "../lib/types";

export const Route = createFileRoute("/results")({
  component: ResultsPage,
});

function getRiskBadgeStyle(risk: RiskCategory, status: string) {
  if (status === "insufficient_data" || status === "skipped" || risk === "Insufficient Data") {
    return {
      label: "Insufficient Data",
      badgeClass: "border-slate-400/40 bg-slate-500/10 text-slate-700",
      cardBorder: "border-border",
      barColor: "bg-slate-400",
    };
  }
  if (status === "unavailable" || risk === "Unavailable") {
    return {
      label: "Pending Evaluation",
      badgeClass: "border-amber-500/40 bg-amber-500/15 text-amber-900",
      cardBorder: "border-amber-500/30",
      barColor: "bg-amber-500",
    };
  }
  if (risk === "High Risk" || risk === "Higher screening risk") {
    return {
      label: "High Risk",
      badgeClass: "border-destructive/40 bg-destructive/15 text-destructive font-bold",
      cardBorder: "border-destructive/40",
      barColor: "bg-destructive",
    };
  }
  if (risk === "Moderate Risk" || risk === "Moderate screening risk") {
    return {
      label: "Moderate Risk",
      badgeClass: "border-amber-500/40 bg-amber-500/15 text-amber-800 font-bold",
      cardBorder: "border-amber-500/40",
      barColor: "bg-amber-500",
    };
  }
  return {
    label: "Low Risk",
    badgeClass: "border-emerald-500/40 bg-emerald-500/15 text-emerald-700 font-bold",
    cardBorder: "border-emerald-500/30",
    barColor: "bg-emerald-500",
  };
}

function ResultsPage() {
  const navigate = useNavigate();
  const {
    patientInput,
    uploadedReport,
    activeReportId,
    activeScreeningId,
    setActiveScreeningId,
    currentResults,
    setCurrentResults,
    resetSession,
  } = useScreeningStore();

  const [isRunning, setIsRunning] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [riskFilter, setRiskFilter] = useState<string>("all");
  const autoSaveTriggeredRef = useRef(false);

  // Always map all 10 diseases in exact canonical order (1..10)
  const orderedTenResults: PredictionResponse[] = useMemo(() => {
    return DISEASE_CONFIGS.map((cfg) => {
      const match = currentResults.find(
        (r) =>
          r.disease_id === cfg.id ||
          r.disease.toLowerCase() === cfg.name.toLowerCase() ||
          r.model_file?.includes(cfg.modelFileName),
      );
      if (match) {
        return {
          ...match,
          disease: cfg.name,
          disease_id: cfg.id,
          model_file: match.model_file || `models/${cfg.modelFileName}`,
          recommended_next_step: match.recommended_next_step || cfg.recommendedNextStep,
        };
      }
      return {
        disease: cfg.name,
        disease_id: cfg.id,
        status: "insufficient_data",
        prediction: "Insufficient data for this model",
        probability: null,
        confidence: null,
        risk_category: "Insufficient Data",
        missing_features: cfg.requiredFeatureNames,
        explanation: `Additional clinical parameters (${cfg.requiredFeatureNames.join(", ")}) are needed to complete screening for ${cfg.name}.`,
        recommended_next_step: cfg.recommendedNextStep,
        model_file: `models/${cfg.modelFileName}`,
      };
    });
  }, [currentResults]);

  // Ensure any completed screening is automatically saved to History without requiring manual Save
  useEffect(() => {
    if (currentResults.length > 0 && !activeScreeningId && !autoSaveTriggeredRef.current) {
      autoSaveTriggeredRef.current = true;
      saveScreeningToHistory({
        ...patientInput,
        report_id: activeReportId || uploadedReport?.reportId || null,
        uploaded_document_name: uploadedReport?.filename || null,
        uploaded_document_type: uploadedReport?.fileTypeLabel || uploadedReport?.mimeType || null,
        uploaded_document_size: uploadedReport?.fileSize || null,
        extracted_data: uploadedReport?.extractedData || null,
        results: orderedTenResults,
        predictions: orderedTenResults,
      })
        .then((res) => {
          if (res.record_id || res.screening_id) {
            setActiveScreeningId(res.record_id || res.screening_id);
          }
        })
        .catch(() => {
          // Non-fatal
        });
    }
  }, [
    currentResults.length,
    activeScreeningId,
    patientInput,
    activeReportId,
    uploadedReport,
    orderedTenResults,
    setActiveScreeningId,
  ]);

  const filteredResults = useMemo(() => {
    if (riskFilter === "all") return orderedTenResults;
    return orderedTenResults.filter((r) => {
      const style = getRiskBadgeStyle(r.risk_category, r.status);
      if (riskFilter === "high") return style.label === "High Risk";
      if (riskFilter === "moderate") return style.label === "Moderate Risk";
      if (riskFilter === "low") return style.label === "Low Risk";
      if (riskFilter === "insufficient")
        return (
          r.status === "insufficient_data" || r.prediction === "Insufficient data for this model"
        );
      return true;
    });
  }, [orderedTenResults, riskFilter]);

  const counts = useMemo(() => {
    let high = 0;
    let moderate = 0;
    let low = 0;
    let insufficient = 0;

    for (const r of orderedTenResults) {
      const style = getRiskBadgeStyle(r.risk_category, r.status);
      if (
        r.status === "insufficient_data" ||
        r.status === "skipped" ||
        r.prediction === "Insufficient data for this model"
      ) {
        insufficient++;
      } else if (style.label === "High Risk") {
        high++;
      } else if (style.label === "Moderate Risk") {
        moderate++;
      } else if (style.label === "Low Risk") {
        low++;
      }
    }
    return { high, moderate, low, insufficient };
  }, [orderedTenResults]);

  const overallRiskCategory = useMemo(() => {
    if (counts.high > 0) return "High Risk";
    if (counts.moderate > 0) return "Moderate Risk";
    if (counts.low > 0) return "Low Risk";
    return "Insufficient Data";
  }, [counts]);

  const handleRunAllTenModels = async () => {
    setIsRunning(true);
    setErrorMsg(null);
    try {
      const payload: Record<string, unknown> = {
        ...patientInput,
        report_id: activeReportId || uploadedReport?.reportId || null,
        uploaded_document_name: uploadedReport?.filename || null,
        uploaded_document_type: uploadedReport?.fileTypeLabel || uploadedReport?.mimeType || null,
        uploaded_document_size: uploadedReport?.fileSize || null,
        extracted_data: uploadedReport?.extractedData || null,
      };
      const res = await runPatientScreening(payload);
      setCurrentResults(res.results || res.predictions || []);
      setActiveScreeningId(res.screening_id || res.record_id || null);
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to run prediction.");
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <AppShell>
      <div className="space-y-6">
        {/* Top Header & Automatic History Persistence Banner */}
        <div className="rounded-xl border border-border bg-card p-6 shadow-xs">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center rounded-md bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary">
                  Health Screening Results
                </span>
                <span className="inline-flex items-center rounded-md bg-emerald-500/15 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">
                  ✓ Automatically Saved to History
                </span>
                {activeScreeningId && (
                  <span className="rounded-md border border-border bg-secondary px-2 py-0.5 font-mono text-[11px] text-muted-foreground">
                    Record ID: {activeScreeningId}
                  </span>
                )}
              </div>
              <h1 className="mt-1.5 text-xl font-bold tracking-tight text-foreground sm:text-2xl">
                Multi-Disease Health Screening Results
              </h1>
              <p className="mt-1 text-xs text-muted-foreground">
                Patient:{" "}
                <strong className="text-foreground">
                  {patientInput.name || patientInput.patient_ref || "Current Patient"}
                </strong>
                {patientInput.age ? ` • Age: ${patientInput.age} yrs` : ""}
                {patientInput.sex ? ` • Sex: ${patientInput.sex}` : ""}
                {patientInput.bmi ? ` • BMI: ${patientInput.bmi} kg/m²` : ""}
                {uploadedReport?.filename ? ` • Document: ${uploadedReport.filename}` : ""}
                {` • Overall Risk Category: ${overallRiskCategory}`}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              <Link
                to="/history"
                className="rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground shadow-xs hover:opacity-95"
              >
                View in History →
              </Link>

              <button
                type="button"
                onClick={handleRunAllTenModels}
                disabled={isRunning}
                className="rounded-lg border border-primary/30 bg-primary/10 px-4 py-2 text-xs font-semibold text-primary hover:bg-primary/20 cursor-pointer disabled:opacity-50"
              >
                {isRunning ? "Evaluating..." : "Re-Run Screening"}
              </button>

              <Link
                to="/screen"
                className="rounded-lg border border-border bg-secondary px-3.5 py-2 text-xs font-semibold text-foreground hover:bg-secondary/80"
              >
                Edit Patient Data
              </Link>

              <button
                type="button"
                onClick={() => {
                  resetSession();
                  navigate({ to: "/screen" });
                }}
                className="rounded-lg border border-border bg-background px-3.5 py-2 text-xs font-medium text-muted-foreground hover:bg-secondary hover:text-foreground cursor-pointer"
              >
                New Screening
              </button>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-2.5 text-xs font-medium text-emerald-800">
            <span>
              ✓ This screening result (including patient details
              {uploadedReport?.filename
                ? `, uploaded document "${uploadedReport.filename}",`
                : ""}{" "}
              and all evaluated risk categories) has been automatically saved to your History.
            </span>
            <Link
              to="/history"
              className="rounded-md bg-emerald-600 px-3 py-1 text-white font-semibold hover:bg-emerald-700 shrink-0"
            >
              Open History →
            </Link>
          </div>

          {uploadedReport?.extractedData && (
            <div className="mt-4 rounded-xl border border-border bg-secondary/20 p-4 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                <span className="font-bold uppercase tracking-wider text-muted-foreground text-[11px]">
                  Extracted Medical Information from {uploadedReport.filename}
                </span>
                <span className="text-[11px] text-muted-foreground">
                  {uploadedReport.fileTypeLabel || uploadedReport.mimeType || "Medical Document"}
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(uploadedReport.extractedData)
                  .filter(
                    ([, v]) =>
                      v !== null &&
                      v !== undefined &&
                      v !== "" &&
                      (!Array.isArray(v) || v.length > 0),
                  )
                  .map(([k, v]) => (
                    <span
                      key={k}
                      className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-[11px]"
                    >
                      <span className="text-muted-foreground">{k.replace(/_/g, " ")}:</span>
                      <span className="font-semibold text-foreground">
                        {Array.isArray(v)
                          ? v.join(", ")
                          : typeof v === "boolean"
                            ? v
                              ? "Yes"
                              : "No"
                            : String(v)}
                      </span>
                    </span>
                  ))}
              </div>
            </div>
          )}

          {errorMsg && (
            <div className="mt-4 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-2.5 text-xs font-medium text-destructive">
              {errorMsg}
            </div>
          )}
        </div>

        {/* Summary Risk Counters & Filter Tabs */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          <button
            type="button"
            onClick={() => setRiskFilter("all")}
            className={`rounded-xl border p-3.5 text-left transition-colors cursor-pointer ${
              riskFilter === "all"
                ? "border-primary bg-primary/5"
                : "border-border bg-card hover:bg-secondary/30"
            }`}
          >
            <span className="text-[11px] font-medium text-muted-foreground block">
              All Conditions
            </span>
            <span className="text-xl font-bold text-foreground">{orderedTenResults.length}</span>
          </button>

          <button
            type="button"
            onClick={() => setRiskFilter("high")}
            className={`rounded-xl border p-3.5 text-left transition-colors cursor-pointer ${
              riskFilter === "high"
                ? "border-destructive bg-destructive/10"
                : "border-border bg-card hover:bg-secondary/30"
            }`}
          >
            <span className="text-[11px] font-medium text-destructive block">High Risk</span>
            <span className="text-xl font-bold text-destructive">{counts.high}</span>
          </button>

          <button
            type="button"
            onClick={() => setRiskFilter("moderate")}
            className={`rounded-xl border p-3.5 text-left transition-colors cursor-pointer ${
              riskFilter === "moderate"
                ? "border-amber-500 bg-amber-500/10"
                : "border-border bg-card hover:bg-secondary/30"
            }`}
          >
            <span className="text-[11px] font-medium text-amber-800 block">Moderate Risk</span>
            <span className="text-xl font-bold text-amber-800">{counts.moderate}</span>
          </button>

          <button
            type="button"
            onClick={() => setRiskFilter("low")}
            className={`rounded-xl border p-3.5 text-left transition-colors cursor-pointer ${
              riskFilter === "low"
                ? "border-emerald-500 bg-emerald-500/10"
                : "border-border bg-card hover:bg-secondary/30"
            }`}
          >
            <span className="text-[11px] font-medium text-emerald-700 block">Low Risk</span>
            <span className="text-xl font-bold text-emerald-700">{counts.low}</span>
          </button>

          <button
            type="button"
            onClick={() => setRiskFilter("insufficient")}
            className={`rounded-xl border p-3.5 text-left transition-colors cursor-pointer ${
              riskFilter === "insufficient"
                ? "border-slate-500 bg-slate-500/10"
                : "border-border bg-card hover:bg-secondary/30"
            }`}
          >
            <span className="text-[11px] font-medium text-muted-foreground block">
              Insufficient Data
            </span>
            <span className="text-xl font-bold text-foreground">{counts.insufficient}</span>
          </button>
        </div>

        {/* Disease Prediction Cards */}
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          {filteredResults.map((res, idx) => {
            const style = getRiskBadgeStyle(res.risk_category, res.status);
            const isInsufficient =
              res.status === "insufficient_data" ||
              res.status === "skipped" ||
              res.prediction === "Insufficient data for this model";

            const probPct =
              typeof res.probability === "number" && Number.isFinite(res.probability)
                ? `${(res.probability > 1 ? res.probability : res.probability * 100).toFixed(1)}%`
                : null;

            const topFeatures = res.top_features || [];
            const inputsEntries = res.inputs_used ? Object.entries(res.inputs_used) : [];

            return (
              <div
                key={res.disease_id || res.disease}
                className={`rounded-xl border bg-card p-5 shadow-xs flex flex-col justify-between space-y-4 ${style.cardBorder}`}
              >
                <div className="space-y-3">
                  {/* Card Header: Disease Name + Risk Category Badge */}
                  <div className="flex items-start justify-between gap-3 border-b border-border pb-3">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-muted-foreground">#{idx + 1}</span>
                      <h2 className="text-base font-bold text-foreground">{res.disease}</h2>
                    </div>

                    <span
                      className={`inline-flex items-center rounded-full border px-3 py-1 text-xs ${style.badgeClass}`}
                    >
                      {style.label}
                    </span>
                  </div>

                  {/* Patient-Friendly Summary Row */}
                  <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3 rounded-lg border border-border bg-secondary/20 p-3 text-xs">
                    <div>
                      <span className="text-[11px] text-muted-foreground block">
                        Screening Finding
                      </span>
                      <span className="font-semibold text-foreground">
                        {isInsufficient ? "Insufficient data" : res.prediction || "Not available"}
                      </span>
                    </div>

                    <div>
                      <span className="text-[11px] text-muted-foreground block">Risk Level</span>
                      <span className="font-semibold text-foreground">
                        {isInsufficient ? "Insufficient Data" : style.label}
                      </span>
                    </div>

                    <div>
                      <span className="text-[11px] text-muted-foreground block">
                        Estimated Risk Score
                      </span>
                      <span className="font-mono font-bold text-foreground">
                        {probPct ? probPct : isInsufficient ? "Not available" : "Pending"}
                      </span>
                    </div>
                  </div>

                  {/* Risk Indicator Bar if available */}
                  {probPct && typeof res.probability === "number" && (
                    <div className="space-y-1">
                      <div className="flex justify-between text-[11px]">
                        <span className="text-muted-foreground">Estimated Screening Risk</span>
                        <span className="font-mono font-semibold text-foreground">{probPct}</span>
                      </div>
                      <div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
                        <div
                          className={`h-full rounded-full ${style.barColor}`}
                          style={{
                            width: `${Math.min(
                              100,
                              Math.max(
                                2,
                                res.probability > 1 ? res.probability : res.probability * 100,
                              ),
                            )}%`,
                          }}
                        />
                      </div>
                    </div>
                  )}

                  {/* Missing Required Features (when Insufficient Data) */}
                  {isInsufficient && res.missing_features && res.missing_features.length > 0 && (
                    <div className="rounded-lg border border-border bg-secondary/30 p-2.5 text-xs">
                      <span className="font-semibold text-foreground">
                        Additional Clinical Inputs Needed:{" "}
                      </span>
                      <span className="text-muted-foreground">
                        {res.missing_features.join(", ")}
                      </span>
                    </div>
                  )}

                  {/* Key Contributing Health Factors */}
                  {topFeatures.length > 0 ? (
                    <div className="text-xs">
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground block mb-1.5">
                        Key Contributing Factors
                      </span>
                      <div className="flex flex-wrap gap-1.5">
                        {topFeatures.map((tf) => (
                          <span
                            key={tf.name}
                            className="inline-flex items-center rounded-md border border-border bg-background px-2.5 py-0.5 text-[11px] font-medium text-foreground"
                          >
                            {tf.name}
                          </span>
                        ))}
                      </div>
                    </div>
                  ) : (
                    !isInsufficient &&
                    inputsEntries.length > 0 && (
                      <div className="text-xs">
                        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground block mb-1.5">
                          Evaluated Patient Measurements
                        </span>
                        <div className="flex flex-wrap gap-1.5">
                          {inputsEntries.slice(0, 6).map(([k, v]) => (
                            <span
                              key={k}
                              className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-0.5 text-[11px]"
                            >
                              <span className="text-muted-foreground">{k}:</span>
                              <span className="font-semibold text-foreground">{String(v)}</span>
                            </span>
                          ))}
                        </div>
                      </div>
                    )
                  )}

                  {/* Short Clinical Summary */}
                  <div className="text-xs">
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground block mb-1">
                      Clinical Summary
                    </span>
                    <p className="text-foreground/90 leading-relaxed">{res.explanation}</p>
                  </div>
                </div>

                {/* Recommended Next Step */}
                <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-xs">
                  <span className="font-semibold text-primary block text-[11px] uppercase tracking-wider">
                    Recommended Next Step
                  </span>
                  <p className="mt-0.5 text-foreground font-medium">
                    {res.recommended_next_step ||
                      "Discuss these screening results with a qualified healthcare professional."}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </AppShell>
  );
}
