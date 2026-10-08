import { type ConstantValue, hasConstantValue } from "../../../shared/domainConstants";

export const modPanelModes = Object.freeze({
  unsubscribed: "unsubscribed",
  subscribed: "subscribed",
} as const);
export type ModPanelMode = ConstantValue<typeof modPanelModes>;

export const modSorts = Object.freeze({
  newest: "newest",
  oldest: "oldest",
  active: "active",
} as const);
export type ModSort = ConstantValue<typeof modSorts>;
export function isModSort(value: unknown): value is ModSort {
  return hasConstantValue(modSorts, value);
}

export const searchScopes = Object.freeze({
  all: "all",
  title: "title",
  author: "author",
  description: "description",
  tags: "tags",
} as const);
export type SearchScope = ConstantValue<typeof searchScopes>;
export function isSearchScope(value: unknown): value is SearchScope {
  return hasConstantValue(searchScopes, value);
}

export const uiTimings = Object.freeze({
  saveDebounceMs: 250,
  errorNotificationMs: 12_000,
  steamStatusTimeoutMs: 7_000,
  steamStatusPollMs: 10_000,
  activePollMs: 10_000,
  workshopStatusPollMs: 30_000,
  workshopStatusCooldownMs: 5_000,
});

export const keyboardKeys = Object.freeze({
  escape: "Escape",
  home: "Home",
  end: "End",
  arrowDown: "ArrowDown",
  arrowUp: "ArrowUp",
} as const);
export const viewportPadding = 8;
export const maxTagNameLength = 100;
