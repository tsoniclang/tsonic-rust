import assert from "node:assert/strict";
import { test } from "node:test";

import {
  artifactText,
  compileRust,
} from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";
import {
  collectTargetSourcePackageGraph,
} from "../../../../tsonic/packages/host/dist/source-package-inputs.js";

const authoredDeadCode =
  '#[allow(dead_code, reason = "retains an unused authored declaration")]';
const authoredUnreadField =
  '#[allow(dead_code, reason = "retains an unread authored field")]';
const authoredUnusedVariant =
  '#[allow(dead_code, reason = "retains an unused authored variant")]';
const generatedUnconstructedInstance =
  '#[expect(dead_code, reason = "retains an unconstructed generated instance")]';
const generatedRetainedConstructor =
  '#[allow(dead_code, reason = "retains an unused generated constructor")]';
const generatedUnconstructedShape =
  '#[expect(dead_code, reason = "retains an unconstructed checked source shape")]';
const generatedUnusedStorage =
  '#[expect(dead_code, reason = "retains unused generated storage")]';
const nonUpperCaseGlobal =
  '#[allow(non_upper_case_globals, reason = "preserves the authored source name")]';

test("authored function liveness follows exact cross-file and transitive source references", {
  timeout: 300_000,
}, () => {
  const { result } = compileRust({
    target: { id: "rust", options: { outputType: "bin", crateName: "authored_function_liveness" } },
    files: {
      "helpers.ts": `
import type { int32 } from "@tsonic/core/types.js";

export function usedLeaf(value: int32): int32 { return value + 1; }
export function unusedLeaf(value: int32): int32 { return value + 2; }
export function unusedOuter(value: int32): int32 { return unusedLeaf(value); }
`,
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
import { usedLeaf } from "./helpers.js";

function usedMiddle(value: int32): int32 { return usedLeaf(value); }
function callbackTarget(value: int32): int32 { return value + 3; }
function invoke(callback: (value: int32) => int32): int32 { return callback(1); }
function usedRecursive(value: int32): int32 {
  return value <= 0 ? 0 : usedRecursive(value - 1) + 1;
}
function usedOverload(value: int32): int32;
function usedOverload(value: int32): int32 { return value + 4; }
function unusedOverload(value: int32): int32;
function unusedOverload(value: int32): int32 { return value + 5; }
const usedArrow = (value: int32): int32 => value + 6;
const unusedArrow = (value: int32): int32 => value + 7;
function deadCycleA(value: int32): int32 {
  return value <= 0 ? 0 : deadCycleB(value - 1);
}
function deadCycleB(value: int32): int32 {
  return value <= 0 ? 0 : deadCycleA(value - 1);
}

export function main(): void {
  if (usedMiddle(1) !== 2 || invoke(callbackTarget) !== 4 ||
      usedRecursive(2) !== 2 || usedOverload(1) !== 5 || usedArrow(1) !== 7) {
    throw new Error("function liveness mismatch");
  }
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const helpers = artifactText(result, "src/helpers.rs");
  const index = artifactText(result, "src/index.rs");
  assert.equal(itemHasAttribute(helpers, "fn used_leaf("), false);
  assert.equal(itemHasAttribute(helpers, "fn unused_leaf("), false);
  assert.equal(itemHasAttribute(helpers, "fn unused_outer("), true);
  assert.equal(itemHasAttribute(index, "fn used_middle("), false);
  assert.equal(itemHasAttribute(index, "fn callback_target("), false);
  assert.equal(itemHasAttribute(index, "fn invoke("), false);
  assert.equal(itemHasAttribute(index, "fn used_recursive("), false);
  assert.equal(itemHasAttribute(index, "fn used_overload("), false);
  assert.equal(itemHasAttribute(index, "fn unused_overload("), true);
  assert.equal(itemHasAttribute(index, "fn used_arrow("), false);
  assert.equal(itemHasAttribute(index, "fn unused_arrow("), true);
  assert.equal(itemHasAttribute(index, "fn dead_cycle_a("), true);
  assert.equal(itemHasAttribute(index, "fn dead_cycle_b("), false);
  assert.equal(itemHasAttribute(index, "fn main("), false);
  validateGeneratedProject("authored-function-liveness", result.artifacts, { run: true });
});

test("authored class liveness distinguishes used declarations, unread fields, and dead members", {
  timeout: 300_000,
}, () => {
  const { result } = compileRust({
    target: { id: "rust", options: { outputType: "bin", crateName: "authored_class_liveness" } },
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

class UsedBox {
  readValue: int32;
  writeOnlyValue: int32;

  constructor(value: int32) {
    this.readValue = value;
    this.writeOnlyValue = value;
  }

  usedMethod(): int32 { return this.readValue; }
  unusedMethod(): int32 { return this.readValue + 1; }
}

class UnusedBox {
  value: int32;

  constructor(value: int32) { this.value = value; }
  read(): int32 { return this.value; }
}

export function main(): void {
  const box = new UsedBox(41);
  box.writeOnlyValue = 7;
  if (box.usedMethod() !== 41) throw new Error("class liveness mismatch");
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.equal(itemHasAttribute(source, "struct UsedBox "), false);
  assert.equal(itemHasAttribute(source, "read_value:"), false);
  assert.equal(itemHasAttribute(source, "write_only_value:", authoredUnreadField), true);
  assert.equal(itemHasAttribute(source, "fn used_method("), false);
  assert.equal(itemHasAttribute(source, "fn unused_method("), true);
  assert.equal(itemHasAttribute(source, "struct UnusedBox "), false);
  assert.equal(
    itemHasAttribute(source, "struct UnusedBox ", generatedUnconstructedInstance),
    false,
  );
  assert.equal(itemAttributeCount(source, "fn new(", authoredDeadCode), 1);
  assert.equal(itemHasAttribute(source, "fn read("), true);
  validateGeneratedProject("authored-class-liveness", result.artifacts, { run: true });
});

test("module initialization and public facades are exact liveness roots", {
  timeout: 300_000,
}, () => {
  const { result } = compileRust({
    target: { id: "rust", options: { outputType: "bin", crateName: "authored_root_liveness" } },
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

function initializedDependency(): int32 { return 42; }
function unusedDependency(): int32 { return 41; }
const initializedValue: int32 = initializedDependency();
const unusedNativeConstant: int32 = 7;

export function publicEntry(): int32 { return initializedValue; }
export function unusedPublicEntry(): int32 { return 0; }
export function main(): void {
  if (publicEntry() !== 42) throw new Error("module root mismatch");
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.equal(itemHasAttribute(source, "fn initialized_dependency("), false);
  assert.equal(itemHasAttribute(source, "fn unused_dependency("), true);
  assert.equal(itemHasAttribute(source, "const UNUSED_NATIVE_CONSTANT:"), true);
  assert.equal(itemHasAttribute(source, "fn public_entry("), false);
  assert.equal(itemHasAttribute(source, "fn unused_public_entry("), false);
  validateGeneratedProject("authored-root-liveness", result.artifacts, { run: true });
});

test("generated binary entry and public implementation ABI are exact liveness roots", {
  timeout: 300_000,
}, () => {
  const binaryFiles = {
    "index.ts": `
export function main(): void {}
`,
  };
  const { result: binaryResult } = compileRust({
    target: { id: "rust", options: { outputType: "bin", crateName: "binary_entry_liveness" } },
    files: binaryFiles,
    sourcePackages: sourcePackageGraphWithoutFacades(binaryFiles),
  });
  assert.deepEqual(binaryResult.diagnostics, []);
  const binarySource = artifactText(binaryResult, "src/index.rs");
  assert.equal(itemHasAttribute(binarySource, "fn main("), false);
  validateGeneratedProject("binary-entry-liveness", binaryResult.artifacts, { run: true });

  const libraryFiles = {
    "index.ts": `
export function exportedButUnused(): void {}
function implementationOnly(): void {}
export enum PublicChoice { First, Second }
`,
  };
  const { result: libraryResult } = compileRust({
    target: { id: "rust", options: { outputType: "lib", crateName: "implementation_abi_liveness" } },
    files: libraryFiles,
    sourcePackages: sourcePackageGraphWithoutFacades(libraryFiles),
  });
  assert.deepEqual(libraryResult.diagnostics, []);
  const librarySource = artifactText(libraryResult, "src/index.rs");
  assert.equal(itemHasAttribute(librarySource, "fn exported_but_unused("), false);
  assert.equal(itemHasAttribute(librarySource, "fn implementation_only("), false);
  const publicChoice = rustBracedItem(librarySource, "enum PublicChoice");
  assert.equal(itemHasAttribute(publicChoice, "First ="), false);
  assert.equal(itemHasAttribute(publicChoice, "Second ="), false);
  validateGeneratedProject("implementation-abi-liveness", libraryResult.artifacts);
});

test("authored nominal and runtime type declarations retain exact type-only liveness", {
  timeout: 300_000,
}, () => {
  const { result } = compileRust({
    target: { id: "rust", options: { outputType: "bin", crateName: "authored_type_liveness" } },
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

interface UsedModel { value: int32; }
interface UnusedModel { value: int32; }
type UsedSelection = "first" | "second";
type UnusedSelection = "left" | "right";
enum UsedChoice { First, Second }
enum UnusedChoice { First, Second }
enum UsedAlias { First = 1, AlsoFirst = 1 }

function readModel(model: UsedModel): int32 { return model.value; }
function select(value: UsedSelection): int32 { return value === "first" ? 1 : 2; }
function choose(value: UsedChoice): int32 { return value === UsedChoice.First ? 3 : 4; }
function chooseAlias(value: UsedAlias): int32 { return value === UsedAlias.First ? 5 : 6; }

export function main(): void {
  const model: UsedModel = { value: 35 };
  if (readModel(model) + select("first") + choose(UsedChoice.First) +
      chooseAlias(UsedAlias.First) !== 44) {
    throw new Error("type liveness mismatch");
  }
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.equal(itemHasAttribute(source, "struct UsedModelState"), false);
  assert.equal(itemHasAttribute(source, "struct UsedModel "), false);
  assert.equal(itemHasAttribute(source, "struct UnusedModelState"), false);
  const unusedModelState = rustBracedItem(source, "struct UnusedModelState");
  assert.equal(itemHasAttribute(unusedModelState, "value:", authoredUnreadField), true);
  assert.equal(itemHasAttribute(source, "struct UnusedModel "), true);
  assert.equal(itemHasAttribute(source, "enum UsedSelection"), false);
  assert.equal(itemHasAttribute(source, "enum UnusedSelection"), true);
  assert.equal(itemHasAttribute(source, "enum UsedChoice"), false);
  assert.equal(itemHasAttribute(source, "enum UnusedChoice"), true);
  const usedChoice = rustBracedItem(source, "enum UsedChoice");
  assert.equal(itemHasAttribute(usedChoice, "First ="), false);
  assert.equal(itemHasAttribute(usedChoice, "Second =", authoredUnusedVariant), true);
  const usedAlias = rustBracedItem(source, "impl UsedAlias");
  assert.equal(itemHasAttribute(usedAlias, "const First:"), false);
  assert.equal(itemHasAttribute(usedAlias, "const First:", nonUpperCaseGlobal), true);
  assert.equal(itemHasAttribute(usedAlias, "const AlsoFirst:", authoredUnusedVariant), true);
  assert.equal(itemHasAttribute(usedAlias, "const AlsoFirst:", nonUpperCaseGlobal), true);
  validateGeneratedProject("authored-type-liveness", result.artifacts, { run: true });
});

test("generated structural fields carry only exact read and accessor obligations", {
  timeout: 300_000,
}, () => {
  const { result } = compileRust({
    target: { id: "rust", options: { outputType: "bin", crateName: "structural_field_liveness" } },
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

function storedFields(): int32 {
  const value = { readValue: 40 as int32, writeOnlyValue: 1 as int32 };
  value.writeOnlyValue = 2;
  return value.readValue;
}

function accessorFields(): int32 {
  let backing = 1 as int32;
  const value = {
    get selected(): int32 { return backing; },
    set selected(next: int32) { backing = next; },
  };
  value.selected = 2;
  return value.selected;
}

export function main(): void {
  if (storedFields() + accessorFields() !== 42) {
    throw new Error("structural field liveness mismatch");
  }
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const shapes = artifactText(result, "src/shapes.rs");
  assert.equal(itemHasAttribute(shapes, "read_value:", authoredUnreadField), false);
  assert.equal(itemHasAttribute(shapes, "write_only_value:", authoredUnreadField), true);
  assert.equal(itemHasAttribute(shapes, "selected:", authoredUnreadField), false);
  assert.equal(itemHasAttribute(shapes, "get_selected:", authoredUnreadField), false);
  assert.equal(itemHasAttribute(shapes, "set_selected:", authoredUnreadField), false);
  validateGeneratedProject("structural-field-liveness", result.artifacts, { run: true });
});

test("generated class instances distinguish static-only use from exact construction", {
  timeout: 300_000,
}, () => {
  const { result } = compileRust({
    target: { id: "rust", options: { outputType: "bin", crateName: "generated_instance_liveness" } },
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

class StaticOnly {
  static current: int32 = 42;
  value: int32;
  constructor(value: int32) { this.value = value; }
}

class ImplicitStaticOnly {
  static current: int32 = 1;
}

class Constructed {
  value: int32;
  constructor(value: int32) { this.value = value; }
  read(): int32 { return this.value; }
}

export function main(): void {
  if (ImplicitStaticOnly.current !== 1) {
    throw new Error("implicit static liveness mismatch");
  }
  const value = new Constructed(StaticOnly.current);
  if (value.read() !== 42) throw new Error("generated instance liveness mismatch");
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.equal(
    itemHasAttribute(source, "struct StaticOnlyState", generatedUnconstructedInstance),
    false,
  );
  assert.equal(
    itemHasAttribute(source, "struct StaticOnly ", generatedUnconstructedInstance),
    false,
  );
  assert.equal(itemHasAttribute(source, "value:", authoredUnreadField), true);
  const staticOnlyImplementation = rustBracedItem(source, "impl StaticOnly");
  assert.equal(
    itemHasAttribute(staticOnlyImplementation, "fn new(", authoredDeadCode),
    true,
  );
  assert.equal(
    itemHasAttribute(source, "struct ImplicitStaticOnly ", generatedUnconstructedInstance),
    false,
  );
  const implicitImplementation = rustBracedItem(source, "impl ImplicitStaticOnly");
  assert.equal(
    itemHasAttribute(implicitImplementation, "fn new(", generatedRetainedConstructor),
    true,
  );
  assert.equal(source.includes("struct ConstructedState"), false);
  assert.equal(
    itemHasAttribute(source, "struct Constructed ", generatedUnconstructedInstance),
    false,
  );
  const constructedImplementation = rustBracedItem(source, "impl Constructed");
  assert.equal(
    itemHasAttribute(constructedImplementation, "fn new(", generatedUnconstructedInstance),
    false,
  );
  validateGeneratedProject("generated-instance-liveness", result.artifacts, { run: true });
});

test("generated object roots and structural shapes suppress only exact unused storage", {
  timeout: 300_000,
}, () => {
  const { result } = compileRust({
    target: { id: "rust", options: { outputType: "bin", crateName: "generated_storage_liveness" } },
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

interface Reader { read(): int32; }

function acceptTypeOnly(value: { current: () => int32 }): int32 {
  return 0;
}

export function main(): void {
  const reader: Reader = { read(): int32 { return 42; } };
  if (reader.read() !== 42) throw new Error("generated storage liveness mismatch");
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  const shapes = artifactText(result, "src/shapes.rs");
  const root = rustBracedItem(source, "struct ReaderObjectLiteralRoot");
  assert.equal(itemHasAttribute(root, "state:", generatedUnusedStorage), true);
  assert.equal(
    itemHasAttribute(shapes, "struct CurrentShape", generatedUnconstructedShape) ||
      shapes.includes(generatedUnconstructedShape),
    true,
  );
  assert.doesNotMatch(`${source}\n${shapes}`, /preserves the checked source contract/u);
  validateGeneratedProject("generated-storage-liveness", result.artifacts, { run: true });
});

function itemHasAttribute(source, itemFragment, attribute = authoredDeadCode) {
  const lines = source.split("\n");
  const itemLine = lines.findIndex((line) => line.includes(itemFragment));
  assert.notEqual(itemLine, -1, `Missing generated Rust item containing '${itemFragment}'.`);
  for (let index = itemLine - 1; index >= 0; index -= 1) {
    const line = lines[index].trim();
    if (!line.startsWith("#[")) break;
    if (line === attribute) return true;
  }
  return false;
}

function itemAttributeCount(source, itemFragment, attribute) {
  const lines = source.split("\n");
  let count = 0;
  for (let itemLine = 0; itemLine < lines.length; itemLine += 1) {
    if (!lines[itemLine].includes(itemFragment)) continue;
    for (let index = itemLine - 1; index >= 0; index -= 1) {
      const line = lines[index].trim();
      if (!line.startsWith("#[")) break;
      if (line === attribute) count += 1;
    }
  }
  return count;
}

function rustBracedItem(source, itemFragment) {
  const start = source.indexOf(itemFragment);
  assert.notEqual(start, -1, `Missing generated Rust item containing '${itemFragment}'.`);
  const open = source.indexOf("{", start);
  assert.notEqual(open, -1, `Generated Rust item '${itemFragment}' has no body.`);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  assert.fail(`Generated Rust item '${itemFragment}' has an unterminated body.`);
}

function sourcePackageGraphWithoutFacades(files) {
  const projectFiles = new Map(
    Object.entries(files).map(([name, text]) => [`/src/${name}`, text]),
  );
  return collectTargetSourcePackageGraph("/src", "/src", projectFiles);
}
