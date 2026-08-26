"use client";

import type { CacheSuggestion } from "@/lib/types";

export interface CacheSuggestionsProps {
  suggestions: CacheSuggestion[];
  onSelect: (companyId: string) => void;
  onBypass: () => void;
}

export function CacheSuggestions({
  suggestions,
  onSelect,
  onBypass,
}: CacheSuggestionsProps) {
  if (!suggestions || suggestions.length === 0) return null;

  return (
    <div
      className="glass-card p-6 space-y-4 animate-fade-in"
      data-testid="cache-suggestions"
    >
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold text-foreground flex items-center gap-2">
            <span>⚡</span> Tìm thấy kết quả trong bộ nhớ đệm
          </h3>
          <p className="text-xs text-muted mt-1">
            Chọn một hồ sơ có sẵn để tải ngay dữ liệu hoặc tiếp tục nghiên cứu mới
            toàn diện.
          </p>
        </div>
      </div>

      <div className="divide-y divide-border/50 rounded-lg border border-border/50 bg-background/50 overflow-hidden">
        {suggestions.map((suggestion) => (
          <button
            key={suggestion.companyId}
            type="button"
            onClick={() => onSelect(suggestion.companyId)}
            className="w-full text-left p-4 hover:bg-surface-hover/80 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-3 focus:outline-none focus:bg-surface-hover"
            data-testid={`suggestion-item-${suggestion.companyId}`}
          >
            <div className="space-y-1">
              <div className="font-medium text-foreground flex items-center gap-2">
                <span>{suggestion.officialName}</span>
                {suggestion.taxId && (
                  <span className="text-xs bg-surface text-muted px-2 py-0.5 rounded border border-border/50 font-mono">
                    MST: {suggestion.taxId}
                  </span>
                )}
              </div>
              {suggestion.domain && (
                <div className="text-xs text-muted flex items-center gap-1">
                  <span>🌐</span> {suggestion.domain}
                </div>
              )}
            </div>

            <div className="flex items-center justify-between sm:justify-end gap-3 text-xs text-muted">
              <span>
                Đồng bộ:{" "}
                {new Date(suggestion.lastSyncedAt).toLocaleDateString("vi-VN")}
              </span>
              <span className="text-primary font-medium flex items-center gap-1">
                Sử dụng <span>→</span>
              </span>
            </div>
          </button>
        ))}
      </div>

      <div className="pt-2 flex justify-end">
        <button
          type="button"
          onClick={onBypass}
          className="btn-secondary text-xs px-4 py-2 flex items-center gap-2"
          data-testid="bypass-button"
        >
          <span>🔍</span> Nghiên cứu mới (Bỏ qua cache)
        </button>
      </div>
    </div>
  );
}
