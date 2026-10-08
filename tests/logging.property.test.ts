import assert from "node:assert/strict";
import { test } from "node:test";

import fc from "fast-check";

import { sanitizeLogData } from "../src/main/logging";
import { assertUnchanged, extensionArbitrary, propertyOptions } from "./helpers/properties";

void test("property: nested diagnostics redact sensitive fields and home prefixes without mutating data", () => {
  fc.assert(
    fc.property(
      fc.uuid(),
      fc.constantFrom(
        "password",
        "api_key",
        "access-token",
        "notes",
        "summary",
        "steamId",
        "accountId",
        "vault",
        "environment",
      ),
      (identity, key) => {
        const secret = `private-${identity}`;
        const home = `/virtual/home/${identity}`;
        const input = { event: "test", nested: [{ [key]: secret, path: `${home}/mods/file` }] };
        assertUnchanged(input, () => {
          const serialized = JSON.stringify(sanitizeLogData(input, home));
          assert.ok(!serialized.includes(secret));
          assert.ok(!serialized.includes(home));
          assert.ok(serialized.includes("[REDACTED]"));
          assert.ok(serialized.includes("~/mods/file"));
        });
      },
    ),
    propertyOptions,
  );
});

void test("property: arbitrary JSON diagnostics sanitize into serializable output", () => {
  fc.assert(
    fc.property(extensionArbitrary, (value) => {
      assertUnchanged(value, () => {
        const serialized = JSON.stringify(sanitizeLogData(value, "/virtual/home"));
        assert.equal(typeof serialized, "string");
        assert.doesNotThrow(() => {
          const parsed: unknown = JSON.parse(serialized);
          assert.notEqual(parsed, undefined);
        });
      });
    }),
    propertyOptions,
  );
});
