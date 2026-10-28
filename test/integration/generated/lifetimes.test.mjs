import { assertNoTargetDiagnostics } from "../../../../tsonic/test/scripts/diagnostic-assertions.mjs";
import assert from "node:assert/strict";
import { nativeFunction, nativeSource, nativeNodes, nativeCalls, nativeType, nativeBorrow } from "../../helpers/native-ast.mjs";
import { isDeepStrictEqual } from "node:util";
import { spawnGeneratedCargo } from "../../helpers/cargo-target-pool.mjs";
import { test } from "node:test";


import {
  acmeTestingPackage,
  analyzeRust,
  artifactText,
  compileRust,
} from "../../helpers/rust-session.mjs";
import {
  validateGeneratedProject,
  writeGeneratedProject,
} from "../../helpers/cargo-projects.mjs";

test("ordinary TypeScript remains lifetime-annotation free", () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

export function identity(value: int32): int32 {
  return value;
}
`,
    },
  });

  assertNoTargetDiagnostics(result.diagnostics);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /pub fn identity\(value: i32\) -> i32/u);
  assert.doesNotMatch(source, /identity<'|&(?:'\w+ )?i32/u);
});

for (const surfaces of [[], ["js"]]) {
  test(`project member selection retains its declared lifetime owner (${surfaces[0] ?? "native"})`, () => {
    const { program } = analyzeRust({ surfaces, files: { "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
import type { Life, Ref } from "@tsonic/rust/types.js";
export class Left<L extends Life> {
  value: Ref<int32, L>;
  constructor(value: Ref<int32, L>) { this.value = value; }
  current(): Ref<int32, L> { return this.value; }
}
export class Right<L extends Life> {
  value: Ref<int32, L>;
  constructor(value: Ref<int32, L>) { this.value = value; }
  current(): Ref<int32, L> { return this.value; }
}
` } });
    const { ast } = program.source;
    const reads = [];
    const visit = node => {
      const selected = program.records.targetOperation.get(node);
      if (selected?.kind === "source-field" && selected.storage === "project-object") reads.push(selected);
      ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
    };
    program.sourceFiles.forEach(visit);
    assert.equal(reads.length, 4, "both writes and reads retain their own exact project field");
    for (const selected of reads) {
      const receiverOwner = program.projectTypes.definitionForCarrier(selected.receiverCarrier);
      const memberOwner = program.projectTypes.definitionContainingDeclaration(selected.declaration);
      assert.equal(receiverOwner !== undefined && receiverOwner === memberOwner, true,
        "same generic arity and structural field names cannot substitute a foreign owner");
      assert.equal(selected.resultCarrier.kind, "reference", "the field remains a native reference");
      assert.equal(selected.resultCarrier.lifetime?.kind, "parameter", "the authored lifetime is not replaced by static");
    }
  });
}

test("explicit Rust lifetime source types lower fields, aliases, bounds, nested references, and results exactly", () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
import type {
  Life,
  MaybeSized,
  Mut,
  Outlives,
  Placeholder,
  Ref,
  Static,
  ValidFor,
} from "@tsonic/rust/types.js";

export type Shared<L extends Life> = Ref<int32, L>;

export class View<L extends Life> {
  value: Ref<int32, L>;

  constructor(value: Ref<int32, L>) {
    this.value = value;
  }

  current(): Ref<int32, L> {
    return this.value;
  }
}

export function openView<L extends Life>(value: Ref<int32, L>): View<L> {
  return new View<L>(value);
}

export function pick<
  A extends Life,
  B extends Life & Outlives<A>,
  T extends ValidFor<A> & MaybeSized,
>(short: Ref<T, A>, long: Ref<T, B>): Ref<T, A> {
  return short;
}

export function nested<A extends Life, B extends Life>(
  value: Ref<Mut<int32, B>, A>,
): Ref<Mut<int32, B>, A> {
  return value;
}

export function permanent(value: Ref<int32, Static>): Ref<int32, Static> {
  return value;
}

export function inferred(value: Ref<int32, Placeholder>): Ref<int32, Placeholder> {
  return value;
}
`,
    },
  });

  assertNoTargetDiagnostics(result.diagnostics);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /pub type Shared<'L> = &'L i32;/u);
  assert.match(source, /pub struct View<'L>/u);
  assert.match(source, /value: &'L i32/u);
  assert.match(source, /pub fn openView<'L>\(value: &'L i32\) -> View<'L>/u);
  assert.match(source, /pub fn pick<'A, 'B: 'A, T: 'A \+ \?Sized>/u);
  assert.match(source, /short: &'A T/u);
  assert.match(source, /long: &'B T/u);
  assert.match(source, /-> &'A T/u);
  assert.match(source, /value: &'A &'B mut i32/u);
  assert.match(source, /value: &'static i32/u);
  assert.match(source, /value: &'_ i32/u);
  validateGeneratedProject("native-lifetime-declaration-proof", result.artifacts);
});

test("Rust lifetime and reference identities survive aliases, re-exports, and namespace imports without matching local spellings", () => {
  const { source, program } = analyzeRust({
    files: {
      "markers.ts": `
export type { Life as Region, Ref as Shared } from "@tsonic/rust/types.js";
export { ref as takeRef } from "@tsonic/rust/lang.js";
`,
      "shadow.ts": `
import type { int32 } from "@tsonic/core/types.js";

type Life = int32;
type Ref<T, L = Life> = T;

function ref<T>(value: T): T {
  return value;
}

export function local(value: Ref<int32>): int32 {
  return ref(value);
}
`,
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
import type { Region, Shared } from "./markers.js";
import { takeRef } from "./markers.js";
import type * as RustTypes from "@tsonic/rust/types.js";
import * as RustLang from "@tsonic/rust/lang.js";
export { local } from "./shadow.js";

export function aliased<A extends Region>(value: int32): Shared<int32, A> {
  return takeRef<int32, A>(value);
}

export function namespaced<A extends RustTypes.Life>(
  value: int32,
): RustTypes.Ref<int32, A> {
  return RustLang.ref<int32, A>(value);
}
`,
    },
  });
  const { ast } = source;
  const selected = [];
  for (const sourceFile of source.sourceFiles) {
    if (ast.isDeclarationFile(sourceFile)) continue;
    const visit = (node) => {
      const fact = program.records.targetOperation.get(node);
      if (fact?.kind === "reference-operation") selected.push(fact);
      ast.forEachChild(node, (child) => child && visit(child));
    };
    visit(sourceFile);
  }

  assert.deepEqual(selected.map((fact) => fact.operation).sort(), [
    "shared-reference",
    "shared-reference",
  ]);
  assert.ok(selected.every((fact) =>
    fact.operationId === "tsonic.rust.reference.shared-reference"));
});

test("elided native references execute as zero-wrapper Rust borrows", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    packages: [acmeTestingPackage()],
    target: {
      id: "rust",
      options: { outputType: "bin", crateName: "native_lifetime_reference_proof" },
    },
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
import type { Life, Mut, Outlives, Ref, ValidFor } from "@tsonic/rust/types.js";
import { load, mut, ref, store } from "@tsonic/rust/lang.js";
import { check } from "@acme/testing";

function increment(value: Mut<int32>): void {
  store(value, load(value) + 1);
}

function read(value: Ref<int32>): int32 {
  return load(value);
}

function choose<A extends Life, B extends Life & Outlives<A>>(
  left: Ref<int32, A>,
  _right: Ref<int32, B>,
): Ref<int32, A> {
  return left;
}

function hold<L extends Life, T extends ValidFor<L>>(
  value: Ref<T, L>,
): Ref<T, L> {
  return value;
}

function copyPlusOne(target: Mut<int32>, source: Ref<int32>): void {
  store(target, load(source) + 1);
}

export function main(): void {
  let value: int32 = 41;
  let copied: int32 = 0;
  increment(mut(value));
  check(read(ref(value)) === 42);
  check(read(choose(ref(value), ref(copied))) === 42);
  check(read(hold(ref(value))) === 42);
  copyPlusOne(mut(copied), ref(value));
  check(copied === 43);
}
main();
`,
    },
  });

  assertNoTargetDiagnostics(result.diagnostics);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /fn increment\(value: &mut i32\)/u);
  assert.match(source, /\*value \+= 1;/u);
  assert.match(source, /\*target = \*source \+ 1;/u);
  assert.match(source, /fn read\(value: &i32\) -> i32/u);
  assert.match(source, /fn choose<'A, 'B: 'A>/u);
  assert.match(source, /read\(choose\(&value, &copied\)\)/u);
  assert.match(source, /increment\(&mut value\)/u);
  assert.match(source, /read\(&value\)/u);
  assert.doesNotMatch(source, /Location|Rc<|RefCell</u);
  const run = validateGeneratedProject(
    "native-lifetime-reference-proof",
    result.artifacts,
    { run: true },
  );
  assert.equal(run.status, 0);
});

test("captured higher-ranked callbacks compare authored signatures without requiring retained storage", { timeout: 300_000 }, () => {
  const { result } = compileRust({ files: { "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
import type { Life, Ref, Static } from "@tsonic/rust/types.js";
import { load, ref } from "@tsonic/rust/lang.js";
export type Reader = <L extends Life>(value: Ref<int32, L>) => int32;
export function acceptReader(reader: Reader): int32 {
  const value: int32 = 9;
  return reader(ref(value));
}
export function invokeCaptured(value: Ref<int32, Static>): int32 {
  return acceptReader(<L extends Life>(_ignored: Ref<int32, L>): int32 => load(value));
}
` } });
  assertNoTargetDiagnostics(result.diagnostics);
  const reader = nativeFunction(result, "acceptReader");
  const bounds = nativeNodes(reader.params[0].type, node => node.kind === "callable" && node.trait === "Fn");
  assert.equal(bounds.length, 1, "one native higher-ranked callback bound");
  assert.deepEqual(bounds[0].binder.map(parameter => parameter.name), ["L"]);
  assert.equal(isDeepStrictEqual(bounds[0].parameters,
    [nativeBorrow(nativeType("i32"), { kind: "named", name: "L" })]), true, "exact native higher-ranked parameter");
  assert.equal(isDeepStrictEqual(bounds[0].result, nativeType("i32")), true, "exact native higher-ranked result");
  const source = artifactText(result, "src/index.rs");
  assert.doesNotMatch(source, /(?:Box|Rc|Arc)::new/u, "signature comparison adds no retained allocation");
  validateGeneratedProject("captured-higher-ranked-signature", result.artifacts);
});

for (const [label, parameterType, resultType, captureType] of [
  ["non-alpha-equivalent input", "int16", "int32", "Static"],
  ["borrowed capture cannot become static", "int32", "Ref<int32, Static>", "Outer"],
]) {
  test(`higher-ranked callback signature preserves ${label}`, () => {
    const body = resultType === "int32" ? "load(value)" : "value";
    const { result } = compileRust({ files: { "index.ts": `
import type { int32, int16 } from "@tsonic/core/types.js";
import type { Life, Ref, Static } from "@tsonic/rust/types.js";
import { load } from "@tsonic/rust/lang.js";
type Reader = <L extends Life>(input: Ref<int32, L>) => ${resultType};
function accept(reader: Reader): void {}
export function refuse<Outer extends Life>(value: Ref<int32, ${captureType}>): void {
  accept(<L extends Life>(_ignored: Ref<${parameterType}, L>): ${resultType} => ${body});
}
` } });
    assert.equal(result.artifacts.length, 0, label + ": no invalid native program is emitted");
    assert.equal(result.diagnostics.length, 1, label + ": one precise native mismatch");
    assert.equal(result.diagnostics[0].code, "RUST_SOURCE_CALL_ARGUMENT_CARRIER_MISSING", label);
    assert.equal(result.diagnostics[0].message,
      "Selected source argument 0 has no exact carrier matching its effective parameter bindings.", label);
  });
}

test("borrowed contracts survive async, HRTB callback, closure, and generator lowering", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
import type { Life, Outlives, Ref, Static } from "@tsonic/rust/types.js";
import { load, ref } from "@tsonic/rust/lang.js";

export type Reader = <L extends Life>(value: Ref<int32, L>) => int32;

export async function retain<L extends Life>(
  value: Ref<int32, L>,
): Promise<Ref<int32, L>> {
  return value;
}

export function acceptReader(reader: Reader): int32 {
  const value: int32 = 9;
  return reader(ref(value));
}

export function staticReader(value: Ref<int32, Static>): () => int32 {
  return () => load(value);
}

export function invokeCaptured(value: Ref<int32, Static>): void {
  acceptReader(<L extends Life>(_ignored: Ref<int32, L>): int32 => load(value));
}

export function* staticValues(
  value: Ref<int32, Static>,
): Generator<int32, void, void> {
  yield load(value);
}

export function* borrowedValues<L extends Life>(
  value: Ref<int32, L>,
): Generator<int32, void, void> {
  yield load(value);
}

export function consumeBorrowedValues(): void {
  const value: int32 = 17;
  const generator = borrowedValues(ref(value));
  generator.next();
}

export function* borrowedPair<
  Short extends Life,
  Middle extends Life & Outlives<Short>,
  Long extends Life & Outlives<Middle>,
>(
  short: Ref<int32, Short>,
  long: Ref<int32, Long>,
): Generator<int32, int32, void> {
  yield load(long);
  return load(short);
}

export async function* borrowedAsyncValues<L extends Life>(
  value: Ref<int32, L>,
): AsyncGenerator<int32, void, void> {
  yield load(value);
}
`,
    },
  });

  assertNoTargetDiagnostics(result.diagnostics);
  const retain = nativeFunction(result, "retain");
  assert.equal(retain.isAsync, true);
  assert.deepEqual(retain.params.map(parameter => parameter.type), [nativeBorrow(nativeType("i32"), { kind: "named", name: "L" })]);
  assert.deepEqual(retain.returnType, retain.params[0].type);
  for (const [path, reason] of [["clippy::needless_lifetimes", "explicit lifetime contract"],
    ["non_snake_case", "preserves the authored source name"]]) {
    assert.equal(retain.attrs.some(attribute => attribute.kind === "list" && attribute.path === "allow" &&
      attribute.arguments.some(argument => argument.path === path) &&
      attribute.arguments.some(argument => argument.path === "reason" && argument.value.value === reason)), true);
  }
  const reader = nativeFunction(result, "acceptReader");
  assert.equal(reader.visibility, "public");
  const bounds = nativeNodes(reader.params[0].type, node => node.kind === "callable" && node.trait === "Fn");
  assert.equal(bounds.length, 1, "one higher-ranked checked callback bound");
  assert.deepEqual(bounds[0].binder.map(parameter => parameter.name), ["L"]);
  assert.deepEqual(bounds[0].parameters, [retain.params[0].type]);
  assert.deepEqual(bounds[0].result, nativeType("i32"));
  assert.deepEqual(reader.returnType, nativeType("i32"));
  const invoked = nativeNodes(reader.body, node => node.kind === "invoke" && node.callee.path === "reader");
  assert.equal(invoked.length, 1);
  assert.equal(invoked[0].args[0].kind, "reference");
  for (const name of ["staticReader", "invokeCaptured"]) {
    assert.deepEqual(nativeFunction(result, name).params[0].type, nativeBorrow(nativeType("i32"), { kind: "static" }));
  }
  const model = nativeSource(result);
  assert.equal(nativeNodes(model, node => node.kind === "dereference" && node.pointer.path === "value").length > 0, true);
  for (const [name, path] of [["borrowedValues", "rt::BorrowedGenerator"], ["borrowedAsyncValues", "rt::BorrowedAsyncGenerator"]]) {
    const generator = nativeFunction(result, name);
    assert.deepEqual(generator.params[0].type, retain.params[0].type);
    assert.equal(generator.returnType.path, path);
    assert.deepEqual(generator.returnType.genericArguments[0], { kind: "lifetime", lifetime: { kind: "named", name: "L" } });
    assert.deepEqual(generator.returnType.genericArguments.slice(1).map(argument => argument.type), [nativeType("i32"), nativeType("()"), nativeType("()"), { kind: "named", path: "core::convert::Infallible" }]);
  }
  const pair = nativeFunction(result, "borrowedPair");
  assert.deepEqual(pair.generics.parameters.filter(parameter => parameter.kind === "lifetime").map(parameter =>
    ({ name: parameter.name, outlives: parameter.outlives })), [
    { name: "Short", outlives: [] }, { name: "Middle", outlives: [{ kind: "named", name: "Short" }] },
    { name: "Long", outlives: [{ kind: "named", name: "Middle" }] },
  ]);
  assert.equal(pair.returnType.path, "rt::BorrowedGenerator");
  assert.deepEqual(pair.returnType.genericArguments, [
    { kind: "lifetime", lifetime: { kind: "named", name: "Short" } },
    ...[nativeType("i32"), nativeType("i32"), nativeType("()"), { kind: "named", path: "core::convert::Infallible" }].map(type => ({ kind: "type", type })),
  ]);
  const consume = nativeFunction(result, "consumeBorrowedValues");
  const local = nativeNodes(consume.body, node => node.kind === "let" && node.name === "generator");
  assert.equal(local.length, 1);
  assert.equal(local[0].mutable, true);
  assert.equal(local[0].type.path, "rt::BorrowedGenerator");
  assert.deepEqual(local[0].type.genericArguments[0], { kind: "lifetime", lifetime: { kind: "placeholder" } });
  assert.equal(nativeCalls(local[0].init, "borrowedValues").length, 1);
  assert.equal(nativeCalls(model, "rt::BorrowedGenerator::new").length > 0, true);
  validateGeneratedProject("native-lifetime-retention-proof", result.artifacts);
});

test("generator storage rejects unrelated authored capture lifetimes", () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
import type { Life, Ref } from "@tsonic/rust/types.js";
import { load } from "@tsonic/rust/lang.js";

export function* ambiguous<Left extends Life, Right extends Life>(
  left: Ref<int32, Left>,
  right: Ref<int32, Right>,
): Generator<int32, int32, void> {
  yield load(left);
  return load(right);
}
`,
    },
  });

  assert.equal(result.artifacts.length, 0);
  assert.deepEqual(
    result.diagnostics.map(({ code }) => code),
    ["RUST_GENERATOR_STORAGE_LIFETIME_NOT_PROVEN"],
  );
  assert.match(
    result.diagnostics[0]?.message ?? "",
    /one exact native storage lifetime from its authored contract or unambiguous input elision/u,
  );
});

test("unresolved authored lifetime bounds fail at target analysis without guessed output", () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
import type {
  Life,
  Outlives,
  Placeholder,
  Ref,
} from "@tsonic/rust/types.js";

export function invalidBound<
  L extends Life & Outlives<Placeholder>,
>(value: Ref<int32, L>): Ref<int32, L> {
  return value;
}
`,
    },
  });

  assert.equal(result.artifacts.length, 0);
  assert.deepEqual(
    result.diagnostics.map(({ code }) => code),
    ["RUST_LIFETIME_BOUND_NOT_PROVEN"],
  );
  assert.match(
    result.diagnostics[0]?.message ?? "",
    /no exact named or static lifetime identity/u,
  );
});

test("Tsonic emits exact declared lifetimes while rustc rejects an invalid returned borrow", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
import type { Life, Ref } from "@tsonic/rust/types.js";
import { ref } from "@tsonic/rust/lang.js";

export function invalid<L extends Life>(value: Ref<int32, L>): Ref<int32, L> {
  const local: int32 = 1;
  return ref<int32, L>(local);
}
`,
    },
  });

  assertNoTargetDiagnostics(result.diagnostics);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /pub fn invalid<'L>\(value: &'L i32\) -> &'L i32/u);
  assert.match(source, /&local/u);

  const projectRoot = writeGeneratedProject("invalid-native-lifetime-proof", result.artifacts);
  const cargo = spawnGeneratedCargo(projectRoot, ["check", "--all-targets", "--offline"], {
    cwd: projectRoot,
    encoding: "utf8",
    env: { ...process.env, CARGO_TERM_COLOR: "never" },
    timeout: 300_000,
  });
  assert.notEqual(cargo.status, 0);
  assert.match(`${cargo.stdout}\n${cargo.stderr}`, /E0515|reference to local variable|borrowed value/u);
});
