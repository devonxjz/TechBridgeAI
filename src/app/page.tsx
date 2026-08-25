"use client";

import { ResearchForm } from "./components/research-form";
import { ResearchProgress } from "./components/research-progress";
import { ProfileCard } from "./components/profile-card";
import { useResearch } from "./hooks/use-research";

export default function HomePage() {
  const { state, research, reset } = useResearch();
  const isLoading =
    state.status === "researching" || state.status === "building";

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="border-b border-card-border bg-card/50 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img
              src="/logo-icon.png"
              alt="PartnerIQ Logo"
              className="w-9 h-9 object-contain drop-shadow-[0_0_12px_rgba(59,130,246,0.5)]"
            />
            <div>
              <h1 className="text-lg font-bold tracking-tight">PartnerIQ</h1>
              <p className="text-xs text-muted -mt-0.5">
                Company Intelligence Agent
              </p>
            </div>
          </div>

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

            <ResearchForm onSubmit={research} isLoading={isLoading} />

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
            {/* Left panel: form + progress */}
            <div className="space-y-4">
              <ResearchForm onSubmit={research} isLoading={isLoading} />
              <ResearchProgress
                sourceStatuses={state.sourceStatuses}
                findings={state.findings}
                status={state.status}
              />

              {state.error && (
                <div className="glass-card p-4 border-l-3 border-l-error animate-fade-in">
                  <p className="text-sm text-error font-medium">Lỗi</p>
                  <p className="text-xs text-muted mt-1">{state.error}</p>
                </div>
              )}
            </div>

            {/* Right panel: profile */}
            <div>
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
