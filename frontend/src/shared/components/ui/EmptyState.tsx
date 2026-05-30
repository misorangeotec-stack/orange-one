import { Link } from "react-router-dom";
import type { ReactNode } from "react";

/** Friendly empty-state block for lists with no data yet. */
export default function EmptyState({
  title,
  message,
  icon,
  actionLabel,
  actionTo,
  onAction,
}: {
  title: string;
  message?: string;
  icon?: ReactNode;
  actionLabel?: string;
  actionTo?: string;
  onAction?: () => void;
}) {
  return (
    <div className="flex flex-col items-center text-center px-6 py-14">
      <div className="w-12 h-12 rounded-card bg-orange-soft text-orange flex items-center justify-center mb-4 [&>svg]:w-6 [&>svg]:h-6">
        {icon ?? (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <rect x="4" y="4" width="16" height="16" rx="3" />
            <path d="M9 12h6M12 9v6" />
          </svg>
        )}
      </div>
      <h3 className="text-[15px] font-semibold text-navy">{title}</h3>
      {message && <p className="text-[13px] text-grey-2 mt-1 max-w-xs">{message}</p>}
      {actionLabel &&
        (actionTo ? (
          <Link
            to={actionTo}
            className="mt-4 inline-flex items-center gap-2 bg-orange-grad text-white font-semibold text-[13px] px-4 py-2.5 rounded-xl shadow-cta hover:-translate-y-0.5 transition"
          >
            {actionLabel}
          </Link>
        ) : (
          <button
            onClick={onAction}
            className="mt-4 inline-flex items-center gap-2 bg-orange-grad text-white font-semibold text-[13px] px-4 py-2.5 rounded-xl shadow-cta hover:-translate-y-0.5 transition"
          >
            {actionLabel}
          </button>
        ))}
    </div>
  );
}
