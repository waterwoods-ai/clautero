/**
 * Provider registry — the fixed roster of supported agent CLIs.
 * (Grok is deliberately absent: no local binary was available to verify
 * its protocol against; add it here once its JSON mode is confirmed.)
 */

import type { ProviderModule } from "./types";
import { claudeProvider } from "./claude";
import { codexProvider } from "./codex";
import { opencodeProvider } from "./opencode";
import { piProvider } from "./pi";

export const PROVIDERS: readonly ProviderModule[] = Object.freeze([
  claudeProvider,
  codexProvider,
  opencodeProvider,
  piProvider,
]);

export const DEFAULT_PROVIDER_ID = "claude";

export function getProvider(id: string | null | undefined): ProviderModule {
  return PROVIDERS.find((p) => p.id === id) ?? claudeProvider;
}

export function nextProvider(currentId: string, availableIds: readonly string[]): ProviderModule {
  const roster = PROVIDERS.filter((p) => availableIds.includes(p.id));
  if (roster.length === 0) return getProvider(currentId);
  const idx = roster.findIndex((p) => p.id === currentId);
  return roster[(idx + 1) % roster.length];
}
