import type { ResearchErrorCode } from "@/lib/types";

export interface PublicResearchError {
  code: ResearchErrorCode | "internal_error";
  message: string;
  retryable: boolean;
}

const PUBLIC_ERRORS: Record<string, PublicResearchError> = {
  identity_conflict: {
    code: "identity_conflict",
    message: "Thông tin định danh công ty mâu thuẫn.",
    retryable: false,
  },
  invalid_cache_selection: {
    code: "invalid_cache_selection",
    message: "Lựa chọn cache không hợp lệ với dữ liệu nhập.",
    retryable: false,
  },
  cache_unavailable: {
    code: "cache_unavailable",
    message: "Bộ nhớ đệm tạm thời không khả dụng.",
    retryable: true,
  },
  version_conflict: {
    code: "research_failed",
    message: "Dữ liệu đã được cập nhật bởi một yêu cầu khác.",
    retryable: true,
  },
};

export function toPublicResearchError(error: unknown): PublicResearchError {
  const message = error instanceof Error ? error.message : "";
  for (const [code, publicError] of Object.entries(PUBLIC_ERRORS)) {
    if (message.includes(code)) return publicError;
  }

  return {
    code: "internal_error",
    message: "Nghiên cứu tạm thời không khả dụng.",
    retryable: true,
  };
}
