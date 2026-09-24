import assert from "node:assert/strict";
import test from "node:test";
import { acmeTestingPackage, compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { nullishMemberStorageSource } from "../../../../tsonic/test/fixtures/nullish-member-storage.mjs";
import { contextualClassArgumentsSource } from "../../../../tsonic/test/fixtures/contextual-class-arguments.mjs";
import { classUnionUpcastSource, anonymousClassUnionUpcastSource } from "../../../../tsonic/test/fixtures/class-union-upcasts.mjs";
import { optionalIndexedArgumentsSource } from "../../../../tsonic/test/fixtures/optional-indexed-arguments.mjs";

test("optional indexed arguments retain absence and single evaluation", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    surfaces: ["js"], packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "optional_indexed_arguments" } },
    files: { "index.ts": `import { check } from "@acme/testing";\n${optionalIndexedArgumentsSource}\nexport function main(): void { check(run()); }` },
  });
  assert.deepEqual(result.diagnostics, []);
  const native = validateGeneratedProject("optional-indexed-arguments", result.artifacts, { run: true });
  assert.equal(native.status, 0, native.stdout + native.stderr);
  const output = result.artifacts.filter(artifact => artifact.path.endsWith(".rs")).map(artifact => artifact.text).join("\n");
  assert.match(output, /position\.as_ref\(\)\?/);
  assert.match(output, /value\.as_ref\(\)\?/);
  assert.match(output, /observed\(value\)\.as_ref\(\)\?/);
  assert.doesNotMatch(output, /allow\(clippy::question_mark/);
});

for (const surfaces of [[], ["js"]]) {
  for (const [name, sourceText] of [["generic", classUnionUpcastSource], ["anonymous", anonymousClassUnionUpcastSource]]) {
    test(`class union upcasts preserve ${name} base identity (${surfaces[0] ?? "native"})`, { timeout: 300_000 }, () => {
      const { result } = compileRust({
        surfaces, packages: [acmeTestingPackage()],
        target: { id: "rust", options: { outputType: "bin", crateName: "class_union_upcasts" } },
        files: { "index.ts": `import { check } from "@acme/testing";\n${sourceText}\nexport function main(): void { check(run()); }` },
      });
      assert.deepEqual(result.diagnostics, []);
      const native = validateGeneratedProject(`class-union-upcasts-${surfaces[0] ?? "native"}`, result.artifacts, { run: true });
      assert.equal(native.status, 0, native.stdout + native.stderr);
      const output = result.artifacts.filter(artifact => artifact.path.endsWith(".rs")).map(artifact => artifact.text).join("\n");
      if (name === "anonymous") assert.match(output, /match &value/);
      assert.doesNotMatch(output, /match value\.clone\(\)/);
    });
  }
  if (surfaces[0] === "js") test("contextual class arguments preserve branch identity", { timeout: 300_000 }, () => {
    const { result } = compileRust({
      surfaces, packages: [acmeTestingPackage()],
      target: { id: "rust", options: { outputType: "bin", crateName: "contextual_class_arguments" } },
      files: { "index.ts": `import { check } from "@acme/testing";\n${contextualClassArgumentsSource}\nexport function main(): void { check(run()); }` },
    });
    assert.deepEqual(result.diagnostics, []);
    const native = validateGeneratedProject(`contextual-class-arguments-${surfaces[0] ?? "native"}`, result.artifacts, { run: true });
    assert.equal(native.status, 0, native.stdout + native.stderr);
  });
  test(`required nullish members retain exact storage (${surfaces[0] ?? "native"})`, { timeout: 300_000 }, () => {
    const { result } = compileRust({
      surfaces,
      packages: [acmeTestingPackage()],
      target: { id: "rust", options: { outputType: "bin", crateName: "nullish_member_storage" } },
      files: { "index.ts": `import { check } from "@acme/testing";\n${nullishMemberStorageSource}\nexport function main(): void { check(run()); }` },
    });
    assert.deepEqual(result.diagnostics, []);
    const source = result.artifacts.find(artifact => artifact.path === "src/index.rs").text;
    assert.match(source, /fn has_present_text\(text: &str\) -> bool \{\s*true\s*\}/u);
    assert.equal(validateGeneratedProject(`nullish-member-storage-${surfaces[0] ?? "native"}`, result.artifacts, { run: true }).status, 0);
  });
}

test("compiler property refinements and lazy byte storage preserve selected values", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    surfaces: ["js"], packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "property_refinements" } },
    files: { "index.ts": `
import { check } from "@acme/testing";
import type { uint8 } from "@tsonic/core/types.js";
class Offset {
  constructor(readonly value: number | bigint) {}
  add(index: number | bigint): number | bigint {
    return typeof this.value === "number" && typeof index === "number"
      ? this.value + index : BigInt(this.value) + BigInt(index);
  }
}
let allocations = 0;
class Bytes {
  private storage: uint8[] | undefined = undefined;
  constructor(private readonly value: string) {}
  first(): uint8 {
    const storage = this.storage ?? (this.storage = Array.from(this.value,
      (character: string): uint8 => { allocations++; return character.charCodeAt(0) as uint8; }));
    return storage[0];
  }
  set(value: uint8): void {
    const storage = this.storage;
    if (storage !== undefined) storage[0] = value;
  }
}
let order = 0;
let globalValue = 0;
class Box {
  value: number = 1;
  get selected(): number { order = order * 10 + 5; return this.value; }
  set selected(value: number) { order = order * 10 + 4; this.value = value; }
}
function receiver(box: Box): Box { order = order * 10 + 1; return box; }
function index(): number { order = order * 10 + 2; return 0; }
function next(): number { order = order * 10 + 3; return 7; }
function fail(): number { order = order * 10 + 3; throw new Error("failed"); }
export function main(): void {
  check(new Offset(3).add(2) === 5);
  check(new Offset(9007199254740993n).add(2) === 9007199254740995n);
  check(new Offset(3).add(2n) === 5n);
  const bytes = new Bytes("AB");
  check(bytes.first() === 65 && allocations === 2);
  bytes.set(90 as uint8);
  check(bytes.first() === 90 && allocations === 2);
  const box = new Box();
  order = 0;
  check((receiver(box).selected = next()) === 7);
  check(order === 134 && box.value === 7);
  check(box.selected === 7 && order === 1345);
  const values = [1];
  order = 0;
  check((values[index()] = next()) === 7);
  check(order === 23 && values[0] === 7);
  let local = 1;
  check((local = local + 1) === 2 && local === 2);
  check((globalValue = local = 8) === 8 && globalValue === 8 && local === 8);
  order = 0;
  try { const result = receiver(box).selected = fail(); check(result === 0); }
  catch { check(order === 13 && box.value === 7); }
}
` },
  });
  assert.deepEqual(result.diagnostics, []);
  validateGeneratedProject("compiler-property-refinements", result.artifacts, { run: true });
});
