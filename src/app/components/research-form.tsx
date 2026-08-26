"use client";

import { useState } from "react";
import type { CompanyInput } from "@/lib/types";

interface ResearchFormProps {
  onSubmit: (input: CompanyInput) => void;
  isLoading: boolean;
  initialInput?: CompanyInput | null;
}

export function ResearchForm({ onSubmit, isLoading, initialInput }: ResearchFormProps) {
  const [name, setName] = useState(initialInput?.name ?? "");
  const [website, setWebsite] = useState(initialInput?.website ?? "");
  const [taxId, setTaxId] = useState(initialInput?.taxId ?? "");
  const [linkedinUrl, setLinkedinUrl] = useState(initialInput?.linkedinUrl ?? "");
  const [showAdvanced, setShowAdvanced] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    onSubmit({
      name: name.trim(),
      website: website.trim() || undefined,
      taxId: taxId.trim() || undefined,
      linkedinUrl: linkedinUrl.trim() || undefined,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="glass-card p-6 space-y-4">
      <div>
        <label
          htmlFor="company-name"
          className="block text-sm font-medium text-muted mb-1.5"
        >
          Tên công ty *
        </label>
        <input
          id="company-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="VD: FPT Corporation, VinGroup, ..."
          required
          disabled={isLoading}
          className="w-full px-4 py-3 bg-surface border border-card-border rounded-xl
                     text-foreground placeholder:text-muted/50
                     transition-all duration-200 hover:border-accent/30
                     disabled:opacity-50 disabled:cursor-not-allowed"
        />
      </div>

      <div>
        <label
          htmlFor="company-website"
          className="block text-sm font-medium text-muted mb-1.5"
        >
          Website (tùy chọn)
        </label>
        <input
          id="company-website"
          type="url"
          value={website}
          onChange={(e) => setWebsite(e.target.value)}
          placeholder="https://fpt.com.vn"
          disabled={isLoading}
          className="w-full px-4 py-3 bg-surface border border-card-border rounded-xl
                     text-foreground placeholder:text-muted/50
                     transition-all duration-200 hover:border-accent/30
                     disabled:opacity-50 disabled:cursor-not-allowed"
        />
      </div>

      {/* Advanced fields toggle */}
      <button
        type="button"
        onClick={() => setShowAdvanced(!showAdvanced)}
        className="text-sm text-accent-light hover:text-accent transition-colors flex items-center gap-1"
      >
        <svg
          className={`w-3.5 h-3.5 transition-transform ${showAdvanced ? "rotate-90" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
        Thông tin bổ sung
      </button>

      {showAdvanced && (
        <div className="space-y-3 animate-fade-in">
          <div>
            <label htmlFor="tax-id" className="block text-sm font-medium text-muted mb-1.5">
              Mã số thuế
            </label>
            <input
              id="tax-id"
              type="text"
              value={taxId}
              onChange={(e) => setTaxId(e.target.value)}
              placeholder="0101234567"
              disabled={isLoading}
              className="w-full px-4 py-3 bg-surface border border-card-border rounded-xl
                         text-foreground placeholder:text-muted/50
                         transition-all duration-200 hover:border-accent/30
                         disabled:opacity-50"
            />
          </div>
          <div>
            <label htmlFor="linkedin-url" className="block text-sm font-medium text-muted mb-1.5">
              LinkedIn Company URL
            </label>
            <input
              id="linkedin-url"
              type="url"
              value={linkedinUrl}
              onChange={(e) => setLinkedinUrl(e.target.value)}
              placeholder="https://linkedin.com/company/fpt-corporation"
              disabled={isLoading}
              className="w-full px-4 py-3 bg-surface border border-card-border rounded-xl
                         text-foreground placeholder:text-muted/50
                         transition-all duration-200 hover:border-accent/30
                         disabled:opacity-50"
            />
          </div>
        </div>
      )}

      <button
        type="submit"
        disabled={isLoading || !name.trim()}
        className="w-full py-3.5 px-6 bg-accent hover:bg-accent-light
                   text-white font-semibold rounded-xl
                   transition-all duration-200
                   disabled:opacity-40 disabled:cursor-not-allowed
                   hover:shadow-lg hover:shadow-accent/20
                   active:scale-[0.98]"
      >
        {isLoading ? (
          <span className="flex items-center justify-center gap-2">
            <svg className="animate-spin-slow w-5 h-5" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            Đang nghiên cứu...
          </span>
        ) : (
          "🔍 Bắt đầu nghiên cứu"
        )}
      </button>
    </form>
  );
}
