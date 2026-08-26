import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

import { rustTargetOperationFactKey } from "../../../dist/analysis/facts/keys.js";
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

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /pub fn identity\(value: i32\) -> i32/u);
  assert.doesNotMatch(source, /identity<'|&(?:'\w+ )?i32/u);
});

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

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /pub type Shared<'l> = &'l i32;/u);
  assert.match(source, /pub struct View<'l>/u);
  assert.match(source, /value: &'l i32/u);
  assert.match(source, /pub fn pick<'a, 'b: 'a, T: 'a \+ \?Sized>/u);
  assert.match(source, /short: &'a T/u);
  assert.match(source, /long: &'b T/u);
  assert.match(source, /-> &'a T/u);
  assert.match(source, /value: &'a &'b mut i32/u);
  assert.match(source, /value: &'static i32/u);
  assert.match(source, /value: &'_ i32/u);
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
      const fact = program.facts.getFact(node, rustTargetOperationFactKey);
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
import type { Mut, Ref } from "@tsonic/rust/types.js";
import { load, mut, ref, store } from "@tsonic/rust/lang.js";
import { check } from "@acme/testing";

function increment(value: Mut<int32>): void {
  store(value, load(value) + 1);
}

function read(value: Ref<int32>): int32 {
  return load(value);
}

function copyPlusOne(target: Mut<int32>, source: Ref<int32>): void {
  store(target, load(source) + 1);
}

export function main(): void {
  let value: int32 = 41;
  let copied: int32 = 0;
  increment(mut(value));
  check(read(ref(value)) === 42);
  copyPlusOne(mut(copied), ref(value));
  check(copied === 43);
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /fn increment\(value: &mut i32\)/u);
  assert.match(source, /\*value \+= 1;/u);
  assert.match(source, /\*target = \*source \+ 1;/u);
  assert.match(source, /fn read\(value: &i32\) -> i32/u);
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

test("borrowed contracts survive async, HRTB callback, closure, and generator lowering", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
import type { Life, Ref, Static } from "@tsonic/rust/types.js";
import { load } from "@tsonic/rust/lang.js";

export type Reader = <L extends Life>(value: Ref<int32, L>) => int32;

export async function retain<L extends Life>(
  value: Ref<int32, L>,
): Promise<Ref<int32, L>> {
  return value;
}

export function acceptReader(reader: Reader): void {
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
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(
    source,
    /#\[allow\(clippy::needless_lifetimes, reason = "explicit lifetime contract"\)\]\npub async fn retain<'l>/u,
  );
  assert.match(source, /pub async fn retain<'l>\(value: &'l i32\) -> &'l i32/u);
  assert.match(source, /reader: impl for<'l> Fn\(&'l i32\) -> i32/u);
  assert.match(source, /pub fn static_reader\(value: &'static i32\)/u);
  assert.match(source, /pub fn invoke_captured\(value: &'static i32\)/u);
  assert.match(source, /value: &'static i32/u);
  assert.match(source, /\*value/u);
  validateGeneratedProject("native-lifetime-retention-proof", result.artifacts);
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

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /pub fn invalid<'l>\(_value: &'l i32\) -> &'l i32/u);
  assert.match(source, /&local/u);

  const projectRoot = writeGeneratedProject("invalid-native-lifetime-proof", result.artifacts);
  const cargo = spawnSync("cargo", ["check", "--all-targets", "--offline"], {
    cwd: projectRoot,
    encoding: "utf8",
    env: { ...process.env, CARGO_TERM_COLOR: "never" },
    timeout: 300_000,
  });
  assert.notEqual(cargo.status, 0);
  assert.match(`${cargo.stdout}\n${cargo.stderr}`, /E0515|reference to local variable|borrowed value/u);
});
