// ═══════════════════════════════════════════════════════
// PartnerIQ — Company One-Pager PDF Document Component
// Clean A4 Portrait single-page layout for enterprise export
// ═══════════════════════════════════════════════════════

import React from "react";
import {
  Document,
  Page,
  Text,
  View,
  Link,
  StyleSheet,
  Font,
} from "@react-pdf/renderer";
import type { PdfPayload, PdfCriterion } from "@/lib/export-pdf";

export interface CompanyOnePagerProps {
  payload: PdfPayload;
}

let fontsRegistered = false;

export function registerPdfFonts(baseUrl: string = "/fonts"): void {
  if (fontsRegistered) return;

  const cleanBase = baseUrl.replace(/\/+$/, "");

  Font.register({
    family: "NotoSans",
    fonts: [
      { src: `${cleanBase}/NotoSans-Regular.ttf`, fontWeight: "normal" },
      { src: `${cleanBase}/NotoSans-SemiBold.ttf`, fontWeight: 600 },
    ],
  });

  Font.registerHyphenationCallback((word) => [word]);
  fontsRegistered = true;
}

function getScoreColor(score: number): string {
  if (score >= 80) return "#16A34A";
  if (score >= 60) return "#D97706";
  return "#DC2626";
}

function FitScoreBars({ criteria }: { criteria: PdfCriterion[] }) {
  return (
    <View style={styles.barsContainer}>
      {criteria.map((c, idx) => {
        const barColor = getScoreColor(c.score);
        const weightPct = Math.round(c.weight * 100);
        return (
          <View key={idx} style={styles.barItem}>
            <View style={styles.barHeader}>
              <Text style={styles.barLabel}>
                {c.name}{" "}
                <Text style={styles.barWeight}>({weightPct}%)</Text>
              </Text>
              <Text style={styles.barScoreText}>{c.score}/100</Text>
            </View>
            <View style={styles.barTrack}>
              <View
                style={[
                  styles.barFill,
                  { width: `${Math.min(100, Math.max(0, c.score))}%`, backgroundColor: barColor },
                ]}
              />
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    padding: 30,
    fontFamily: "NotoSans",
    fontSize: 8.5,
    color: "#1E293B",
    backgroundColor: "#FFFFFF",
    lineHeight: 1.35,
  },
  topHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderBottomWidth: 1,
    borderBottomColor: "#E2E8F0",
    paddingBottom: 6,
    marginBottom: 12,
  },
  topBrand: {
    fontSize: 7.5,
    fontWeight: 600,
    color: "#64748B",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  topDate: {
    fontSize: 7.5,
    color: "#94A3B8",
  },
  heroRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 14,
  },
  heroLeft: {
    flex: 1,
    paddingRight: 16,
  },
  companyName: {
    fontSize: 18,
    fontWeight: 600,
    color: "#0F172A",
    lineHeight: 1.2,
    marginBottom: 4,
  },
  metaSubline: {
    fontSize: 8,
    color: "#64748B",
  },
  heroRight: {
    width: 130,
    backgroundColor: "#F8FAFC",
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    padding: 8,
    alignItems: "center",
  },
  scoreNumber: {
    fontSize: 24,
    fontWeight: 600,
    lineHeight: 1,
    marginBottom: 3,
  },
  scoreBadgeLabel: {
    fontSize: 7,
    fontWeight: 600,
    color: "#64748B",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  scoreReasoning: {
    fontSize: 7,
    color: "#475569",
    textAlign: "center",
    lineHeight: 1.25,
  },
  sectionTitle: {
    fontSize: 8.5,
    fontWeight: 600,
    color: "#334155",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 6,
    borderBottomWidth: 1,
    borderBottomColor: "#F1F5F9",
    paddingBottom: 3,
  },
  twoColSection: {
    flexDirection: "row",
    marginBottom: 14,
  },
  overviewCol: {
    flex: 1,
    paddingRight: 16,
  },
  overviewText: {
    fontSize: 8,
    color: "#334155",
    lineHeight: 1.4,
  },
  fitCol: {
    width: 230,
  },
  barsContainer: {
    marginTop: 2,
  },
  barItem: {
    marginBottom: 5,
  },
  barHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 2,
  },
  barLabel: {
    fontSize: 7.5,
    color: "#334155",
  },
  barWeight: {
    fontSize: 6.5,
    color: "#94A3B8",
  },
  barScoreText: {
    fontSize: 7.5,
    fontWeight: 600,
    color: "#1E293B",
  },
  barTrack: {
    height: 6,
    backgroundColor: "#E2E8F0",
    borderRadius: 3,
    overflow: "hidden",
  },
  barFill: {
    height: "100%",
    borderRadius: 3,
  },
  summaryBox: {
    backgroundColor: "#F8FAFC",
    borderLeftWidth: 3,
    borderLeftColor: "#2563EB",
    borderRadius: 4,
    padding: "8 10",
    marginBottom: 14,
  },
  summaryText: {
    fontSize: 8,
    color: "#1E293B",
    lineHeight: 1.4,
  },
  risksActionsRow: {
    flexDirection: "row",
    marginBottom: 14,
  },
  riskCol: {
    flex: 1,
    paddingRight: 12,
  },
  riskTitle: {
    fontSize: 8.5,
    fontWeight: 600,
    color: "#DC2626",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 6,
    borderBottomWidth: 1,
    borderBottomColor: "#FEE2E2",
    paddingBottom: 3,
  },
  actionCol: {
    flex: 1,
    paddingLeft: 4,
  },
  actionTitle: {
    fontSize: 8.5,
    fontWeight: 600,
    color: "#2563EB",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 6,
    borderBottomWidth: 1,
    borderBottomColor: "#DBEAFE",
    paddingBottom: 3,
  },
  listItem: {
    flexDirection: "row",
    marginBottom: 4,
    alignItems: "flex-start",
  },
  bullet: {
    width: 8,
    fontSize: 8,
    color: "#64748B",
  },
  listText: {
    flex: 1,
    fontSize: 7.5,
    color: "#334155",
    lineHeight: 1.3,
  },
  emptyNote: {
    fontSize: 7.5,
    color: "#94A3B8",
    fontStyle: "italic",
  },
  footer: {
    marginTop: "auto",
    borderTopWidth: 1,
    borderTopColor: "#E2E8F0",
    paddingTop: 8,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  footerSources: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
    flexWrap: "wrap",
  },
  footerLabel: {
    fontSize: 7,
    color: "#64748B",
  },
  sourceLink: {
    fontSize: 7,
    color: "#2563EB",
    textDecoration: "none",
  },
  footerSep: {
    fontSize: 7,
    color: "#CBD5E1",
    marginHorizontal: 3,
  },
  footerBrand: {
    fontSize: 7,
    color: "#94A3B8",
  },
});

export function CompanyOnePager({ payload }: CompanyOnePagerProps): React.ReactElement {
  const overallScoreColor = getScoreColor(payload.fitScore);

  const metaParts: string[] = [];
  if (payload.taxId) {
    metaParts.push(`MST: ${payload.taxId}`);
  }
  if (payload.industries && payload.industries.length > 0) {
    metaParts.push(payload.industries.join(" · "));
  }

  return (
    <Document title={payload.companyName} author="PartnerIQ" subject="Hồ sơ doanh nghiệp">
      <Page size="A4" orientation="portrait" style={styles.page}>
        {/* Top Header */}
        <View style={styles.topHeader} wrap={false}>
          <Text style={styles.topBrand}>PartnerIQ · Hồ sơ doanh nghiệp</Text>
          <Text style={styles.topDate}>{payload.generatedAt}</Text>
        </View>

        {/* Hero Section */}
        <View style={styles.heroRow} wrap={false}>
          <View style={styles.heroLeft}>
            <Text style={styles.companyName}>{payload.companyName}</Text>
            {metaParts.length > 0 && (
              <Text style={styles.metaSubline}>{metaParts.join(" · ")}</Text>
            )}
          </View>
          <View style={styles.heroRight}>
            <Text style={styles.scoreBadgeLabel}>Điểm phù hợp</Text>
            <Text style={[styles.scoreNumber, { color: overallScoreColor }]}>
              {payload.fitScore}/100
            </Text>
            {Boolean(payload.fitReason) && (
              <Text style={styles.scoreReasoning}>{payload.fitReason}</Text>
            )}
          </View>
        </View>

        {/* Section 1: Overview + Fit Score Breakdown */}
        <View style={styles.twoColSection} wrap={false}>
          <View style={styles.overviewCol}>
            <Text style={styles.sectionTitle}>Tổng quan</Text>
            <Text style={styles.overviewText}>
              {payload.description || "Chưa có thông tin mô tả chi tiết."}
            </Text>
          </View>
          <View style={styles.fitCol}>
            <Text style={styles.sectionTitle}>Tiêu chí đánh giá</Text>
            <FitScoreBars criteria={payload.criteria} />
          </View>
        </View>

        {/* Section 2: Executive Summary (Nhận định) */}
        <View style={styles.summaryBox} wrap={false}>
          <Text style={[styles.sectionTitle, { borderBottomWidth: 0, marginBottom: 3 }]}>
            Nhận định
          </Text>
          <Text style={styles.summaryText}>{payload.executiveSummary}</Text>
        </View>

        {/* Section 3: Risks & Actions */}
        <View style={styles.risksActionsRow} wrap={false}>
          <View style={styles.riskCol}>
            <Text style={styles.riskTitle}>Rủi ro tiềm ẩn</Text>
            {payload.risks && payload.risks.length > 0 ? (
              payload.risks.map((r, idx) => (
                <View key={idx} style={styles.listItem}>
                  <Text style={styles.bullet}>•</Text>
                  <Text style={styles.listText}>{r}</Text>
                </View>
              ))
            ) : (
              <Text style={styles.emptyNote}>Chưa ghi nhận rủi ro nổi bật.</Text>
            )}
          </View>
          <View style={styles.actionCol}>
            <Text style={styles.actionTitle}>Hành động đề xuất</Text>
            {payload.actions && payload.actions.length > 0 ? (
              payload.actions.map((a, idx) => (
                <View key={idx} style={styles.listItem}>
                  <Text style={styles.bullet}>•</Text>
                  <Text style={styles.listText}>{a}</Text>
                </View>
              ))
            ) : (
              <Text style={styles.emptyNote}>Chưa có hành động được đề xuất.</Text>
            )}
          </View>
        </View>

        {/* Footer */}
        <View style={styles.footer} wrap={false}>
          <View style={styles.footerSources}>
            <Text style={styles.footerLabel}>Nguồn: </Text>
            {payload.sources && payload.sources.length > 0 ? (
              payload.sources.map((s, idx) => (
                <React.Fragment key={idx}>
                  {idx > 0 && <Text style={styles.footerSep}>·</Text>}
                  <Link src={s.url} style={styles.sourceLink}>
                    {s.label}
                  </Link>
                </React.Fragment>
              ))
            ) : (
              <Text style={styles.footerLabel}>Tổng hợp dữ liệu công khai</Text>
            )}
          </View>
          <Text style={styles.footerBrand}>Báo cáo tự động bởi PartnerIQ</Text>
        </View>
      </Page>
    </Document>
  );
}
