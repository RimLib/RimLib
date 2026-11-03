import assert from "node:assert/strict";
import { test } from "node:test";

import { validateActiveMods } from "../src/renderer/src/utils/activeValidation";
import type { Mod } from "../src/shared/types";

function mod(packageId: string, patch: Partial<Mod> = {}): Mod {
  return {
    id: patch.id ?? `mod-${packageId}`,
    packageId,
    name: patch.name ?? packageId,
    author: "Author",
    source: "local",
    summary: "",
    gameVersions: [],
    tags: [],
    subscribed: false,
    downloadedAt: "",
    addedAt: "",
    screenshots: [],
    ...patch,
  };
}

function codes(result: ReturnType<typeof validateActiveMods>, modId: string) {
  return (result.issuesByModId.get(modId) ?? []).map(({ code }) => code);
}

void test("version validation compares major/minor and treats missing support metadata as unknown", () => {
  const compatible = mod("author.compatible", { gameVersions: ["v1.6.9999", "1.5"] });
  const incompatible = mod("author.incompatible", { gameVersions: ["1.4", "v1.5"] });
  const unknown = mod("author.unknown");
  const result = validateActiveMods([compatible, incompatible, unknown], "1.6.4633 rev42");

  assert.equal(result.invalidModIds.has(compatible.id), false);
  assert.deepEqual(codes(result, incompatible.id), ["incompatible-version"]);
  assert.equal(result.invalidModIds.has(unknown.id), false);
  assert.equal(validateActiveMods([incompatible], "development").issues.length, 0);
  assert.equal(validateActiveMods([incompatible]).issues.length, 0);
});

void test("version validation ignores malformed supported-version candidates", () => {
  const malformedOnly = mod("author.malformed", {
    gameVersions: ["latest", "RimWorld", ""],
  });
  const malformedAndCompatible = mod("author.mixed-compatible", {
    gameVersions: ["unknown", "v1.6.4633"],
  });
  const malformedAndIncompatible = mod("author.mixed-incompatible", {
    gameVersions: ["unknown", "1.5"],
  });

  const result = validateActiveMods(
    [malformedOnly, malformedAndCompatible, malformedAndIncompatible],
    "1.6.4633",
  );

  assert.equal(result.invalidModIds.has(malformedOnly.id), false);
  assert.equal(result.invalidModIds.has(malformedAndCompatible.id), false);
  assert.deepEqual(codes(result, malformedAndIncompatible.id), ["incompatible-version"]);
});

void test("missing dependencies and dependency order are separate draft-aware findings", () => {
  const framework = mod("author.framework", { name: "Framework" });
  const addon = mod("author.addon", {
    name: "Addon",
    dependencies: [{ packageId: "AUTHOR.FRAMEWORK_steam", displayName: "Framework" }],
  });

  const missing = validateActiveMods([addon], "1.6");
  assert.deepEqual(codes(missing, addon.id), ["missing-dependency"]);
  assert.deepEqual(missing.missingDependenciesById.get(addon.id), addon.dependencies);

  const reversed = validateActiveMods([addon, framework], "1.6");
  assert.deepEqual(codes(reversed, addon.id), ["load-order"]);
  assert.equal(reversed.missingDependenciesById.size, 0);

  const fixed = validateActiveMods([framework, addon], "1.6");
  assert.equal(fixed.invalidModIds.size, 0);
});

void test("versioned rule replacement, force rules and inactive targets match auto-sort semantics", () => {
  const base = mod("author.base");
  const forced = mod("author.forced");
  const subject = mod("author.subject", {
    loadAfter: [{ packageId: base.packageId ?? "" }],
    loadAfterByVersion: [{ gameVersion: "v1.6", rules: [] }],
    forceLoadAfter: [{ packageId: forced.packageId ?? "" }],
    loadBefore: [{ packageId: "author.not-active" }],
  });

  const matching = validateActiveMods([subject, base, forced], "1.6.4633");
  const matchingIssues = matching.issuesByModId.get(subject.id) ?? [];
  assert.equal(matchingIssues.length, 1);
  assert.equal(matchingIssues[0]?.orderRule, "load-after");
  assert.match(matchingIssues[0].message, /forced/);

  const fallback = validateActiveMods([subject, base, forced], "1.5");
  assert.equal(
    (fallback.issuesByModId.get(subject.id) ?? []).filter(({ code }) => code === "load-order")
      .length,
    2,
  );
});

void test("a directly reversed explicit rule overrides inferred dependency order", () => {
  const addon = mod("author.addon", {
    dependencies: [{ packageId: "author.framework" }],
  });
  const framework = mod("author.framework", {
    loadAfter: [{ packageId: "author.addon" }],
  });

  const valid = validateActiveMods([addon, framework]);
  assert.equal(valid.invalidModIds.size, 0);
  const invalid = validateActiveMods([framework, addon]);
  assert.deepEqual(codes(invalid, framework.id), ["load-order"]);
  assert.equal(invalid.invalidModIds.has(addon.id), false);
});

void test("bootstrap order catches misplaced Harmony without invalidating unconstrained peers", () => {
  const regular = mod("author.regular", { name: "Regular" });
  const harmony = mod("brrainz.harmony", { name: "Harmony" });
  const core = mod("ludeon.rimworld", { name: "Core" });
  const zeta = mod("author.zeta");
  const alpha = mod("author.alpha");

  const misplaced = validateActiveMods([regular, harmony, core, zeta, alpha]);
  assert.equal(misplaced.invalidModIds.has(harmony.id), true);
  assert.match((misplaced.issuesByModId.get(harmony.id) ?? [])[0]?.message ?? "", /bootstrap/);

  const valid = validateActiveMods([harmony, core, zeta, alpha]);
  assert.equal(
    valid.invalidModIds.size,
    0,
    "alphabetically reversed unconstrained peers stay valid",
  );
});

void test("unique invalid counts survive multiple findings, duplicates and cycles without mutation", () => {
  const multi = mod("author.multi", {
    gameVersions: ["1.5"],
    dependencies: [{ packageId: "author.absent" }],
  });
  const before = structuredClone(multi);
  const multiple = validateActiveMods([multi], "1.6");
  assert.deepEqual(codes(multiple, multi.id), ["incompatible-version", "missing-dependency"]);
  assert.equal(multiple.invalidModIds.size, 1);
  assert.deepEqual(multi, before);

  const first = mod("Author.Duplicate", { id: "first" });
  const second = mod("author.duplicate_steam", { id: "second" });
  const duplicate = validateActiveMods([first, second]);
  assert.deepEqual([...duplicate.invalidModIds].sort(), ["first", "second"]);
  assert.deepEqual(codes(duplicate, first.id), ["duplicate-package-id"]);

  const cycleA = mod("author.a", { loadAfter: [{ packageId: "author.b" }] });
  const cycleB = mod("author.b", { loadAfter: [{ packageId: "author.a" }] });
  const cycle = validateActiveMods([cycleA, cycleB]);
  assert.deepEqual([...cycle.invalidModIds].sort(), [cycleA.id, cycleB.id].sort());
  assert.deepEqual(codes(cycle, cycleA.id), ["load-order-cycle"]);
});

void test("duplicate package IDs do not suppress independent order diagnostics", () => {
  const duplicateA = mod("author.duplicate", { id: "duplicate-a" });
  const duplicateB = mod("AUTHOR.DUPLICATE_steam", { id: "duplicate-b" });
  const base = mod("author.base");
  const subject = mod("author.subject", {
    loadAfter: [{ packageId: base.packageId ?? "" }],
  });
  const harmony = mod("brrainz.harmony", { name: "Harmony" });

  const result = validateActiveMods([duplicateA, duplicateB, subject, base, harmony]);

  assert.deepEqual(codes(result, duplicateA.id), ["duplicate-package-id"]);
  assert.deepEqual(codes(result, duplicateB.id), ["duplicate-package-id"]);
  assert.deepEqual(codes(result, subject.id), ["load-order"]);
  assert.deepEqual(codes(result, harmony.id), ["load-order"]);
});

void test("duplicate bootstrap rows do not create false order errors on other bootstrap mods", () => {
  const harmonyA = mod("brrainz.harmony", { id: "harmony-a", name: "Harmony A" });
  const harmonyB = mod("BRRAINZ.HARMONY_steam", { id: "harmony-b", name: "Harmony B" });
  const core = mod("ludeon.rimworld", { name: "Core" });

  const result = validateActiveMods([harmonyA, harmonyB, core]);

  assert.deepEqual(codes(result, harmonyA.id), ["duplicate-package-id"]);
  assert.deepEqual(codes(result, harmonyB.id), ["duplicate-package-id"]);
  assert.equal(result.invalidModIds.has(core.id), false);
});

void test("all disconnected cycles coexist with independent order and bootstrap diagnostics", () => {
  const cycleA = mod("author.a", { loadAfter: [{ packageId: "author.b" }] });
  const cycleB = mod("author.b", { loadAfter: [{ packageId: "author.a" }] });
  const cycleC = mod("author.c", { loadAfter: [{ packageId: "author.d" }] });
  const cycleD = mod("author.d", { loadAfter: [{ packageId: "author.c" }] });
  const downstream = mod("author.downstream", {
    loadAfter: [{ packageId: "author.a" }],
  });
  const base = mod("author.base");
  const subject = mod("author.subject", {
    loadAfter: [{ packageId: base.packageId ?? "" }],
  });
  const harmony = mod("brrainz.harmony", { name: "Harmony" });

  const result = validateActiveMods([
    cycleA,
    cycleB,
    cycleC,
    cycleD,
    downstream,
    subject,
    base,
    harmony,
  ]);

  for (const cyclic of [cycleA, cycleB, cycleC, cycleD]) {
    assert.deepEqual(codes(result, cyclic.id), ["load-order-cycle"]);
  }
  assert.equal(result.invalidModIds.has(downstream.id), false, "a cycle descendant is not cyclic");
  assert.deepEqual(codes(result, subject.id), ["load-order"]);
  assert.deepEqual(codes(result, harmony.id), ["load-order"]);
});
