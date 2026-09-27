import type { ReactNode, InputHTMLAttributes, SelectHTMLAttributes } from "react";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`card-surface p-5 md:p-6 ${className}`}>{children}</div>;
}

export function SectionTitle({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="mb-4">
      <h2 className="text-lg font-semibold">{title}</h2>
      {hint ? <p className="mt-1 text-sm text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export function Field({
  label,
  unit,
  error,
  children,
}: {
  label: string;
  unit?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-baseline justify-between text-sm font-medium text-foreground">
        {label}
        {unit ? <span className="text-xs font-normal text-muted-foreground">{unit}</span> : null}
      </span>
      {children}
      {error ? <span className="mt-1 block text-xs text-destructive">{error}</span> : null}
    </label>
  );
}

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`field-input ${props.className ?? ""}`} />;
}

export function SelectInput(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`field-input ${props.className ?? ""}`} />;
}

export function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between rounded-lg border border-border bg-card px-3.5 py-2.5 text-sm font-medium transition-colors hover:bg-muted"
    >
      <span>{label}</span>
      <span
        className="relative h-5 w-9 rounded-full transition-colors"
        style={{ backgroundColor: checked ? "var(--color-primary)" : "var(--color-input)" }}
      >
        <span
          className="absolute top-0.5 h-4 w-4 rounded-full bg-card transition-all"
          style={{ left: checked ? "1.25rem" : "0.125rem" }}
        />
      </span>
    </button>
  );
}

export function Badge({
  children,
  tone = "muted",
}: {
  children: ReactNode;
  tone?: "muted" | "primary";
}) {
  return (
    <span
      className="inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold"
      style={
        tone === "primary"
          ? {
              backgroundColor: "var(--color-secondary)",
              color: "var(--color-secondary-foreground)",
            }
          : { backgroundColor: "var(--color-muted)", color: "var(--color-muted-foreground)" }
      }
    >
      {children}
    </span>
  );
}

export function Alert({
  kind = "error",
  children,
}: {
  kind?: "error" | "info";
  children: ReactNode;
}) {
  const color = kind === "error" ? "var(--color-destructive)" : "var(--color-primary)";
  return (
    <div
      className="rounded-xl border px-4 py-3 text-sm"
      style={{ borderColor: color, color, backgroundColor: "var(--color-card)" }}
    >
      {children}
    </div>
  );
}

export function Spinner({ className = "" }: { className?: string }) {
  return (
    <div
      className={`h-8 w-8 animate-spin rounded-full border-4 ${className}`}
      style={{ borderColor: "var(--color-muted)", borderTopColor: "var(--color-primary)" }}
      role="status"
      aria-label="Loading"
    />
  );
}
