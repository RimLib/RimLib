import { normalizePackageId } from "../../../shared/packages";
import type { Mod, ModDependency, ModLoadRule } from "../../../shared/types";
import { matchingVersionedGroup, normalizedGameVersion } from "./gameVersions";

const tierZeroPackageOrder = [
  "zetrith.prepatcher",
  "brrainz.harmony",
  "brrainz.visualexceptions",
  "ludeon.rimworld",
  "ludeon.rimworld.royalty",
  "ludeon.rimworld.ideology",
  "ludeon.rimworld.biotech",
  "ludeon.rimworld.anomaly",
  "ludeon.rimworld.odyssey",
] as const;
const tierZeroPackageIds = new Set<string>(tierZeroPackageOrder);
const tierZeroPackagePriorities = new Map<string, number>(
  tierZeroPackageOrder.map((packageId, index) => [packageId, index]),
);

export type ModSortWarningCode =
  | "missing-package-id"
  | "missing-rule-target"
  | "missing-dependency-target"
  | "inferred-dependency-overridden";

export interface ModSortWarning {
  code: ModSortWarningCode;
  message: string;
  modId: string;
  packageId?: string;
  targetPackageId?: string;
}

export interface ModSortStats {
  inputCount: number;
  sortableCount: number;
  tierZeroCount: number;
  topologicalLevelCount: number;
  explicitRuleCount: number;
  inferredDependencyCount: number;
  ignoredMissingTargetCount: number;
  overriddenInferredDependencyCount: number;
  missingPackageIdCount: number;
  movedCount: number;
}

export type ModOrderConstraintCode = "load-after" | "load-before" | "dependency" | "bootstrap";

/** A concrete predecessor relationship used by both auto-sort and active-list validation. */
export interface ModOrderConstraint {
  code: ModOrderConstraintCode;
  ownerModId: string;
  predecessorModId: string;
  predecessorPackageId: string;
  dependentModId: string;
  dependentPackageId: string;
  message: string;
}

export interface ModOrderCycle {
  packageIds: string[];
  modIds: string[];
}

/** Order diagnostics are available even when no sorted proposal can be produced. */
export interface ModOrderAnalysis {
  constraints: ModOrderConstraint[];
  tierZeroModIds: string[];
  cycles: ModOrderCycle[];
}

export interface ModSortSuccess extends ModOrderAnalysis {
  ok: true;
  mods: Mod[];
  stats: ModSortStats;
  warnings: ModSortWarning[];
}

export interface DuplicatePackageIdFailure extends ModOrderAnalysis {
  ok: false;
  code: "duplicate-package-id";
  message: string;
  duplicates: {
    packageId: string;
    modIds: string[];
    names: string[];
  }[];
}

export interface ModSortCycleFailure extends ModOrderAnalysis {
  ok: false;
  code: "cycle";
  message: string;
  cyclePackageIds: string[];
  cycleModIds: string[];
}

export type ModSortFailure = DuplicatePackageIdFailure | ModSortCycleFailure;
export type ModSortResult = ModSortSuccess | ModSortFailure;

interface SortNode {
  mod: Mod;
  originalIndex: number;
  packageId: string;
}

interface VersionedPackageReference {
  packageId: string;
  gameVersions?: string[];
}

interface TierSortSuccess {
  ok: true;
  levels: number;
  packageIds: string[];
}

interface TierSortFailure {
  ok: false;
  cyclePackageIdGroups: string[][];
}

function referenceApplies(reference: VersionedPackageReference, gameVersion?: string): boolean {
  if (!reference.gameVersions?.length) {
    return true;
  }
  if (!gameVersion) {
    return false;
  }
  const current = normalizedGameVersion(gameVersion);
  return reference.gameVersions.some((candidate) => normalizedGameVersion(candidate) === current);
}

function effectiveLoadRules(
  mod: Mod,
  direction: "after" | "before",
  gameVersion?: string,
): readonly ModLoadRule[] {
  const base = direction === "after" ? mod.loadAfter : mod.loadBefore;
  const byVersion = direction === "after" ? mod.loadAfterByVersion : mod.loadBeforeByVersion;
  const force = direction === "after" ? mod.forceLoadAfter : mod.forceLoadBefore;
  const matching = matchingVersionedGroup(byVersion ?? [], gameVersion);
  return [...(matching ? matching.rules : (base ?? [])), ...(force ?? [])];
}

function effectiveDependencies(mod: Mod, gameVersion?: string): readonly ModDependency[] {
  const matching = matchingVersionedGroup(mod.dependenciesByVersion ?? [], gameVersion);
  return matching ? matching.dependencies : (mod.dependencies ?? []);
}

function compareText(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

function compareNodes(left: SortNode, right: SortNode): number {
  const byName = compareText(
    left.mod.name.trim().toLocaleLowerCase("en-US"),
    right.mod.name.trim().toLocaleLowerCase("en-US"),
  );
  if (byName !== 0) {
    return byName;
  }
  const byPackageId = compareText(left.packageId, right.packageId);
  return byPackageId !== 0 ? byPackageId : left.originalIndex - right.originalIndex;
}

function compareTierZeroNodes(left: SortNode, right: SortNode): number {
  // Recognized packages use their canonical bootstrap/game order. Metadata graph edges still win,
  // while prerequisite-only nodes use package IDs rather than mutable display names.
  const leftPriority = tierZeroPackagePriorities.get(left.packageId) ?? Number.MAX_SAFE_INTEGER;
  const rightPriority = tierZeroPackagePriorities.get(right.packageId) ?? Number.MAX_SAFE_INTEGER;
  if (leftPriority !== rightPriority) {
    return leftPriority - rightPriority;
  }
  const byPackageId = compareText(left.packageId, right.packageId);
  return byPackageId !== 0 ? byPackageId : left.originalIndex - right.originalIndex;
}

function hasPredecessorPath(
  predecessors: ReadonlyMap<string, ReadonlySet<string>>,
  fromPackageId: string,
  targetPackageId: string,
): boolean {
  const pending = [fromPackageId];
  const visited = new Set<string>();
  while (pending.length) {
    const packageId = pending.pop();
    if (!packageId || visited.has(packageId)) {
      continue;
    }
    visited.add(packageId);
    for (const predecessor of predecessors.get(packageId) ?? []) {
      if (predecessor === targetPackageId) {
        return true;
      }
      pending.push(predecessor);
    }
  }
  return false;
}

function edgeKey(dependent: string, predecessor: string): string {
  return `${dependent}\0${predecessor}`;
}

function displayName(node: SortNode): string {
  return node.mod.name.trim() || node.packageId;
}

function findCycle(
  packageIds: ReadonlySet<string>,
  predecessors: ReadonlyMap<string, ReadonlySet<string>>,
  nodes: ReadonlyMap<string, SortNode>,
  compareNode: (left: SortNode, right: SortNode) => number = compareNodes,
): string[] {
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const stack: string[] = [];
  const stackIndexes = new Map<string, number>();
  const comparePackageIds = (left: string, right: string) => {
    const leftNode = nodes.get(left);
    const rightNode = nodes.get(right);
    return leftNode && rightNode ? compareNode(leftNode, rightNode) : compareText(left, right);
  };

  const visit = (packageId: string): string[] | undefined => {
    visiting.add(packageId);
    stackIndexes.set(packageId, stack.length);
    stack.push(packageId);

    const next = [...(predecessors.get(packageId) ?? [])]
      .filter((candidate) => packageIds.has(candidate))
      .sort(comparePackageIds);
    for (const candidate of next) {
      if (visiting.has(candidate)) {
        const start = stackIndexes.get(candidate) ?? 0;
        return [...stack.slice(start), candidate];
      }
      if (!visited.has(candidate)) {
        const cycle = visit(candidate);
        if (cycle) {
          return cycle;
        }
      }
    }

    stack.pop();
    stackIndexes.delete(packageId);
    visiting.delete(packageId);
    visited.add(packageId);
    return undefined;
  };

  for (const packageId of [...packageIds].sort(comparePackageIds)) {
    if (!visited.has(packageId)) {
      const cycle = visit(packageId);
      if (cycle) {
        return cycle;
      }
    }
  }
  return [...packageIds].sort(comparePackageIds);
}

function findCyclicComponents(
  packageIds: ReadonlySet<string>,
  predecessors: ReadonlyMap<string, ReadonlySet<string>>,
  nodes: ReadonlyMap<string, SortNode>,
  compareNode: (left: SortNode, right: SortNode) => number = compareNodes,
): string[][] {
  let nextIndex = 0;
  const indexes = new Map<string, number>();
  const lowLinks = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const components: string[][] = [];
  const comparePackageIds = (left: string, right: string) => {
    const leftNode = nodes.get(left);
    const rightNode = nodes.get(right);
    return leftNode && rightNode ? compareNode(leftNode, rightNode) : compareText(left, right);
  };

  const visit = (packageId: string) => {
    const index = nextIndex;
    nextIndex += 1;
    indexes.set(packageId, index);
    lowLinks.set(packageId, index);
    stack.push(packageId);
    onStack.add(packageId);

    const next = [...(predecessors.get(packageId) ?? [])]
      .filter((candidate) => packageIds.has(candidate))
      .sort(comparePackageIds);
    for (const candidate of next) {
      if (!indexes.has(candidate)) {
        visit(candidate);
        lowLinks.set(
          packageId,
          Math.min(lowLinks.get(packageId) ?? index, lowLinks.get(candidate) ?? index),
        );
      } else if (onStack.has(candidate)) {
        lowLinks.set(
          packageId,
          Math.min(lowLinks.get(packageId) ?? index, indexes.get(candidate) ?? index),
        );
      }
    }

    if (lowLinks.get(packageId) !== index) {
      return;
    }
    const component: string[] = [];
    let member: string | undefined;
    do {
      member = stack.pop();
      if (member) {
        onStack.delete(member);
        component.push(member);
      }
    } while (member && member !== packageId);

    const isCycle =
      component.length > 1 ||
      (component[0] !== undefined && predecessors.get(component[0])?.has(component[0]));
    if (isCycle) {
      components.push(component.sort(comparePackageIds));
    }
  };

  for (const packageId of [...packageIds].sort(comparePackageIds)) {
    if (!indexes.has(packageId)) {
      visit(packageId);
    }
  }
  return components.sort((left, right) => comparePackageIds(left[0] ?? "", right[0] ?? ""));
}

function sortTier(
  tierPackageIds: ReadonlySet<string>,
  predecessors: ReadonlyMap<string, ReadonlySet<string>>,
  nodes: ReadonlyMap<string, SortNode>,
  compareNode: (left: SortNode, right: SortNode) => number = compareNodes,
): TierSortSuccess | TierSortFailure {
  if (!tierPackageIds.size) {
    return { ok: true, levels: 0, packageIds: [] };
  }

  const remainingPredecessors = new Map<string, number>();
  const dependents = new Map<string, Set<string>>();
  for (const packageId of tierPackageIds) {
    let count = 0;
    for (const predecessor of predecessors.get(packageId) ?? []) {
      if (!tierPackageIds.has(predecessor)) {
        continue;
      }
      count += 1;
      const current = dependents.get(predecessor) ?? new Set<string>();
      current.add(packageId);
      dependents.set(predecessor, current);
    }
    remainingPredecessors.set(packageId, count);
  }

  const comparePackageIds = (left: string, right: string) => {
    const leftNode = nodes.get(left);
    const rightNode = nodes.get(right);
    return leftNode && rightNode ? compareNode(leftNode, rightNode) : compareText(left, right);
  };
  let currentLevel = [...remainingPredecessors]
    .filter(([, count]) => count === 0)
    .map(([packageId]) => packageId)
    .sort(comparePackageIds);
  const sorted: string[] = [];
  let levels = 0;

  while (currentLevel.length) {
    levels += 1;
    sorted.push(...currentLevel);
    const nextLevel = new Set<string>();
    for (const packageId of currentLevel) {
      for (const dependent of dependents.get(packageId) ?? []) {
        const nextCount = (remainingPredecessors.get(dependent) ?? 0) - 1;
        remainingPredecessors.set(dependent, nextCount);
        if (nextCount === 0) {
          nextLevel.add(dependent);
        }
      }
    }
    currentLevel = [...nextLevel].sort(comparePackageIds);
  }

  if (sorted.length !== tierPackageIds.size) {
    const sortedIds = new Set(sorted);
    const cyclicIds = new Set([...tierPackageIds].filter((packageId) => !sortedIds.has(packageId)));
    return {
      ok: false,
      cyclePackageIdGroups: findCyclicComponents(cyclicIds, predecessors, nodes, compareNode),
    };
  }
  return { ok: true, levels, packageIds: sorted };
}

/**
 * Proposes a deterministic RimSort-inspired order without mutating the active list.
 * The caller remains responsible for placing the proposal in the draft and applying it.
 */
export function sortActiveMods(activeMods: readonly Mod[], gameVersion?: string): ModSortResult {
  const nodes = new Map<string, SortNode>();
  const duplicateNodes = new Map<string, SortNode[]>();
  const missingPackageIdIndexes = new Set<number>();

  activeMods.forEach((mod, originalIndex) => {
    const packageId = normalizePackageId(mod.packageId ?? "");
    if (!packageId) {
      missingPackageIdIndexes.add(originalIndex);
      return;
    }
    const node = { mod, originalIndex, packageId };
    const previous = nodes.get(packageId);
    if (previous) {
      duplicateNodes.set(packageId, [...(duplicateNodes.get(packageId) ?? [previous]), node]);
      return;
    }
    nodes.set(packageId, node);
  });

  const duplicates = [...duplicateNodes]
    .sort(([left], [right]) => compareText(left, right))
    .map(([packageId, entries]) => ({
      packageId,
      modIds: entries.map(({ mod }) => mod.id),
      names: entries.map(({ mod }) => mod.name),
    }));
  // A duplicate package cannot safely participate in an order edge because references to it are
  // ambiguous. Keep analysing the unique portion of the graph so validation can still report
  // independent cycles and misplaced mods even though auto-sort cannot propose an order.
  for (const { packageId } of duplicates) {
    nodes.delete(packageId);
  }

  const warnings: ModSortWarning[] = [];
  const warningKeys = new Set<string>();
  const addWarning = (key: string, warning: ModSortWarning) => {
    if (!warningKeys.has(key)) {
      warningKeys.add(key);
      warnings.push(warning);
    }
  };
  for (const originalIndex of missingPackageIdIndexes) {
    const mod = activeMods[originalIndex];
    if (mod) {
      addWarning(`missing-package-id\0${originalIndex}`, {
        code: "missing-package-id",
        modId: mod.id,
        message: `${mod.name || "Unnamed mod"} has no package ID and stayed in its current position.`,
      });
    }
  }

  const predecessors = new Map<string, Set<string>>(
    [...nodes].map(([packageId]) => [packageId, new Set<string>()]),
  );
  const explicitEdges = new Set<string>();
  const inferredEdges = new Set<string>();
  const constraints = new Map<string, ModOrderConstraint>();

  const missingTarget = (
    node: SortNode,
    reference: VersionedPackageReference,
    code: "missing-rule-target" | "missing-dependency-target",
  ) => {
    const targetPackageId = normalizePackageId(reference.packageId);
    const label = code === "missing-rule-target" ? "load rule" : "declared dependency";
    addWarning(`${code}\0${node.packageId}\0${targetPackageId}`, {
      code,
      modId: node.mod.id,
      packageId: node.packageId,
      targetPackageId,
      message: `${displayName(node)} references unavailable ${label} target ${
        reference.packageId || "(missing package ID)"
      }; the target was ignored.`,
    });
  };

  const addExplicitEdge = (
    node: SortNode,
    reference: VersionedPackageReference,
    direction: "after" | "before",
  ) => {
    if (!referenceApplies(reference, gameVersion)) {
      return;
    }
    const targetPackageId = normalizePackageId(reference.packageId);
    if (!targetPackageId || !nodes.has(targetPackageId)) {
      missingTarget(node, reference, "missing-rule-target");
      return;
    }
    const dependent = direction === "after" ? node.packageId : targetPackageId;
    const predecessor = direction === "after" ? targetPackageId : node.packageId;
    const key = edgeKey(dependent, predecessor);
    if (!explicitEdges.has(key)) {
      explicitEdges.add(key);
      predecessors.get(dependent)?.add(predecessor);
      const target = nodes.get(targetPackageId);
      const predecessorNode = nodes.get(predecessor);
      const dependentNode = nodes.get(dependent);
      if (target && predecessorNode && dependentNode) {
        constraints.set(key, {
          code: direction === "after" ? "load-after" : "load-before",
          ownerModId: node.mod.id,
          predecessorModId: predecessorNode.mod.id,
          predecessorPackageId: predecessor,
          dependentModId: dependentNode.mod.id,
          dependentPackageId: dependent,
          message:
            direction === "after"
              ? `${displayName(node)} must load after ${displayName(target)}.`
              : `${displayName(node)} must load before ${displayName(target)}.`,
        });
      }
    }
  };

  for (const node of nodes.values()) {
    for (const rule of effectiveLoadRules(node.mod, "after", gameVersion)) {
      addExplicitEdge(node, rule, "after");
    }
    for (const rule of effectiveLoadRules(node.mod, "before", gameVersion)) {
      addExplicitEdge(node, rule, "before");
    }
  }

  for (const node of nodes.values()) {
    for (const dependency of effectiveDependencies(node.mod, gameVersion)) {
      if (!referenceApplies(dependency, gameVersion)) {
        continue;
      }
      const targetPackageId = normalizePackageId(dependency.packageId);
      if (!targetPackageId || !nodes.has(targetPackageId)) {
        missingTarget(node, dependency, "missing-dependency-target");
        continue;
      }
      const key = edgeKey(node.packageId, targetPackageId);
      if (explicitEdges.has(key) || inferredEdges.has(key)) {
        continue;
      }
      const reverseKey = edgeKey(targetPackageId, node.packageId);
      if (explicitEdges.has(reverseKey)) {
        addWarning(`inferred-dependency-overridden\0${key}`, {
          code: "inferred-dependency-overridden",
          modId: node.mod.id,
          packageId: node.packageId,
          targetPackageId,
          message: `${displayName(node)} declares ${targetPackageId} as a dependency, but an explicit rule requires the reverse order; the explicit rule won.`,
        });
        continue;
      }
      inferredEdges.add(key);
      predecessors.get(node.packageId)?.add(targetPackageId);
      const target = nodes.get(targetPackageId);
      if (target) {
        constraints.set(key, {
          code: "dependency",
          ownerModId: node.mod.id,
          predecessorModId: target.mod.id,
          predecessorPackageId: targetPackageId,
          dependentModId: node.mod.id,
          dependentPackageId: node.packageId,
          message: `${displayName(node)} depends on ${displayName(target)} and must load after it.`,
        });
      }
    }
  }

  // Prefer the standard bootstrap/game sequence without overriding About.xml metadata. Each edge
  // is added only when the current graph has no reverse path, so a declared rule/dependency wins
  // and the preference can never introduce a cycle. Filtering first also links across absent
  // entries, preserving the relative order of whichever recognized packages are active.
  const presentTierZeroPackages = tierZeroPackageOrder.filter((packageId) => nodes.has(packageId));
  for (let index = 1; index < presentTierZeroPackages.length; index += 1) {
    const predecessor = presentTierZeroPackages[index - 1];
    const dependent = presentTierZeroPackages[index];
    if (predecessor && dependent && !hasPredecessorPath(predecessors, predecessor, dependent)) {
      predecessors.get(dependent)?.add(predecessor);
      const predecessorNode = nodes.get(predecessor);
      const dependentNode = nodes.get(dependent);
      const key = edgeKey(dependent, predecessor);
      if (predecessorNode && dependentNode && !constraints.has(key)) {
        constraints.set(key, {
          code: "bootstrap",
          ownerModId: predecessorNode.mod.id,
          predecessorModId: predecessorNode.mod.id,
          predecessorPackageId: predecessor,
          dependentModId: dependentNode.mod.id,
          dependentPackageId: dependent,
          message: `${displayName(predecessorNode)} must load before ${displayName(dependentNode)} in the standard bootstrap order.`,
        });
      }
    }
  }

  const tierZero = new Set<string>();
  const pendingTierZero: string[] = [];
  for (const packageId of nodes.keys()) {
    if (tierZeroPackageIds.has(packageId)) {
      tierZero.add(packageId);
      pendingTierZero.push(packageId);
    }
  }
  while (pendingTierZero.length) {
    const packageId = pendingTierZero.pop();
    if (!packageId) {
      continue;
    }
    for (const predecessor of predecessors.get(packageId) ?? []) {
      if (!tierZero.has(predecessor)) {
        tierZero.add(predecessor);
        pendingTierZero.push(predecessor);
      }
    }
  }
  const remaining = new Set([...nodes.keys()].filter((packageId) => !tierZero.has(packageId)));

  const sortedTierZero = sortTier(tierZero, predecessors, nodes, compareTierZeroNodes);
  const sortedRemaining = sortTier(remaining, predecessors, nodes);
  const cyclePackageIdGroups = [
    ...(sortedTierZero.ok ? [] : sortedTierZero.cyclePackageIdGroups),
    ...(sortedRemaining.ok ? [] : sortedRemaining.cyclePackageIdGroups),
  ];
  const cycles = cyclePackageIdGroups.map((packageIds) => ({
    packageIds,
    modIds: packageIds.flatMap((packageId) => nodes.get(packageId)?.mod.id ?? []),
  }));
  const constraintsList = [...constraints.values()];
  const tierZeroModIds = [...tierZero].flatMap((packageId) => nodes.get(packageId)?.mod.id ?? []);
  const analysis: ModOrderAnalysis = {
    constraints: constraintsList,
    tierZeroModIds,
    cycles,
  };

  if (duplicates.length) {
    return {
      ...analysis,
      ok: false,
      code: "duplicate-package-id",
      message: `Cannot sort while multiple active mods use: ${duplicates
        .map(({ packageId }) => packageId)
        .join(", ")}.`,
      duplicates,
    };
  }

  if (!sortedTierZero.ok || !sortedRemaining.ok) {
    const firstCycleMembers = cyclePackageIdGroups[0] ?? [];
    const compareCycleNodes = firstCycleMembers.some((packageId) => tierZero.has(packageId))
      ? compareTierZeroNodes
      : compareNodes;
    const cyclePackageIds = findCycle(
      new Set(firstCycleMembers),
      predecessors,
      nodes,
      compareCycleNodes,
    );
    return {
      ...analysis,
      ok: false,
      code: "cycle",
      message:
        cycles.length === 1
          ? `Cannot sort because these active mods form a cycle: ${cyclePackageIds.join(" -> ")}.`
          : `Cannot sort because active mods form ${cycles.length} independent load-order cycles.`,
      cyclePackageIds,
      cycleModIds: cyclePackageIds.flatMap((packageId) => nodes.get(packageId)?.mod.id ?? []),
    };
  }

  const orderedNodes = [...sortedTierZero.packageIds, ...sortedRemaining.packageIds].map(
    (packageId) => nodes.get(packageId)?.mod,
  );
  let orderedIndex = 0;
  const mods = activeMods.map((mod, index) =>
    missingPackageIdIndexes.has(index) ? mod : (orderedNodes[orderedIndex++] ?? mod),
  );
  const movedCount = mods.reduce(
    (count, mod, index) => count + (mod === activeMods[index] ? 0 : 1),
    0,
  );
  const ignoredMissingTargetCount = warnings.filter(
    ({ code }) => code === "missing-rule-target" || code === "missing-dependency-target",
  ).length;
  const overriddenInferredDependencyCount = warnings.filter(
    ({ code }) => code === "inferred-dependency-overridden",
  ).length;

  return {
    ...analysis,
    ok: true,
    mods,
    warnings,
    stats: {
      inputCount: activeMods.length,
      sortableCount: nodes.size,
      tierZeroCount: tierZero.size,
      topologicalLevelCount: sortedTierZero.levels + sortedRemaining.levels,
      explicitRuleCount: explicitEdges.size,
      inferredDependencyCount: inferredEdges.size,
      ignoredMissingTargetCount,
      overriddenInferredDependencyCount,
      missingPackageIdCount: missingPackageIdIndexes.size,
      movedCount,
    },
  };
}
