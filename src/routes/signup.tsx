import { createFileRoute } from "@tanstack/react-router";
import { LoginPage } from "./login";

export const Route = createFileRoute("/signup")({
  head: () => ({
    meta: [
      { title: "Sign In | Multi-Disease AI Health Screening" },
      {
        name: "description",
        content: "Sign in to access your patient screenings, reports, and clinical records.",
      },
    ],
  }),
  component: LoginPage,
});
