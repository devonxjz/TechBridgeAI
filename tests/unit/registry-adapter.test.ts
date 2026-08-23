import { afterEach, describe, expect, it, vi } from "vitest";
import { VietQrRegistryAdapter } from "@/adapters/registry/vietqr";
import { RegistryError } from "@/adapters/registry/types";

describe("VietQrRegistryAdapter", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fetches business details by taxId from VietQR endpoint and maps data", async () => {
    let capturedUrl = "";
    vi.spyOn(globalThis, "fetch").mockImplementationOnce(async (url) => {
      capturedUrl = String(url);
      return new Response(
        JSON.stringify({
          code: "00",
          desc: "success",
          data: {
            id: "0101234567",
            name: "CÔNG TY CỔ PHẦN FPT",
            internationalName: "FPT CORPORATION",
            shortName: "FPT",
            address: "Số 10 phố Phạm Văn Bạch, Dịch Vọng, Cầu Giấy, Hà Nội",
          },
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    });

    const adapter = new VietQrRegistryAdapter();
    const record = await adapter.findByTaxId("0101234567");

    expect(capturedUrl).toBe("https://api.vietqr.io/v2/business/0101234567");
    expect(record).toEqual({
      taxId: "0101234567",
      name: "CÔNG TY CỔ PHẦN FPT",
      internationalName: "FPT CORPORATION",
      shortName: "FPT",
      address: "Số 10 phố Phạm Văn Bạch, Dịch Vọng, Cầu Giấy, Hà Nội",
    });
  });

  it("caches successful lookup in memory and returns cached result on second call", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      return new Response(
        JSON.stringify({
          code: "00",
          desc: "success",
          data: {
            id: "0101234567",
            name: "CÔNG TY CỔ PHẦN FPT",
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });

    const adapter = new VietQrRegistryAdapter();
    const res1 = await adapter.findByTaxId("0101234567");
    const res2 = await adapter.findByTaxId("0101234567");

    expect(res1?.name).toBe("CÔNG TY CỔ PHẦN FPT");
    expect(res2?.name).toBe("CÔNG TY CỔ PHẦN FPT");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("throws RegistryError rate_limited on 429 status without caching", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("Too Many Requests", { status: 429 }),
    );

    const adapter = new VietQrRegistryAdapter();
    try {
      await adapter.findByTaxId("0101234567");
      expect.unreachable("Should throw");
    } catch (err) {
      expect(err).toBeInstanceOf(RegistryError);
      expect((err as RegistryError).code).toBe("rate_limited");
    }

    // Call again to verify not cached
    try {
      await adapter.findByTaxId("0101234567");
    } catch {
      // Expected
    }
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("throws RegistryError not_found on 404 or code != 00 not found", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("Not Found", { status: 404 }),
    );

    const adapter = new VietQrRegistryAdapter();
    try {
      await adapter.findByTaxId("0000000000");
      expect.unreachable("Should throw");
    } catch (err) {
      expect(err).toBeInstanceOf(RegistryError);
      expect((err as RegistryError).code).toBe("not_found");
    }
  });

  it("throws RegistryError invalid_response on malformed JSON or missing data", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ code: "00", desc: "ok" }), { status: 200 }),
    );

    const adapter = new VietQrRegistryAdapter();
    try {
      await adapter.findByTaxId("0101234567");
      expect.unreachable("Should throw");
    } catch (err) {
      expect(err).toBeInstanceOf(RegistryError);
      expect((err as RegistryError).code).toBe("invalid_response");
    }
  });

  it("throws RegistryError timeout on abort", async () => {
    const abortErr = new Error("Timeout");
    abortErr.name = "TimeoutError";
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(abortErr);

    const adapter = new VietQrRegistryAdapter();
    try {
      await adapter.findByTaxId("0101234567");
      expect.unreachable("Should throw");
    } catch (err) {
      expect(err).toBeInstanceOf(RegistryError);
      expect((err as RegistryError).code).toBe("timeout");
    }
  });
});
