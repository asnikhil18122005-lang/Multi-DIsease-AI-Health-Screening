import { createFileRoute } from "@tanstack/react-router";
import { UnifiedScreeningWorkspace } from "./screen";

export const Route = createFileRoute("/report")({
  head: () => ({
    meta: [
      { title: "Upload Medical Report & Analyze | Multi-Disease AI Health Screening" },
      {
        name: "description",
        content:
          "Upload patient medical reports to automatically extract clinical biomarkers, run applicable disease prediction models, and view results.",
      },
    ],
  }),
  component: MedicalReportPage,
});

export function MedicalReportPage() {
  return <UnifiedScreeningWorkspace defaultMode="upload" />;
}
