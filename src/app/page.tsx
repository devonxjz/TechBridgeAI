"use client";

import Image from "next/image";
import { ResearchForm } from "./components/research-form";
import { ResearchProgress } from "./components/research-progress";
import { ProfileCard } from "./components/profile-card";
import { CacheSuggestions } from "./components/cache-suggestions";
import { useResearch } from "./hooks/use-research";
import { getResearchRequestContext } from "./lib/research-request-context";
import { AuthControls } from "./components/auth-controls";

export default function HomePage() {
  const {
    state,
    research,
    selectSuggestion,
    refreshResearch,
    bypassAndResearch,
    reset,
  } = useResearch(getResearchRequestContext);

  const isLoading =
    state.status === "researching" || state.status === "building";

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="border-b border-card-border bg-card/50 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Image
              src="/logo-icon.png"
              alt="PartnerIQ Logo"
              width={36}
              height={36}
              className="object-contain drop-shadow-[0_0_12px_rgba(59,130,246,0.5)]"
            />
            <div>
              <h1 className="text-lg font-bold tracking-tight">PartnerIQ</h1>
              <p className="text-xs text-muted -mt-0.5">
                Company Intelligence Agent
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <AuthControls />
            {state.status !== "idle" && (
              <button
                onClick={reset}
                className="text-xs text-muted hover:text-foreground transition-colors
                           px-3 py-1.5 rounded-lg hover:bg-surface"
              >
                ← Nghiên cứu mới
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="flex-1 max-w-5xl mx-auto w-full px-4 py-8">
        {state.status === "idle" ? (
          /* ─── Landing state ─── */
          <div className="max-w-xl mx-auto space-y-8">
            <div className="text-center space-y-3 pt-8">
              <h2 className="text-4xl font-extrabold tracking-tight">
                Nghiên cứu doanh nghiệp
                <br />
                <span className="gradient-text">thông minh</span>
              </h2>
              <p className="text-muted text-sm max-w-md mx-auto leading-relaxed">
                Nhập tên công ty — AI sẽ tự động tìm kiếm, phân tích và tạo hồ
                sơ doanh nghiệp từ nhiều nguồn dữ liệu.
              </p>
            </div>

            <ResearchForm
              onSubmit={(input) => research(input)}
              isLoading={isLoading}
              initialInput={state.input}
            />

            {/* Feature highlights */}
            <div className="grid grid-cols-3 gap-3 pt-4">
              <FeatureCard
                icon="🔍"
                title="Đa nguồn"
                desc="Website, tin tức, đăng ký kinh doanh, LinkedIn"
              />
              <FeatureCard
                icon="📊"
                title="Hồ sơ chuẩn"
                desc="Ngành nghề, sản phẩm, nhân sự, quy mô"
              />
              <FeatureCard
                icon="🔄"
                title="So sánh"
                desc="Theo dõi thay đổi theo thời gian"
              />
            </div>
          </div>
        ) : (
          /* ─── Research / Results state ─── */
          <div className="grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-6">
            {/* Left panel: form + progress + suggestions */}
            <div className="space-y-4">
              <ResearchForm
                onSubmit={(input) => research(input)}
                isLoading={isLoading}
                initialInput={state.input}
              />

              {state.status === "suggesting" ? (
                <CacheSuggestions
                  suggestions={state.suggestions}
                  onSelect={selectSuggestion}
                  onBypass={bypassAndResearch}
                />
              ) : (
                <ResearchProgress
                  sourceStatuses={state.sourceStatuses}
                  findings={state.findings}
                  status={state.status}
                />
              )}

              {state.notice && (
                <div
                  role="status"
                  aria-live="polite"
                  className="glass-card p-4 border-l-3 border-l-amber-500 bg-amber-500/10 text-amber-200 animate-fade-in"
                >
                  <div className="flex items-center gap-2">
                    <span>⚠️</span>
                    <p className="text-xs font-medium">{state.notice}</p>
                  </div>
                </div>
              )}

              {state.error && (
                <div className="glass-card p-4 border-l-3 border-l-error animate-fade-in">
                  <p className="text-sm text-error font-medium">Lỗi</p>
                  <p className="text-xs text-muted mt-1">{state.error}</p>
                </div>
              )}
            </div>

            {/* Right panel: profile */}
            <div className="min-w-0 space-y-4">
              {state.profile && (
                <div className="flex items-center justify-between gap-3 bg-surface/50 border border-border/50 rounded-xl p-3">
                  <div className="flex items-center gap-2 text-xs">
                    {state.cacheHit ? (
                      <span className="badge badge-accent flex items-center gap-1">
                        <span>⚡</span> Đã tải từ bộ nhớ đệm (v{state.cacheHit.version})
                      </span>
                    ) : (
                      <span className="badge badge-success flex items-center gap-1">
                        <span>✓</span> Nghiên cứu trực tiếp mới nhất
                      </span>
                    )}
                    {state.cacheHit && (
                      <span className="text-muted hidden sm:inline">
                        Đồng bộ: {new Date(state.cacheHit.lastSyncedAt).toLocaleString("vi-VN")}
                      </span>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={refreshResearch}
                    disabled={isLoading}
                    className="btn-secondary text-xs px-3 py-1.5 flex items-center gap-1.5 disabled:opacity-50"
                  >
                    <span>🔄</span> Làm mới dữ liệu
                  </button>
                </div>
              )}

              {state.profile ? (
                <ProfileCard
                  profile={state.profile}
                  diff={state.diff}
                  report={state.report}
                />
              ) : state.status === "building" ? (
                <div className="glass-card p-12 flex flex-col items-center justify-center gap-4 animate-pulse-glow">
                  <div className="w-12 h-12 border-3 border-accent border-t-transparent rounded-full animate-spin-slow" />
                  <p className="text-sm text-muted">
                    Đang tổng hợp hồ sơ bằng AI...
                  </p>
                </div>
              ) : state.status === "researching" ? (
                <div className="glass-card p-12 flex flex-col items-center justify-center gap-4">
                  <div className="text-4xl">🔍</div>
                  <p className="text-sm text-muted text-center">
                    Đang thu thập dữ liệu từ nhiều nguồn.
                    <br />
                    Hồ sơ sẽ xuất hiện ở đây khi hoàn tất.
                  </p>
                </div>
              ) : null}
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-card-border py-4 mt-auto">
        <p className="text-center text-xs text-muted">
          PartnerIQ — Google AI Hackathon 2026 • Powered by Gemini & OpenAI
        </p>
      </footer>
    </div>
  );
}

function FeatureCard({
  icon,
  title,
  desc,
}: {
  icon: string;
  title: string;
  desc: string;
}) {
  return (
    <div className="glass-card p-4 text-center space-y-1.5 hover:border-accent/30 transition-colors">
      <div className="text-2xl">{icon}</div>
      <p className="text-sm font-semibold">{title}</p>
      <p className="text-xs text-muted leading-relaxed">{desc}</p>
    </div>
  );
}
