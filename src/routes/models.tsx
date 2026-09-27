import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Badge, Card, Spinner } from "@/components/ui";
import { getModelStatusList, trainAllModels, type ModelDetailItem } from "@/lib/api";
import { useScreeningStore } from "@/lib/store";

export const Route = createFileRoute("/models")({
  head: () => ({
    meta: [
      { title: "Model Status & Architecture | Multi-Disease AI Health Screening" },
      {
        name: "description",
        content:
          "Real-time connection status, training metrics, feature requirements, and model architecture across all 10 supported disease prediction services.",
      },
    ],
  }),
  component: ModelsStatusPage,
});

export function ModelsStatusPage() {
  const { refreshModelStatuses } = useScreeningStore();
  const [models, setModels] = useState<ModelDetailItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [isTraining, setIsTraining] = useState(false);
  const [trainSuccessMsg, setTrainSuccessMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getModelStatusList();
      setModels(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load model statuses.");
    } finally {
      setLoading(false);
    }
  };

  const handleTrainAndConnectAll = async () => {
    setIsTraining(true);
    setError(null);
    setTrainSuccessMsg(null);
    try {
      const res = await trainAllModels();
      await fetchStatus();
      await refreshModelStatuses(true);
      setTrainSuccessMsg(
        `Successfully trained, calibrated, and connected ${res.models_trained}/10 .joblib models and StandardScalers in models/.`,
      );
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to train models.");
    } finally {
      setIsTraining(false);
    }
  };

  useEffect(() => {
    void fetchStatus();
  }, []);

  const connectedCount = models.filter(
    (m) => m.loaded || m.available || m.status === "Loaded" || m.status === "Connected",
  ).length;

  return (
    <AppShell>
      <div className="space-y-6">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Badge tone="primary">Production Architecture</Badge>
              <span className="text-xs text-muted-foreground">
                10 Diagnostic Prediction Services
              </span>
            </div>
            <h1 className="mt-1 text-2xl font-extrabold tracking-tight md:text-3xl">
              Model Training &amp; Connection Status
            </h1>
            <p className="text-xs text-muted-foreground">
              Direct verification of all 10 trained <code>.joblib</code> disease models and
              StandardScalers connected in <code>models/</code>.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              onClick={handleTrainAndConnectAll}
              disabled={isTraining || loading}
              type="button"
              className="rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground shadow-xs hover:opacity-95 cursor-pointer disabled:opacity-50"
            >
              {isTraining ? "Training All 10 Models..." : "Train & Re-Calibrate All 10 Models"}
            </button>
            <button
              onClick={fetchStatus}
              className="btn-secondary text-xs"
              disabled={loading || isTraining}
              type="button"
            >
              {loading ? "Checking…" : "Refresh Status"}
            </button>
          </div>
        </div>

        {trainSuccessMsg && (
          <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-xs font-semibold text-emerald-800">
            ✓ {trainSuccessMsg}
          </div>
        )}

        {/* Global connection summary banner */}
        <div className="grid gap-4 sm:grid-cols-3">
          <Card className="flex flex-col gap-1 border-primary/20 bg-primary/5 p-4">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Total Models
            </span>
            <span className="text-2xl font-black">{models.length || 10}</span>
            <span className="text-xs text-muted-foreground">Diagnostic pipelines configured</span>
          </Card>

          <Card className="flex flex-col gap-1 border-border p-4">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Connected Models
            </span>
            <div className="flex items-center gap-2">
              <span className="text-2xl font-black text-emerald-600 dark:text-emerald-400">
                {connectedCount} / 10
              </span>
              <Badge tone={connectedCount === 10 ? "success" : "neutral"}>
                {connectedCount === 10 ? "All 10 Models Connected" : `${connectedCount} Active`}
              </Badge>
            </div>
            <span className="text-xs text-muted-foreground">
              Validated <code>.joblib</code> model &amp; scaler artifacts loaded
            </span>
          </Card>

          <Card className="flex flex-col gap-1 border-border p-4">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Inference Pipeline
            </span>
            <span className="text-xs leading-relaxed text-muted-foreground">
              StandardScaler z-score normalization + calibrated Logistic Regression weights across
              all 10 clinical disease cohorts.
            </span>
          </Card>
        </div>

        {loading ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Spinner />
            <p className="mt-3 text-sm font-medium text-muted-foreground">Loading AI models…</p>
          </div>
        ) : error ? (
          <Card className="p-6 text-center">
            <p className="text-sm font-semibold text-rose-500">{error}</p>
            <button onClick={fetchStatus} className="btn-primary mt-4 text-xs">
              Retry Check
            </button>
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {models.map((m) => {
              const isConnected =
                m.loaded || m.available || m.status === "Loaded" || m.status === "Connected";

              return (
                <Card
                  key={m.id}
                  className={`flex flex-col justify-between border transition-all ${
                    isConnected
                      ? "border-emerald-500/40 bg-emerald-500/5 shadow-xs"
                      : "border-border bg-card/60"
                  }`}
                >
                  <div className="space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="text-base font-bold">{m.name}</h3>
                          <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                            {m.code}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">{m.description}</p>
                      </div>

                      <div className="shrink-0">
                        {isConnected ? (
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-bold text-emerald-600 dark:text-emerald-400">
                            <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                            Connected
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/15 px-2.5 py-1 text-xs font-bold text-amber-600 dark:text-amber-400">
                            <span className="h-2 w-2 rounded-full bg-amber-500" />
                            Not Connected
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2 rounded-xl bg-background/80 p-3 text-xs sm:grid-cols-4">
                      <div>
                        <span className="block text-[10px] uppercase font-semibold text-muted-foreground">
                          Model File
                        </span>
                        <span className="font-mono text-xs font-medium text-foreground break-all">
                          {m.modelFileName}
                        </span>
                      </div>

                      <div>
                        <span className="block text-[10px] uppercase font-semibold text-muted-foreground">
                          Scaler
                        </span>
                        <span className="font-mono text-xs font-medium text-foreground">
                          {m.scalerConnected ? "Connected" : "Embedded"}
                        </span>
                      </div>

                      <div>
                        <span className="block text-[10px] uppercase font-semibold text-muted-foreground">
                          Validation Accuracy
                        </span>
                        <span className="font-mono text-xs font-bold text-emerald-700">
                          {m.metrics?.accuracy
                            ? `${(m.metrics.accuracy * 100).toFixed(1)}%`
                            : "Calibrated"}
                        </span>
                      </div>

                      <div>
                        <span className="block text-[10px] uppercase font-semibold text-muted-foreground">
                          F1 Score
                        </span>
                        <span className="font-mono text-xs font-bold text-foreground">
                          {m.metrics?.f1_score
                            ? `${(m.metrics.f1_score * 100).toFixed(1)}%`
                            : `v${m.version}`}
                        </span>
                      </div>
                    </div>

                    <div>
                      <span className="text-[11px] font-semibold text-muted-foreground">
                        Clinical Input Features ({m.features.length}):
                      </span>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {m.features.map((f) => (
                          <span
                            key={f.name}
                            className="rounded-md border border-border bg-muted/50 px-2 py-0.5 text-[10px] text-foreground"
                            title={`${f.label}${f.unit ? ` (${f.unit})` : ""}`}
                          >
                            {f.name}
                            {f.unit ? ` (${f.unit})` : ""}
                          </span>
                        ))}
                      </div>
                    </div>

                    <div className="border-t border-border pt-2 text-[11px] text-muted-foreground">
                      <strong className="text-foreground">Training Benchmark:</strong> {m.dataset}
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </AppShell>
  );
}
