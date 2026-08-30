"use client";

import type { GetResearchRequestContext } from "@/app/hooks/use-research";

let requestContextProvider: GetResearchRequestContext | null = null;

export function setResearchRequestContextProvider(
  provider: GetResearchRequestContext | null
): void {
  requestContextProvider = provider;
}

export async function getResearchRequestContext() {
  if (!requestContextProvider) {
    throw new Error(
      "Research authentication context is unavailable. Configure a request-context provider with the current Supabase session before starting research."
    );
  }

  return requestContextProvider();
}
