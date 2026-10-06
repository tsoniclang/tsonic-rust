import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRustReceiverStorage } from "../../../dist/analysis/project-types/receiver-storage.js";
import { createRustObjectRepresentationPlan } from "../../../dist/analysis/project-types/object-representation.js";

test("source receiver storage requires no physical carrier or representation decision", () => {
  const input = { ast: {}, navigation: {}, semantics: {}, sourceFiles: [],
    projectTypes: { definitions: [] } };
  for (const name of ["hasPromotedStorage", "hasMutableStorageUse", "valueWrites", "referenceDeclarations"]) {
    Object.defineProperty(input, name, { get() { throw new Error("physical representation read before ownership selection"); } });
  }
  const storage = analyzeRustReceiverStorage(input);
  assert.equal(Object.isFrozen(storage), true);
  assert.equal(Object.isFrozen(storage.aliases), true);
  assert.equal(storage.aliases.length, 0);
  assert.equal(storage.captures.issues.length, 0);
  assert.equal(storage.captures.fields.length, 0);
  assert.equal(Object.isFrozen(storage.publishedFieldWrites({})), true);
  assert.equal(storage.publishedFieldWrites({}).length, 0);
});

test("physical object analysis consumes the exact presealed receiver storage plan", () => {
  const declaration = {};
  const alias = { declaration };
  const aliases = Object.freeze([alias]);
  const captures = Object.freeze({ issues: [], fields: [] });
  const receiverStorage = Object.freeze({ aliases, captures,
    aliasFor: selected => selected === declaration ? alias : undefined,
    publishedFieldWrites: () => [],
  });
  const plan = createRustObjectRepresentationPlan({
    ast: {}, navigation: {}, semantics: {}, sourceFiles: [], projectTypes: { definitions: [] },
    receiverStorage, valueWrites: new Set(), hasPromotedStorage: () => false,
    hasMutableStorageUse: () => false,
  });
  assert.equal(plan.receiverCaptures === captures, true, "no second capture/readiness analysis");
  assert.equal(plan.aliases === aliases, true, "one canonical alias classification");
  assert.equal(plan.aliasFor(declaration) === alias, true);
  assert.equal(plan.aliasFor({}) === undefined, true);
  assert.equal(plan.representations.length, 0);
});
