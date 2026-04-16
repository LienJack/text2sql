import { cn } from "@/lib/utils";

export interface StepItem {
  step: number;
  title: string;
  subtitle?: string;
}

interface StepsProps {
  items: StepItem[];
  currentStep: number;
  className?: string;
}

export function Steps({ items, currentStep, className }: StepsProps) {
  return (
    <ol className={cn("grid grid-cols-1 gap-2 text-sm sm:grid-cols-3", className)}>
      {items.map((item) => {
        const complete = currentStep > item.step;
        const current = currentStep === item.step;
        return (
          <li
            key={item.step}
            aria-current={current ? "step" : undefined}
            className={cn(
              "rounded-xl border px-3 py-2.5 transition-all",
              complete
                ? "border-[var(--border-brand)] bg-[var(--surface-active)]/60"
                : current
                  ? "border-[var(--border-brand)] bg-[var(--surface-active)] ring-1 ring-[var(--border-brand)]/50"
                  : "border-[var(--border-default)] bg-[var(--surface-panel)]"
            )}
          >
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  "inline-flex h-6 w-6 items-center justify-center rounded-full border text-xs font-semibold transition-colors",
                  complete || current
                    ? "border-[var(--action-primary)] bg-[var(--action-primary)] text-[var(--action-primary-text)]"
                    : "border-[var(--border-default)] text-[var(--text-tertiary)]"
                )}
              >
                {item.step}
              </span>
              <span
                className={cn(
                  "font-medium",
                  complete || current ? "text-[var(--text-primary)]" : "text-[var(--text-tertiary)]"
                )}
              >
                {item.title}
              </span>
            </div>
            {item.subtitle ? <p className="mt-1 pl-8 text-xs text-[var(--text-tertiary)]">{item.subtitle}</p> : null}
          </li>
        );
      })}
    </ol>
  );
}
