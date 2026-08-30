import { describe, expect, it } from "vitest";
import { createAnalystModule } from "@/modules/analyst";
import { MockLLMAdapter } from "../helpers/mock-adapters";
import type { CompanyProfile } from "@/lib/types";

const profile: CompanyProfile = {
  id: "company-1",
  version: 1,
  createdAt: new Date(),
  lastUpdated: new Date(),
  input: { name: "Company" },
  officialName: "Company",
  tradingNames: [],
  industry: [],
  description: "Company",
  keyPeople: [],
  products: [],
  markets: [],
  recentActivities: [],
  sources: [],
  overallConfidence: 0.8,
};

const criterion = (name: string) => ({ name, score: 80, reasoning: "Evidence" });
const validCriteria = [
  criterion("Industry Alignment"),
  criterion("Company Size Match"),
  criterion("Geographic Relevance"),
  criterion("Digital Maturity"),
  criterion("Recent Activity"),
];

describe("analyst criteria contract", () => {
  it("rejects unknown criterion names", async () => {
    const llm = new MockLLMAdapter();
    llm.setResponse("Phân tích và đánh giá", JSON.stringify({
      executiveSummary: "Summary",
      criteria: [...validCriteria.slice(0, 4), criterion("Unknown")],
      riskFlags: [],
      suggestedActions: [],
    }));

    await expect(createAnalystModule({ llm }).analyze(profile)).rejects.toThrow();
  });

  it("rejects duplicate criteria", async () => {
    const llm = new MockLLMAdapter();
    llm.setResponse("Phân tích và đánh giá", JSON.stringify({
      executiveSummary: "Summary",
      criteria: [...validCriteria.slice(0, 4), criterion("Industry Alignment")],
      riskFlags: [],
      suggestedActions: [],
    }));

    await expect(createAnalystModule({ llm }).analyze(profile)).rejects.toThrow();
  });
});
