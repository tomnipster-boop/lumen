export type ToastTone = "success" | "error" | "info";

export interface ToastMessage {
  id: number;
  title: string;
  message?: string;
  tone: ToastTone;
}

interface ToastProps {
  toast?: ToastMessage;
}

export function Toast({ toast }: ToastProps) {
  return (
    <div
      className={`toast ${toast ? "toast--visible" : ""} ${
        toast ? `toast--${toast.tone}` : ""
      }`}
      aria-live="polite"
      role={toast?.tone === "error" ? "alert" : "status"}
    >
      <span className="toast__icon" aria-hidden="true">
        {toast?.tone === "error" ? "!" : toast?.tone === "info" ? "↗" : "✓"}
      </span>
      <div>
        <strong>{toast?.title}</strong>
        {toast?.message && <span>{toast.message}</span>}
      </div>
    </div>
  );
}
