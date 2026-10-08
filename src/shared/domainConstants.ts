export type ConstantValue<Values> = Values[keyof Values];

export function hasConstantValue<const Values extends Record<string, string | number>>(
  values: Values,
  value: unknown,
): value is ConstantValue<Values> {
  return Object.values(values).some((entry) => entry === value);
}

export const modSources = Object.freeze({
  steam: "steam",
  local: "local",
  manual: "manual",
} as const);
export const steamStatusSources = Object.freeze({
  workshopFolders: "workshop-folders",
  steamClient: "steam-client",
} as const);
export const modActivities = Object.freeze({
  active: "active",
  inactive: "inactive",
  unknown: "unknown",
} as const);
export const subscriptionCommands = Object.freeze({
  subscribe: "subscribe",
  unsubscribe: "unsubscribe",
} as const);
export const subscriptionActions = Object.freeze({
  subscribeMods: "subscribe-mods",
  unsubscribeMods: "unsubscribe-mods",
} as const);
