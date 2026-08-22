// ═══════════════════════════════════════════════════════
// PartnerIQ — Profile Exporter (Markdown & JSON)
// ═══════════════════════════════════════════════════════

import type { CompanyProfile, AnalysisReport, ProfileDiff } from "./types";

export function exportProfileToMarkdown(
  profile: CompanyProfile,
  report?: AnalysisReport | null,
  diff?: ProfileDiff | null
): string {
  const lines: string[] = [];

  // Header
  lines.push(`# Hồ sơ Doanh nghiệp: ${profile.officialName}`);
  lines.push(`> Ngày tạo: ${new Date(profile.createdAt).toLocaleDateString("vi-VN")} | Phiên bản: v${profile.version} | Độ tin cậy: ${Math.round(profile.overallConfidence * 100)}%`);
  lines.push("");

  if (profile.tradingNames.length > 0) {
    lines.push(`**Tên giao dịch / viết tắt:** ${profile.tradingNames.join(", ")}`);
  }
  if (profile.taxId) {
    lines.push(`**Mã số thuế:** \`${profile.taxId}\``);
  }
  if (profile.website) {
    lines.push(`**Website chính thức:** [${profile.website}](${profile.website})`);
  }
  if (profile.companySize) {
    lines.push(`**Quy mô nhân sự:** ${profile.companySize} nhân sự`);
  }
  if (profile.foundedYear) {
    lines.push(`**Năm thành lập:** ${profile.foundedYear}`);
  }
  if (profile.headquarters) {
    const hq = [profile.headquarters.street, profile.headquarters.city, profile.headquarters.province, profile.headquarters.country]
      .filter(Boolean)
      .join(", ");
    lines.push(`**Trụ sở chính:** ${hq}`);
  }
  lines.push("");

  // Industry & Description
  lines.push("## 1. Ngành nghề & Tổng quan");
  lines.push(`**Lĩnh vực hoạt động:** ${profile.industry.join(", ")}`);
  lines.push("");
  lines.push(profile.description);
  lines.push("");

  // Key People
  if (profile.keyPeople.length > 0) {
    lines.push("## 2. Ban lãnh đạo & Nhân sự chủ chốt");
    for (const person of profile.keyPeople) {
      lines.push(`- **${person.name}**: ${person.title}`);
    }
    lines.push("");
  }

  // Products & Markets
  if (profile.products.length > 0 || profile.markets.length > 0) {
    lines.push("## 3. Sản phẩm, Dịch vụ & Thị trường");
    if (profile.products.length > 0) {
      lines.push(`**Sản phẩm/Dịch vụ:** ${profile.products.join(", ")}`);
    }
    if (profile.markets.length > 0) {
      lines.push(`**Thị trường hoạt động:** ${profile.markets.join(", ")}`);
    }
    lines.push("");
  }

  // Recent Activities
  if (profile.recentActivities.length > 0) {
    lines.push("## 4. Hoạt động & Sự kiện gần đây");
    for (const act of profile.recentActivities) {
      const dateStr = act.date ? new Date(act.date).toLocaleDateString("vi-VN") : "";
      lines.push(`- **${act.title}** ${dateStr ? `_(${dateStr})_` : ""}: ${act.summary}`);
    }
    lines.push("");
  }

  // Fit Score & Analysis Report
  if (report) {
    lines.push("## 5. Đánh giá Tiềm năng Hợp tác (PartnerIQ Analyst)");
    if (report.fitScore) {
      lines.push(`### Điểm Phù hợp: **${report.fitScore.score}/100**`);
      lines.push(`_${report.fitScore.reasoning}_`);
      lines.push("");
      lines.push("| Tiêu chí | Trọng số | Điểm | Đánh giá |");
      lines.push("| :--- | :---: | :---: | :--- |");
      for (const c of report.fitScore.criteria) {
        lines.push(`| ${c.name} | ${Math.round(c.weight * 100)}% | **${c.score}** | ${c.reasoning} |`);
      }
      lines.push("");
    }

    if (report.executiveSummary) {
      lines.push(`### Nhận định Chuyên gia`);
      lines.push(report.executiveSummary);
      lines.push("");
    }

    if (report.riskFlags.length > 0) {
      lines.push(`### Cảnh báo Rủi ro (Risk Flags)`);
      for (const rf of report.riskFlags) {
        lines.push(`- ⚠️ **[${rf.severity.toUpperCase()}]** (${rf.type}): ${rf.description}`);
      }
      lines.push("");
    }

    if (report.suggestedActions.length > 0) {
      lines.push(`### Đề xuất Hành động Tiếp cận`);
      for (const sa of report.suggestedActions) {
        lines.push(`- **[${sa.priority.toUpperCase()}]** ${sa.action} — _${sa.reasoning}_`);
      }
      lines.push("");
    }
  }

  // Diff section if exists
  if (diff && diff.changes.length > 0) {
    lines.push("## 6. Lịch sử Thay đổi So với Phiên bản Trước");
    lines.push(`So sánh giữa Version ${diff.fromVersion} và Version ${diff.toVersion}:`);
    for (const c of diff.changes) {
      lines.push(`- **${c.changeType.toUpperCase()}** \`${c.field}\`: Mức độ quan trọng: ${c.significance}`);
    }
    lines.push("");
    lines.push(diff.summary);
    lines.push("");
  }

  // Sources
  lines.push("## 7. Nguồn Dữ liệu & Tra cứu");
  for (const src of profile.sources) {
    lines.push(`- [${src.source}] ${src.url}`);
  }
  lines.push("");
  lines.push("---");
  lines.push("*Tài liệu được trích xuất tự động bởi hệ thống PartnerIQ Agent.*");

  return lines.join("\n");
}

export function exportProfileToJSON(
  profile: CompanyProfile,
  report?: AnalysisReport | null,
  diff?: ProfileDiff | null
): string {
  return JSON.stringify(
    {
      profile,
      report: report ?? null,
      diff: diff ?? null,
      exportedAt: new Date().toISOString(),
    },
    null,
    2
  );
}
