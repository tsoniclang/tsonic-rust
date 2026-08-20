import assert from "node:assert/strict";
import { test } from "node:test";

import { selectJsSurfaceOperation } from "../../../dist/policy/operations/js-surface.js";
import {
  rustJsMapTargetType,
  rustJsSetTargetType,
  rustSourcePrimitiveTargetType,
  rustStringTargetType,
} from "../../../dist/policy/types/target-types.js";
import {
  acmeTestingPackage,
  artifactText,
  compileRust,
} from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

test("collection rows require exact carrier capabilities", () => {
  const int32 = rustSourcePrimitiveTargetType("int32");
  const string = rustStringTargetType();
  const map = rustJsMapTargetType(string, int32);
  const set = rustJsSetTargetType(int32);

  assert.deepEqual(selectJsSurfaceOperation({
    ownerName: "ReadonlyMap",
    memberName: "entries",
    operationKind: "call",
    receiverCarrier: map,
    argumentCarriers: [],
  })?.fact.resultCarrier, {
    kind: "array",
    element: { kind: "tuple", elements: [string, int32] },
  });
  assert.equal(selectJsSurfaceOperation({
    ownerName: "ReadonlySet",
    memberName: "values",
    operationKind: "call",
    receiverCarrier: set,
    argumentCarriers: [],
  })?.fact.operationId, "tsonic.rust.js.ReadonlySet.values.call");

  const unresolved = { kind: "type-parameter", name: "T" };
  assert.equal(selectJsSurfaceOperation({
    ownerName: "ReadonlyMap",
    memberName: "keys",
    operationKind: "call",
    receiverCarrier: rustJsMapTargetType(unresolved, int32),
    argumentCarriers: [],
  }), undefined);
  assert.equal(selectJsSurfaceOperation({
    ownerName: "ReadonlySet",
    memberName: "has",
    operationKind: "call",
    receiverCarrier: rustJsSetTargetType(unresolved),
    argumentCarriers: [unresolved],
  }), undefined);
});

test("generated Rust proves complete Map and Set collection operations", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    surfaces: ["js"],
    packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "js_collections" } },
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
import { check } from "@acme/testing";

function readonlyMapTotal(map: ReadonlyMap<string, int32>): int32 {
  let total: int32 = 0;
  for (const entry of map) {
    total += entry[0].length + entry[1];
  }
  return total;
}

function readonlySetTotal(set: ReadonlySet<int32>): int32 {
  let total: int32 = 0;
  for (const value of set) {
    total += value;
  }
  return total;
}

export function main(): void {
  const map = new Map<string, int32>();
  map.set("a", 1).set("bb", 2);
  check(map.size === 2 && map.has("a") && map.get("bb") !== undefined);
  let keyLength: int32 = 0;
  for (const key of map.keys()) {
    keyLength += key.length;
  }
  check(keyLength === 3);
  const storedKeys = map.keys();
  let storedKeyLength: int32 = 0;
  for (const key of storedKeys) {
    storedKeyLength += key.length;
  }
  check(storedKeyLength === 3);
  let valueTotal: int32 = 0;
  for (const value of map.values()) {
    valueTotal += value;
  }
  check(valueTotal === 3);
  let entryTotal: int32 = 0;
  for (const entry of map.entries()) {
    entryTotal += entry[0].length + entry[1];
  }
  check(entryTotal === 6);
  map.forEach(() => check(true));
  map.forEach((value) => check(value > 0));
  map.forEach((value, key) => check(value > 0 && (key.startsWith("a") || key.startsWith("b"))));
  map.forEach((value, key, owner) => check(value > 0 && owner.has(key)));
  check(readonlyMapTotal(map) === 6);
  let directMapTotal: int32 = 0;
  for (const entry of map) {
    directMapTotal += entry[1];
  }
  check(directMapTotal === 3);
  map.delete("a");
  map.clear();
  check(map.size === 0);

  const set = new Set<int32>();
  set.add(1).add(2).add(2);
  check(set.size === 2 && set.has(2));
  let setKeyTotal: int32 = 0;
  for (const key of set.keys()) {
    setKeyTotal += key;
  }
  check(setKeyTotal === 3);
  let setValueTotal: int32 = 0;
  for (const value of set.values()) {
    setValueTotal += value;
  }
  check(setValueTotal === 3);
  for (const entry of set.entries()) {
    check(entry[0] === entry[1]);
  }
  set.forEach(() => check(true));
  set.forEach((value) => check(value > 0));
  set.forEach((value, key) => check(value === key));
  set.forEach((value, key, owner) => check(value === key && owner.has(value)));
  check(readonlySetTotal(set) === 3);
  const other = new Set<int32>();
  other.add(2).add(3);
  check(set.union(other).size === 3);
  check(set.intersection(other).size === 1);
  check(set.difference(other).has(1));
  check(set.symmetricDifference(other).size === 2);
  check(set.isSubsetOf(set.union(other)));
  check(set.union(other).isSupersetOf(set));
  check(set.isDisjointFrom(new Set<int32>()));
  let directSetTotal: int32 = 0;
  for (const value of set) {
    directSetTotal += value;
  }
  check(directSetTotal === 3);
  set.delete(1);
  set.clear();
  check(set.size === 0);

  const constructed = new Set<string>(["a", "b", "b"]);
  check(constructed.size === 2 && constructed.has("a") && constructed.has("b"));
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /for entry in map\.entries\(\)/u);
  assert.match(source, /for value in set\.values\(\)/u);
  assert.match(source, /for key in map\.keys\(\)/u);
  assert.match(source, /for key in rt::iter_cloned\(&stored_keys\)/u);
  assert.match(source, /map\.for_each_zero\(\|\|/u);
  assert.match(source, /map\.for_each\(\|value, key, owner\|/u);
  assert.match(source, /set\.for_each_zero\(\|\|/u);
  assert.match(source, /set\.for_each\(\|value, key, owner\|/u);
  assert.equal(validateGeneratedProject("js-collections", result.artifacts, { run: true }).status, 0);
});

test("collection operations reconcile exact derived values to their selected project base carrier", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    surfaces: ["js"],
    packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "js_map_project_values" } },
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
import { check } from "@acme/testing";

class Item {
  value: int32;
  constructor(value: int32) { this.value = value; }

  label(): string { return "item"; }
}

class DetailedItem extends Item {
  label(): string { return "detailed"; }
}

export function main(): void {
  const values = new Map<string, Item>();
  values.set("selected", new DetailedItem(3));
  const selected = values.get("selected");
  check(selected !== undefined && selected.value === 3 && selected.label() === "detailed");

  let ordered: Item[] = [];
  ordered.push(new DetailedItem(4));
  check(ordered.length === 1 && ordered[0]!.value === 4 && ordered[0]!.label() === "detailed");
  ordered = [];
  check(ordered.length === 0);

  let integers: int32[] = [];
  check(integers.length === 0);
  integers = [0];
  check(integers.length === 1 && integers[0] === 0);
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /let values: js_abi::JsMap<String, Item> = js_abi::JsMap::new\(\);/u);
  assert.equal(validateGeneratedProject("js-map-project-values", result.artifacts, { run: true }).status, 0);
});

test("Map and Set use exact project identity for project object keys", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    surfaces: ["js"],
    packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "js_project_identity_collections" } },
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
import { check } from "@acme/testing";

class Key {
  value: int32;
  constructor(value: int32) { this.value = value; }
}

export function main(): void {
  const first = new Key(1);
  const sameValue = new Key(1);
  const map = new Map<Key, string>();
  map.set(first, "first");
  check(map.get(first) === "first" && map.get(sameValue) === undefined);
  check(map.has(first) && !map.has(sameValue));
  check(!map.delete(sameValue) && map.delete(first));

  const set = new Set<Key>();
  set.add(first).add(first).add(sameValue);
  check(set.size === 2 && set.has(first) && set.has(sameValue));
  check(set.delete(first) && !set.has(first));
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /map\.set_eq/u);
  assert.match(source, /map\.get_eq/u);
  assert.match(
    source,
    /set\s*\.add_eq\(first\.clone\(\)\)\s*\.add_eq\(first\.clone\(\)\)\s*\.add_eq_discard\(same_value\.clone\(\)\)/u,
  );
  assert.equal(validateGeneratedProject("js-project-identity-collections", result.artifacts, { run: true }).status, 0);
});

test("flow-selected string receivers lower from their exact optional storage carrier", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    surfaces: ["js"],
    packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "js_flow_selected_string" } },
    files: {
      "index.ts": `
import { check } from "@acme/testing";

function normalize(value: string | undefined): string {
  return value === undefined ? "missing" : value.trim().toLowerCase();
}

export function main(): void {
  check(normalize(undefined) === "missing");
  check(normalize("  Ready  ") === "ready");
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /match value\.as_ref\(\)/u);
  assert.equal(validateGeneratedProject("js-flow-selected-string", result.artifacts, { run: true }).status, 0);
});

test("Array sort comparator callbacks preserve source arity and stable JavaScript ordering", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    surfaces: ["js"],
    packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "js_array_comparator_sort" } },
    files: {
      "index.ts": `
import { check } from "@acme/testing";

export function main(): void {
  const values = ["bb", "a", "cc", "ddd"];
  values.sort((left, right) => left.length - right.length);
  check(values.join("|") === "a|bb|cc|ddd");

  const unary = [3, 2, 1];
  unary.sort((value) => value - 2);
  check(unary.length === 3);

  const zero = [2, 1];
  zero.sort(() => 0);
  check(zero[0] === 2 && zero[1] === 1);
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /values\s*\.try_sort\(/u);
  assert.doesNotMatch(source, /let operation_input_\d+ = \|left, right\|/u);
  assert.match(source, /unary\.sort_value\(/u);
  assert.match(source, /zero\.sort_zero\(/u);
  assert.equal(validateGeneratedProject("js-array-comparator-sort", result.artifacts, { run: true }).status, 0);
});

test("generated Rust preserves every declared Array callback argument", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    surfaces: ["js"],
    packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "js_array_callbacks" } },
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
import { check } from "@acme/testing";

export function main(): void {
  const values: int32[] = [2, 4, 6];
  let visits: int32 = 0;
  values.forEach(() => { visits += 1; });
  values.forEach((value) => { if (value > 0) visits += 1; });
  values.forEach((value, index) => { if (value > 0 && index >= 0) visits += 1; });
  values.forEach((value, index, array) => { if (value > 0 && index >= 0 && array.includes(value)) visits += 1; });

  const mapped = values.map<int32>((value, index, array) =>
    index >= 0 && array.includes(value) ? value : 0);
  const filtered = values.filter((value, index, array) => value > 2 && index > 0 && array.includes(value));
  const first = values.find((value, index, array) => value === 4 && index === 1 && array.includes(value));
  const index = values.findIndex((value, current, array) => value === 6 && current === 2 && array.includes(value));
  const total = values.reduce<int32>((sum, value, current, array) =>
    current >= 0 && array.includes(value) ? sum + value : sum, 0);
  const withoutInitial = values.reduce((sum, value, current, array) =>
    current > 0 && array.includes(value) ? sum + value : sum);

  check(visits === 12);
  check(mapped.length === 3);
  check(filtered.length === 2);
  check((first ?? 0) === 4);
  check(index === 2);
  check(total === 12);
  check(withoutInitial === 12);
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /values\.for_each_zero\(\{[\s\S]*move \|\|/u);
  assert.match(source, /values\.for_each\(\{[\s\S]*move \|value, index, array\|/u);
  assert.match(source, /values\.map_with_array\(\|value, index, array\|/u);
  assert.match(source, /values\.filter_with_array\(\|value, index, array\|/u);
  assert.match(source, /values\.reduce_with_array\(\s*0,\s*\|sum, value, current, array\|/u);
  assert.match(source, /values\s*\.reduce_from_first_with_array\(\|sum, value, current, array\|/u);
  assert.equal(validateGeneratedProject("js-array-callbacks", result.artifacts, { run: true }).status, 0);
});
