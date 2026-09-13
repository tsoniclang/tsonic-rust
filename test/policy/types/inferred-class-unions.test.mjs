import assert from "node:assert/strict";
import test from "node:test";
import { acmeTestingPackage, artifactText, compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { rustSourceTypeCarrier, rustSourceUnionTargetType, rustSourceUnionCarrierValue } from "../../../dist/target-model/types/index.js";
import { createRustGeneratedUnionPlan } from "../../../dist/analysis/objects/generated-union-plan.js";
import { createRustSourceTypeRegistry } from "../../../dist/analysis/project-types/source-type-registry.js";

test("generated union definitions require complete exact payload identities and deterministic ownership", () => {
  const payloads = ["First", "Second", "Third"].map(name => rustSourceTypeCarrier("/src/backing.ts", name, "object"));
  const make = (members, fileName = "/src/backing.ts") => rustSourceUnionTargetType(fileName, `Union${members.length}`,
    members.map((carrier, index) => ({ name: `Variant${index}`, carrier })), members.map(type => ({ kind: "type", type })), "generated");
  const carrier = make(payloads);
  assert.equal(rustSourceUnionCarrierValue(carrier)?.origin, "generated");
  const absent = { ...carrier.value };
  delete absent.origin;
  const changes = [absent, { ...carrier.value, origin: "other" }, { ...carrier.value, typeName: "Union2" },
    { ...carrier.value, genericArguments: carrier.value.genericArguments.slice(1) },
    { ...carrier.value, genericArguments: carrier.value.genericArguments.toReversed() },
    { ...carrier.value, variants: carrier.value.variants.map(variant => ({ ...variant, name: "Variant0" })) },
    { ...carrier.value, variants: carrier.value.variants.map(variant => ({ ...variant, unexpected: true })) }];
  for (const value of changes) assert.equal(rustSourceUnionCarrierValue({ ...carrier, value }), undefined);
  const record = value => ({ sourceType: {}, carrier: value,
    variants: value.value.variants.map(variant => ({ ...variant, sourceType: {} })), selectedProperties: [] });
  const first = record(carrier);
  const second = record(make(payloads.slice(0, 2), "/src/other.ts"));
  const third = record(make(payloads.slice(1), "/src/another.ts"));
  const create = records => createRustGeneratedUnionPlan(records, () => "root", new Map([["root", new Set(["Union2"])]]));
  const plan = create([first, second, third]);
  assert.deepEqual(plan.unionDefinitions, create([third, first, second]).unionDefinitions);
  assert.equal(plan.unionDefinitions.length, 2);
  assert.notEqual(plan.unionForCarrier(second.carrier).targetName, "Union2");
  assert.equal(plan.unionForCarrier(second.carrier), plan.unionForCarrier(third.carrier));
  assert.equal(plan.unionForCarrier(make(payloads.toReversed())), undefined);
  assert.ok(Object.isFrozen(plan.unionDefinitions));
  assert.ok(Object.isFrozen(plan.unionForCarrier(carrier).sourceCarriers));
  assert.throws(() => create([{ ...first, declaration: {} }]), /exact inferred union/u);
  const registry = createRustSourceTypeRegistry();
  assert.equal(registry.registerSourceUnion({ ...first, declaration: {} }), false);
  assert.equal(registry.registerSourceUnion(first), true);
  assert.equal(registry.registerSourceUnion({ ...first, variants: first.variants.slice(1) }), false);
  assert.deepEqual(registry.generatedSourceUnions().map(union => union.carrier), [carrier]);
});

test("private generated class unions retain exact constructed and callable liveness", () => {
  const { result } = compileRust({ surfaces: ["js"], packages: [acmeTestingPackage()], files: {
    "index.ts": `
      import { check } from "@acme/testing";
      class First { read(): number { return 1; } }
      class Second { extra: boolean = true; read(): number { return 2; } }
      function read(value: First | Second): number { return value.read(); }
      export function main(): void { check(read(new First()) === 1 && read(new Second()) === 2); }
    `,
  } });
  assert.deepEqual(result.diagnostics, []);
  assert.match(artifactText(result, "src/shapes.rs"), /enum Union2/u);
  assert.doesNotMatch(artifactText(result, "src/shapes.rs"), /allow\(dead_code/u);
  assert.doesNotMatch(artifactText(result, "src/index.rs"), /retains an unused authored declaration/u);
});

test("three-arm generic class unions preserve nullable pointer results, errors and evaluation order", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    surfaces: ["js"], packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "generic_class_union" } },
    files: {
      "backing.ts": `
import type { Pointer, uint8 } from "@tsonic/core/types.js";
import { loadPointer } from "@tsonic/core/lang.js";
export class OptionalBacking {
  value: Pointer<uint8>;
  constructor(value: Pointer<uint8>) { this.value = value; }
  read(absent: boolean): Pointer<uint8> | undefined {
    if (absent) return undefined;
    return this.value;
  }
}
export class RequiredBacking {
  value: Pointer<uint8>;
  extra: boolean = true;
  constructor(value: Pointer<uint8>) { this.value = value; }
  read(fail: boolean): Pointer<uint8> {
    if (fail) throw new Error("selected branch");
    return this.value;
  }
}
export class GenericBacking<T> {
  value: T;
  constructor(value: T) { this.value = value; }
  read(fail: boolean): T {
    if (fail) throw new Error("generic branch");
    return this.value;
  }
}
export type Backing = RequiredBacking | GenericBacking<Pointer<uint8>> | OptionalBacking;
export function read(backing: Backing, fail: boolean): uint8 {
  const pointer = backing.read(fail);
  if (pointer === undefined) return 0;
  return loadPointer(pointer);
}
export class Calls {
  order: string = "";
  source(value: Backing): Backing { this.order += "receiver"; return value; }
  argument(): boolean { this.order += "argument"; return false; }
}
export function evaluate(calls: Calls, value: Backing): uint8 {
  const pointer = calls.source(value).read(calls.argument());
  if (pointer === undefined) return 0;
  return loadPointer(pointer);
}
`,
      "index.ts": `
import { check } from "@acme/testing";

import type { Pointer, uint8 } from "@tsonic/core/types.js";
import { allocatePointer, storePointer } from "@tsonic/core/lang.js";
import { OptionalBacking, RequiredBacking, GenericBacking, Calls, evaluate, read } from "./backing.js";

function run(): boolean {
  const byte: uint8 = 29;
  const pointer = allocatePointer<uint8>(byte);
  const first = new OptionalBacking(pointer);
  const second = new RequiredBacking(pointer);
  const third = new GenericBacking<Pointer<uint8>>(pointer);
  const initial = read(first, false) === 29 && read(second, false) === 29 && read(third, false) === 29 && read(first, true) === 0;
  storePointer(pointer, 31);
  const retained = read(first, false) === 31 && read(second, false) === 31 && read(third, false) === 31;
  let caught = false;
  try { read(second, true); } catch { caught = true; }
  const calls = new Calls();
  const ordered = evaluate(calls, third) === 31 && calls.order === "receiverargument";
  return initial && retained && caught && ordered;
}
export function main(): void { check(run()); }
`,
    },
  });
  assert.deepEqual(result.diagnostics, []);
  const native = validateGeneratedProject("generic-class-union", result.artifacts, { run: true });
  assert.equal(native.status, 0, JSON.stringify(native));
});


test("inferred class unions preserve cross-file payload identity and method dispatch", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    surfaces: ["js"], packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "inferred_class_union" } },
    files: {
      "backing.ts": `
export class TextBacking {
  value: string;
  constructor(value: string) { this.value = value; }
  read(): string { return this.value; }
  change(value: string): void { this.value = value; }
}
export class OtherBacking {
  value: string;
  extra: boolean = true;
  constructor(value: string) { this.value = value; }
  read(): string { return this.value; }
  change(value: string): void { this.value = value; }
}
export class Wrapper {
  backing: TextBacking | OtherBacking;
  constructor(backing: TextBacking | OtherBacking) { this.backing = backing; }
  read(): string { return this.backing.read(); }
  change(value: string): void { this.backing.change(value); }
}
export function retain(backing: OtherBacking | TextBacking): TextBacking | OtherBacking { return backing; }
`,
      "index.ts": `
import { check } from "@acme/testing";
import { TextBacking, OtherBacking, Wrapper, retain } from "./backing.js";
export function main(): void {
  const first = new TextBacking("first");
  const second = new OtherBacking("second");
  const left = new Wrapper(retain(first));
  const right = new Wrapper(retain(second));
  check(left.read() === "first");
  check(right.read() === "second");
  left.change("changed");
  check(left.read() === "changed");
  check(first.read() === "changed");
  check(second.read() === "second");
}
`,
    },
  });
  assert.deepEqual(result.diagnostics, []);
  assert.match(artifactText(result, "src/shapes.rs"), /pub enum Union2<Payload0, Payload1>/u);
  assert.match(artifactText(result, "src/backing.rs"), /match &union_receiver/u);
  assert.doesNotMatch(artifactText(result, "src/backing.rs"), /#\[allow\(dead_code, reason = "retains an unused authored declaration"\)\]\s+pub fn change/u);
  const native = validateGeneratedProject("inferred-class-union", result.artifacts, { run: true });
  assert.equal(native.status, 0, JSON.stringify(native));
});
