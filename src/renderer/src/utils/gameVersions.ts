export function normalizedGameVersion(value: string): string {
  const normalized = value.trim().replace(/^v(?=\d)/i, "");
  return /^\d+\.\d+/.exec(normalized)?.[0] ?? normalized;
}

/** Matches RimSort's ByVersion precedence: vX.Y, X.Y, then the first vX.Y.* key. */
export function matchingVersionedGroup<T extends { gameVersion: string }>(
  groups: readonly T[],
  gameVersion?: string,
): T | undefined {
  if (!gameVersion) {
    return undefined;
  }
  const current = normalizedGameVersion(gameVersion);
  const majorMinor = /^\d+\.\d+/.exec(current)?.[0];
  if (!majorMinor) {
    return undefined;
  }
  const exactVersionedKey = `v${majorMinor}`;
  const exactVersioned = groups.find(
    ({ gameVersion: candidate }) => candidate.trim().toLowerCase() === exactVersionedKey,
  );
  if (exactVersioned) {
    return exactVersioned;
  }
  const exactBare = groups.find(
    ({ gameVersion: candidate }) => candidate.trim().toLowerCase() === majorMinor,
  );
  if (exactBare) {
    return exactBare;
  }
  return groups.find(({ gameVersion: candidate }) => {
    const normalizedCandidate = candidate.trim().toLowerCase();
    return (
      normalizedCandidate.startsWith("v") &&
      normalizedGameVersion(normalizedCandidate) === majorMinor
    );
  });
}
