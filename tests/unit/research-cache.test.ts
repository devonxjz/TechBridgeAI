import { describe, it, expect } from "vitest";
import {
  normalizeCompanyIdentity,
  decideCacheLookup,
  type IdentityCandidate,
  type NormalizedCompanyIdentity,
} from "@/modules/cache";

describe("Research Cache - Normalization", () => {
  it("normalizes tax ID, domain, and Vietnamese name without dropping legal suffixes", () => {
    expect(
      normalizeCompanyIdentity({
        name: "  CÔNG TY  CP Ánh Dương  ",
        taxId: "0101-245.486",
        website: "https://WWW.Example.VN:443/about?q=1",
      })
    ).toEqual({
      taxId: "0101245486",
      domain: "example.vn",
      name: "công ty cp ánh dương",
    });
  });

  it("handles 13-digit tax IDs correctly", () => {
    expect(
      normalizeCompanyIdentity({
        name: "Chi nhánh FPT",
        taxId: "0101248141-001",
      })
    ).toEqual({
      taxId: "0101248141001",
      domain: null,
      name: "chi nhánh fpt",
    });
  });

  it("rejects a malformed supplied tax ID", () => {
    expect(() =>
      normalizeCompanyIdentity({ name: "FPT", taxId: "abc" })
    ).toThrow("Mã số thuế phải có 10 hoặc 13 chữ số");

    expect(() =>
      normalizeCompanyIdentity({ name: "FPT", taxId: "123456789" })
    ).toThrow("Mã số thuế phải có 10 hoặc 13 chữ số");

    expect(() =>
      normalizeCompanyIdentity({ name: "FPT", taxId: "12345678901" })
    ).toThrow("Mã số thuế phải có 10 hoặc 13 chữ số");
  });

  it("normalizes domain removing leading www. and trailing dot", () => {
    expect(
      normalizeCompanyIdentity({
        name: "Test Corp",
        website: "http://www.sub.domain.vn./path",
      })
    ).toEqual({
      taxId: null,
      domain: "sub.domain.vn",
      name: "test corp",
    });
  });

  it("handles null/optional taxId and website gracefully", () => {
    expect(
      normalizeCompanyIdentity({
        name: "Công ty TNHH Một Thành Viên",
      })
    ).toEqual({
      taxId: null,
      domain: null,
      name: "công ty tnhh một thành viên",
    });
  });
});

describe("Research Cache - Decision Logic", () => {
  const withTaxAndDomain: NormalizedCompanyIdentity = {
    taxId: "0101245486",
    domain: "vingroup.net",
    name: "tập đoàn vingroup",
  };

  const candidatesForSameCompany: IdentityCandidate[] = [
    {
      companyId: "company-a",
      taxId: "0101245486",
      domain: "vingroup.net",
      name: "tập đoàn vingroup",
    },
  ];

  const withConflictingKeys: NormalizedCompanyIdentity = {
    taxId: "0101245486",
    domain: "fpt.com.vn",
    name: "tập đoàn vingroup",
  };

  const conflictingCandidates: IdentityCandidate[] = [
    {
      companyId: "company-a",
      taxId: "0101245486",
      domain: "vingroup.net",
      name: "tập đoàn vingroup",
    },
    {
      companyId: "company-b",
      taxId: "0101248141",
      domain: "fpt.com.vn",
      name: "công ty cp fpt",
    },
  ];

  const domainOnly: NormalizedCompanyIdentity = {
    taxId: null,
    domain: "shared-domain.vn",
    name: "công ty a",
  };

  const twoDomainCandidates: IdentityCandidate[] = [
    {
      companyId: "company-a",
      taxId: "0101245486",
      domain: "shared-domain.vn",
      name: "công ty a",
    },
    {
      companyId: "company-b",
      taxId: "0101248141",
      domain: "shared-domain.vn",
      name: "công ty b",
    },
  ];

  const nameOnly: NormalizedCompanyIdentity = {
    taxId: null,
    domain: null,
    name: "công ty cp ánh dương",
  };

  const oneNameCandidate: IdentityCandidate[] = [
    {
      companyId: "company-a",
      taxId: "0101245486",
      domain: "anhduong.vn",
      name: "công ty cp ánh dương",
    },
  ];

  it("resolves exact tax ID and compatible domain to an automatic hit", () => {
    expect(decideCacheLookup(withTaxAndDomain, candidatesForSameCompany)).toEqual({
      kind: "hit",
      companyId: "company-a",
      matchedBy: "tax_id",
    });
  });

  it("detects conflict when supplied tax ID and domain resolve to different companies", () => {
    expect(decideCacheLookup(withConflictingKeys, conflictingCandidates)).toEqual({
      kind: "conflict",
      taxCompanyId: "company-a",
      domainCompanyIds: ["company-b"],
    });
  });

  it("returns suggestions for multi-candidate domain matches", () => {
    expect(decideCacheLookup(domainOnly, twoDomainCandidates)).toEqual({
      kind: "suggestions",
      companyIds: ["company-a", "company-b"],
    });
  });

  it("returns automatic hit for unique domain match without tax ID", () => {
    const singleDomainCandidate: IdentityCandidate[] = [
      {
        companyId: "company-a",
        taxId: "0101245486",
        domain: "unique-domain.vn",
        name: "công ty a",
      },
    ];
    expect(
      decideCacheLookup(
        { taxId: null, domain: "unique-domain.vn", name: "công ty a" },
        singleDomainCandidate
      )
    ).toEqual({
      kind: "hit",
      companyId: "company-a",
      matchedBy: "domain",
    });
  });

  it("returns suggestions for name matches", () => {
    expect(decideCacheLookup(nameOnly, oneNameCandidate)).toEqual({
      kind: "suggestions",
      companyIds: ["company-a"],
    });
  });

  it("returns miss when no candidates match", () => {
    expect(decideCacheLookup(nameOnly, [])).toEqual({ kind: "miss" });
  });
});
