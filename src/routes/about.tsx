import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { Badge, Card } from "@/components/ui";
import { ALL_DISEASE_METADATA } from "@/lib/disease-metadata";

export const Route = createFileRoute("/about")({
  head: () => ({
    meta: [
      { title: "About | Multi-Disease AI Health Screening" },
      {
        name: "description",
        content:
          "Clinical architecture, dataset origins, feature pipelines, and medical methodology across 10 disease models.",
      },
    ],
  }),
  component: AboutPage,
});

function AboutPage() {
  return (
    <AppShell>
      <div className="max-w-4xl">
        <Badge tone="primary">System Architecture &amp; Methodology</Badge>
        <h1 className="mt-3 text-3xl font-extrabold md:text-4xl">
          About Multi-Disease AI Health Screening
        </h1>
        <p className="mt-4 text-base text-muted-foreground md:text-lg">
          An intelligent clinical triage and risk analysis framework integrating machine-learning
          pipelines across 10 vital health conditions.
        </p>

        <section className="mt-10 space-y-8">
          <Card>
            <h2 className="text-xl font-bold">10 Disease Prediction Modules</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Each prediction service implements strict input validation, feature order
              preservation, categorical encoding, and standard scaling matching published medical
              benchmarks:
            </p>

            <div className="mt-6 space-y-4">
              {ALL_DISEASE_METADATA.map((meta, idx) => (
                <div
                  key={meta.id}
                  className="rounded-xl border border-border bg-card p-4 transition-all"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-base font-bold">
                      {idx + 1}. {meta.name}
                    </h3>
                    <span className="font-mono text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded">
                      {meta.code}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{meta.description}</p>
                  <div className="mt-3 border-t border-border pt-2 text-xs">
                    <span className="font-semibold text-foreground">Dataset Source: </span>
                    <span className="text-muted-foreground">{meta.datasetName}</span>
                  </div>
                  <div className="mt-2 text-xs">
                    <span className="font-semibold text-foreground">
                      Expected Features ({meta.features.length}):{" "}
                    </span>
                    <span className="text-muted-foreground">
                      {meta.features.map((f) => f.name).join(", ")}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <h2 className="text-xl font-bold">Educational &amp; Clinical Intent</h2>
            <div className="mt-3 space-y-3 text-sm text-muted-foreground leading-relaxed">
              <p>
                This platform is engineered for{" "}
                <strong>educational, research, and preventive screening support</strong>. It does{" "}
                <strong>NOT</strong> render medical diagnoses or formulate prescriptive treatment
                courses.
              </p>
              <p>
                Prediction outputs reflect mathematical model classifications based strictly on
                submitted biometric features (resting vitals, laboratory panels, reported symptoms,
                and demographic data).
              </p>
              <p>
                Patients presenting with symptoms or flagged as higher-risk should immediately
                consult a licensed physician or healthcare professional for diagnostic confirmatory
                testing.
              </p>
            </div>
          </Card>

          <Card>
            <h2 className="text-xl font-bold">Getting Started</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Evaluate the intake workflow using sample synthetic patient records or clinical
              document uploads.
            </p>
            <div className="mt-4 flex flex-wrap gap-3">
              <Link to="/screen" className="btn-primary text-xs">
                New Screening
              </Link>
              <Link to="/history" className="btn-ghost text-xs">
                View History
              </Link>
              <Link to="/" className="btn-ghost text-xs">
                Back to Overview
              </Link>
            </div>
          </Card>
        </section>
      </div>
    </AppShell>
  );
}
