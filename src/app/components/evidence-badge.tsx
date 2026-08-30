"use client";

import type { ClaimEvidence } from "@/lib/types";

interface EvidenceBadgeProps {
  evidence?: ClaimEvidence | null;
  onClick?: () => void;
  className?: string;
}

const getStatusBadge = (status: ClaimEvidence["status"]) => {
  switch (status) {
    case "primary_source":
      return {
        label: "Nguồn chính thức",
        icon: "🛡️",
        style: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30 hover:bg-emerald-500/25",
      };
    case "corroborated":
      return {
        label: `Kiểm chứng chéo`, // We'll handle the count in the component
        icon: "✓✓",
        style: "bg-blue-500/15 text-blue-300 border-blue-500/30 hover:bg-blue-500/25",
      };
    case "single_source":
      return {
        label: "Nguồn đơn",
        icon: "ℹ️",
        style: "bg-amber-500/15 text-amber-300 border-amber-500/30 hover:bg-amber-500/25",
      };
    case "conflicting":
      return {
        label: "Có mâu thuẫn",
        icon: "⚠️",
        style: "bg-rose-500/15 text-rose-300 border-rose-500/30 hover:bg-rose-500/25",
      };
    case "insufficient":
    default:
      return {
        label: "Chưa đủ nguồn",
        icon: "⚪",
        style: "bg-slate-500/15 text-slate-300 border-slate-500/30 hover:bg-slate-500/25",
      };
  }
};

export function EvidenceBadge({
  evidence,
  onClick,
  className = "",
}: EvidenceBadgeProps) {
  if (!evidence) return null;

  const badgeBase = getStatusBadge(evidence.status);
  const badge = {
    ...badgeBase,
    label: evidence.status === "corroborated" ? `Kiểm chứng chéo (${evidence.independentPublisherCount} nguồn)` : badgeBase.label,
  };

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={`inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-semibold rounded-md border transition-all cursor-pointer ${badge.style} ${className}`}
        title={`Xem chứng cứ: ${badge.label}`}
      >
        <span className="text-[10px]">{badge.icon}</span>
        <span>{badge.label}</span>
      </button>
    );
  }

  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-semibold rounded-md border ${badge.style} ${className}`}
    >
      <span className="text-[10px]">{badge.icon}</span>
      <span>{badge.label}</span>
    </span>
  );
}
