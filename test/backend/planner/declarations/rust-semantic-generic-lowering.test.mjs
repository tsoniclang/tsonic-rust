import assert from "node:assert/strict";
import { test } from "node:test";

import { rustAstGenericsFromSemanticInContext } from "../../../../dist/backend/planner/types/render.js";
import { printRustSourceFile } from "../../../../dist/print/source/index.js";

const ownerIdentity = Object.freeze({
  kind: "project",
  packageId: "fixture",
  sourceFileId: "src/index.ts",
  declarationId: "T",
});
const traitIdentity = Object.freeze({
  kind: "provider",
  providerId: "rust",
  compilationSnapshotId: "fixture",
  itemId: "core::iter::Iterator",
});
const itemIdentity = Object.freeze({
  kind: "provider",
  providerId: "rust",
  compilationSnapshotId: "fixture",
  itemId: "core::iter::Iterator::Item",
});

function renderingContext() {
  return {
    moduleName: "proof",
    moduleNameByFileName: new Map(),
    externalCrateNameByFileName: new Map(),
    externalItemPathByIdentity: new Map(),
    externalStructuralShapeModuleByFileName: new Map(),
    structuralShapesModuleName: "shapes",
    usedAliases: new Set(),
    input: { program: { names: {}, structuralShapes: {} } },
  };
}

function iteratorTrait(associatedConstraints = []) {
  return Object.freeze({
    identity: traitIdentity,
    displayPath: Object.freeze(["core", "iter", "Iterator"]),
    arguments: Object.freeze([]),
    associatedConstraints: Object.freeze(associatedConstraints),
  });
}

function itemProjection(trait) {
  return Object.freeze({
    kind: "associated-type",
    owner: Object.freeze({
      kind: "type-parameter",
      identity: ownerIdentity,
      displayName: "T",
    }),
    trait,
    item: itemIdentity,
    displayName: "Item",
    arguments: Object.freeze([]),
  });
}

function semanticGenerics(trait) {
  return Object.freeze({
    parameters: Object.freeze([Object.freeze({
      kind: "type",
      identity: ownerIdentity,
      displayName: "T",
      bounds: Object.freeze([]),
    })]),
    wherePredicates: Object.freeze([Object.freeze({
      kind: "equality",
      projection: itemProjection(trait),
      value: Object.freeze({ kind: "primitive", name: "i32" }),
    })]),
  });
}

test("associated-type equality lowers to one legal trait constraint", () => {
  const generics = rustAstGenericsFromSemanticInContext(
    semanticGenerics(iteratorTrait()),
    renderingContext(),
  );
  assert.notEqual(generics, undefined);
  const source = printRustSourceFile({
    headerComment: "proof",
    items: [{
      kind: "function",
      name: "next",
      visibility: "public",
      generics,
      params: [],
      body: { statements: [] },
    }],
  });

  assert.match(source, /where\n {4}T: core::iter::Iterator<Item = i32>,/u);
  assert.doesNotMatch(source, /<T as [^>]+>::Item\s*=/u);
});

test("an exact existing associated equality is idempotent", () => {
  const existing = Object.freeze({
    kind: "equality",
    item: itemIdentity,
    displayName: "Item",
    arguments: Object.freeze([]),
    type: Object.freeze({ kind: "primitive", name: "i32" }),
  });
  const generics = rustAstGenericsFromSemanticInContext(
    semanticGenerics(iteratorTrait([existing])),
    renderingContext(),
  );

  assert.notEqual(generics, undefined);
  const trait = generics.wherePredicates[0].bounds[0].trait;
  assert.equal(trait.genericArguments.filter((argument) =>
    argument.kind === "associated-equality" && argument.name === "Item").length, 1);
});

test("duplicate existing equalities fail closed instead of printing duplicate bindings", () => {
  const existing = Object.freeze({
    kind: "equality",
    item: itemIdentity,
    displayName: "Item",
    arguments: Object.freeze([]),
    type: Object.freeze({ kind: "primitive", name: "i32" }),
  });

  assert.equal(
    rustAstGenericsFromSemanticInContext(
      semanticGenerics(iteratorTrait([existing, existing])),
      renderingContext(),
    ),
    undefined,
  );
});

test("a contradictory associated equality fails closed before target AST publication", () => {
  const conflicting = Object.freeze({
    kind: "equality",
    item: itemIdentity,
    displayName: "Item",
    arguments: Object.freeze([]),
    type: Object.freeze({ kind: "primitive", name: "u32" }),
  });

  assert.equal(
    rustAstGenericsFromSemanticInContext(
      semanticGenerics(iteratorTrait([conflicting])),
      renderingContext(),
    ),
    undefined,
  );
});
