import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  appendFileSync,
  chmodSync,
  cpSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createRustCompilerWorkerClient } from "../../../../dist/providers/compiler/protocol/worker-client.js";
import {
  compilerProviderModuleId,
  projectRustCompilerModule,
} from "../../../../dist/providers/compiler/projection/projection.js";
import {
  rustCompilerProviderProtocolVersion,
} from "../../../../dist/providers/compiler/model/model.js";
import {
  verifyRustCompilerStandardLibraryMetadata,
} from "../../../../dist/providers/compiler/snapshot/cargo-snapshot.js";
import {
  compileRustThroughTargetPack,
  createRustSession,
  rustSourceDiagnostics,
} from "../../../helpers/rust-session.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const fixtureCrate = resolve(repositoryRoot, "test/fixtures/crates/acme_widget");
const runtimeCrate = resolve(repositoryRoot, "../rust-runtime/crates/tsonic_rust_runtime");
const testRoot = resolve(repositoryRoot, ".temp/compiler-provider-tests");

test("Cargo provider virtual imports compile, execute, and preserve the user-owned manifest", { timeout: 300_000 }, () => {
  const project = createUserCargoProject();
  const source = `
import type { FixedArray, int32 } from "@tsonic/core/types.js";
import type { FunctionPointer } from "@tsonic/core/types.js";
import { unsafeContext } from "@tsonic/core/lang.js";
import type { constPtr, i8, mutPtr, u8 } from "@tsonic/rust/types.js";
import { Box } from "@tsonic/rust/std/boxed.js";
import type { Pair } from "@tsonic/rust/crates/widget_alias/index.js";
import { ANSWER, CheckedWidget, GenericFactory, GLOBAL_COUNT, MUTABLE_COUNT, Mode, NON_CLONE_STATIC, NumberBits, SimpleMode, StructuredMode, Widget, apply, borrowed_answer, borrowed_label, byte_ptr, checked_double, cloned, copied, dangerous, double, duplicate, featured, fill, first_byte, first_mixed_item, identity, integer_bits, integer_format, maybe_positive, mixed_item, mode_code, non_clone_static_value, pair_sum, pin_widget, preserve_borrowed, scalar_code, scalar_smile, simple_mode_code, singleton_map, structured_mode_value, sum, variadic_printf } from "@tsonic/rust/crates/widget_alias/index.js";
import { int_widget } from "@tsonic/rust/crates/widget_alias/factory.js";
import { triple } from "@tsonic/rust/crates/widget_alias/math.js";

function readMutablePointer(pointer: mutPtr<u8>): u8 {
  return unsafeContext(first_byte(pointer));
}

function readConstPointer(pointer: constPtr<u8>): u8 {
  return unsafeContext(first_byte(pointer));
}

class DomainError extends Error {
  constructor(message: string) { super(message); }
}

function checkedInProjectDomain(value: int32): int32 {
  if (value < 0) throw new DomainError("negative");
  return checked_double(value);
}

export function invokePointer(
  callback: FunctionPointer<[int32], int32>,
  value: int32,
): int32 {
  return apply(value, callback);
}

export function main(): void {
  if (GenericFactory.new<int32>(1).value !== 27) {
    throw new Error("generic static factory mapping failed");
  }
  const checked = new CheckedWidget(6);
  if (checked.value !== 6 || checked_double(4) !== 8 || checkedInProjectDomain(5) !== 10) {
    throw new Error("fallible compiler-provider mapping failed");
  }
  const widget = new Widget<int32>(7);
  const previous = widget.replace(9);
  widget.count = 2;
  if (previous !== 7 || widget.count !== 2 || widget.into_value() !== 9) {
    throw new Error("generic Widget mapping failed");
  }
  const borrowedWidget = new Widget<int32>(12);
  if (borrowedWidget.value() !== 12) {
    throw new Error("borrowed Copy result mapping failed");
  }
  const boxed = new Box<Widget<int32>>(new Widget<int32>(13));
  if (Widget.into_box_value<int32>(boxed) !== 13) {
    throw new Error("custom receiver mapping failed");
  }
  let pinnedWidget = new Widget<int32>(19);
  const pinned = pin_widget(pinnedWidget);
  if (Widget.pinned_count<int32>(pinned) !== 1) {
    throw new Error("borrowed custom receiver mapping failed");
  }
  const metric = Widget.from_metric<int32>(14);
  if (metric.measure(2) !== 2 || Widget.UNIT<int32>() !== 1) {
    throw new Error("trait method or associated constant mapping failed");
  }
  metric.reset(17);
  if (metric.into_value() !== 17) {
    throw new Error("mutable trait receiver mapping failed");
  }
  const ownedBorrowedLabel: string = borrowed_label();
  if (borrowed_answer(18) !== 18 || borrowed_label() !== "widget" || ownedBorrowedLabel !== "widget") {
    throw new Error("borrowed free-function result mapping failed");
  }
  if (double(4) !== 8 || identity<int32>(5) !== 5 || featured(1) !== 101 || triple(3) !== 9) {
    throw new Error("function mapping failed");
  }
  const borrowed: int32 = 6;
  if (preserve_borrowed(borrowed) !== 6) {
    throw new Error("inferred provider lifetime mapping failed");
  }
  if (unsafeContext(dangerous(12)) !== 12) {
    throw new Error("unsafe function mapping failed");
  }
  if (unsafeContext(first_byte(byte_ptr())) !== 23) {
    throw new Error("raw pointer mapping failed");
  }
  if (readConstPointer(byte_ptr()) !== 23) {
    throw new Error("raw pointer source-call mapping failed");
  }
  if (ANSWER !== 42 || mode_code(Mode.Read) !== 1 || mode_code(Mode.Payload(9)) !== 9) {
    throw new Error("constant or enum mapping failed");
  }
  if (structured_mode_value(StructuredMode.Named(23)) !== 23) {
    throw new Error("struct-payload enum variant mapping failed");
  }
  if (non_clone_static_value(NON_CLONE_STATIC) !== 37) {
    throw new Error("non-Clone static reference mapping failed");
  }
  if (scalar_code(scalar_smile()) !== 128512) {
    throw new Error("native Rust scalar char mapping failed");
  }
  if (GLOBAL_COUNT !== 1 || simple_mode_code(SimpleMode.On) !== 1) {
    throw new Error("static or unit enum mapping failed");
  }
  {
    unsafeContext();
    MUTABLE_COUNT.value = 4;
    if (MUTABLE_COUNT.value !== 4) {
      throw new Error("mutable static mapping failed");
    }
    const bits: NumberBits = integer_bits(6);
    if (bits.integer !== 6) {
      throw new Error("union field read mapping failed");
    }
    bits.integer = 9;
    if (bits.integer !== 9) {
      throw new Error("union field write mapping failed");
    }
    const cloneInput = "clone";
    if (cloned<string>(cloneInput) !== cloneInput || copied<int32>(7) !== 7) {
      throw new Error("generic provider requirements failed");
    }
    const format: constPtr<i8> = integer_format();
    const variadicValue: int32 = 7;
    if (variadic_printf(format, variadicValue) !== 1) {
      throw new Error("C variadic mapping failed");
    }
  }
  const pair: Pair<int32> = [4, 5];
  if (pair_sum(pair) !== 9) {
    throw new Error("type alias mapping failed");
  }
  const mixedValues: FixedArray<int32, 2> = [61, 67];
  if (first_mixed_item(mixed_item(mixedValues)) !== 61) {
    throw new Error("mixed lifetime/type/const GAT mapping failed");
  }
  const numbers: int32[] = [1, 2, 3];
  const bytes: u8[] = [1, 2, 3];
  fill(bytes, 7);
  if (sum(numbers) !== 6 || bytes[0] !== 7 || bytes[2] !== 7) {
    throw new Error("slice parameter mapping failed");
  }
  const nested = int_widget(11);
  if (nested.count !== 1 || nested.into_value() !== 11) {
    throw new Error("cross-module type mapping failed");
  }
  const maybe = maybe_positive(6);
  if (maybe !== 6) {
    throw new Error("Option mapping failed");
  }
  const values = duplicate(8);
  const second = values.pop();
  const first = values.pop();
  if (first !== 8 || second !== 8 || !values.is_empty()) {
    throw new Error("Vec mapping failed");
  }
  const map = singleton_map(10);
  if (map.is_empty()) {
    throw new Error("HashMap mapping failed");
  }
}
`;
  const manifestBefore = readFileSync(project.manifestPath, "utf8");
  const { result } = compileRustThroughTargetPack({
    target: {
      id: "rust",
      options: {
        outputType: "bin",
        crateName: "compiler_provider_proof",
        projectFile: project.manifestPath,
      },
    },
    files: { "index.ts": source },
  });

  assert.deepEqual(result.diagnostics, []);
  assert.equal(result.artifacts.some(({ path }) => path === "Cargo.toml"), false);
  assert.match(result.artifacts.find(({ path }) => path === "src/index.rs")?.text ?? "", /widget_alias::Widget::new\(7\)/u);
  assert.match(result.artifacts.find(({ path }) => path === "src/index.rs")?.text ?? "", /widget_alias::GenericFactory::new::<i32>\(1\)/u);
  assert.match(result.artifacts.find(({ path }) => path === "src/index.rs")?.text ?? "", /widget_alias::CheckedWidget::new\(6\)\?/u);
  assert.match(result.artifacts.find(({ path }) => path === "src/index.rs")?.text ?? "", /widget_alias::checked_double\(4\)\?/u);
  assert.match(result.artifacts.find(({ path }) => path === "src/index.rs")?.text ?? "", /unsafe \{ widget_alias::dangerous\(12\) \}/u);
  assert.match(result.artifacts.find(({ path }) => path === "src/index.rs")?.text ?? "", /unsafe \{ widget_alias::first_byte\(widget_alias::byte_ptr\(\)\) \}/u);
  assert.match(result.artifacts.find(({ path }) => path === "src/index.rs")?.text ?? "", /fn read_mutable_pointer\(pointer: \*mut u8\) -> u8/u);
  assert.match(result.artifacts.find(({ path }) => path === "src/index.rs")?.text ?? "", /read_const_pointer\(widget_alias::byte_ptr\(\)\)/u);
  assert.match(result.artifacts.find(({ path }) => path === "src/index.rs")?.text ?? "", /widget_alias::Mode::Payload\(9\)/u);
  assert.match(result.artifacts.find(({ path }) => path === "src/index.rs")?.text ?? "", /widget_alias::fill\(&mut bytes, 7\)/u);
  assert.match(result.artifacts.find(({ path }) => path === "src/index.rs")?.text ?? "", /widget_alias::apply\(value, callback\)/u);
  assert.match(result.artifacts.find(({ path }) => path === "src/index.rs")?.text ?? "", /\*widget_alias::preserve_borrowed::<i32>\(&borrowed\)/u);
  assert.match(result.artifacts.find(({ path }) => path === "src/index.rs")?.text ?? "", /\*widget_alias::borrowed_answer\(&18\)/u);
  assert.match(result.artifacts.find(({ path }) => path === "src/index.rs")?.text ?? "", /let owned_borrowed_label: String = String::from\(widget_alias::borrowed_label\(\)\);/u);
  assert.match(result.artifacts.find(({ path }) => path === "src/index.rs")?.text ?? "", /widget_alias::borrowed_label\(\) != "widget"/u);
  assert.match(result.artifacts.find(({ path }) => path === "src/index.rs")?.text ?? "", /widget_alias::Widget::into_box_value\(boxed\)/u);
  assert.match(result.artifacts.find(({ path }) => path === "src/index.rs")?.text ?? "", /let pinned: std::pin::Pin<&mut widget_alias::Widget<i32>> =\s*widget_alias::pin_widget\(&mut pinned_widget\);/u);
  assert.match(result.artifacts.find(({ path }) => path === "src/index.rs")?.text ?? "", /widget_alias::Widget::pinned_count\(pinned\)/u);
  assert.match(result.artifacts.find(({ path }) => path === "src/index.rs")?.text ?? "", /widget_alias::StructuredMode::Named \{ value: 23 \}/u);
  assert.match(result.artifacts.find(({ path }) => path === "src/index.rs")?.text ?? "", /widget_alias::non_clone_static_value\(&?widget_alias::NON_CLONE_STATIC\)/u);
  assert.match(result.artifacts.find(({ path }) => path === "src/index.rs")?.text ?? "", /widget_alias::scalar_code\(widget_alias::scalar_smile\(\)\)/u);
  assert.match(result.artifacts.find(({ path }) => path === "src/index.rs")?.text ?? "", /<widget_alias::Widget<i32> as widget_alias::Metric<i32>>::measure/u);
  assert.match(result.artifacts.find(({ path }) => path === "src/index.rs")?.text ?? "", /<widget_alias::Widget<i32> as widget_alias::Metric<i32>>::UNIT/u);
  assert.match(result.artifacts.find(({ path }) => path === "src/index.rs")?.text ?? "", /unsafe \{[\s\S]*widget_alias::MUTABLE_COUNT = 4;[\s\S]*widget_alias::MUTABLE_COUNT[\s\S]*bits\.integer[\s\S]*widget_alias::variadic_printf\(format, variadic_value\)/u);
  writeGeneratedArtifacts(project.root, result.artifacts);
  assert.equal(readFileSync(project.manifestPath, "utf8"), manifestBefore);
  const run = runCargo(project.manifestPath, ["run", "--quiet", "--locked"]);
  assert.equal(run.status, 0, run.stderr);
});

test("missing Cargo exports fail closed at the selected source import", { timeout: 300_000 }, () => {
  const project = createUserCargoProject();
  for (const [importName, expected] of [["missing_export", /does not export public item/u]]) {
    const harness = createRustSession({
      target: { id: "rust", options: { projectFile: project.manifestPath } },
      files: {
        "index.ts": `import { ${importName} } from "@tsonic/rust/crates/widget_alias/index.js";\nexport const selected = ${importName};\n`,
      },
    });
    assert.match(rustSourceDiagnostics(harness), expected);
  }

  const unsupportedMember = compileRustThroughTargetPack({
    target: { id: "rust", options: { projectFile: project.manifestPath } },
    files: {
      "index.ts": `
import { Widget } from "@tsonic/rust/crates/widget_alias/index.js";
export function invalid(widget: Widget<string>): string {
  return widget.value();
}
`,
    },
  });
  assert.equal(unsupportedMember.result.artifacts.length, 0);
  assert.ok(unsupportedMember.result.diagnostics.some(({ code }) =>
    code === "RUST_PROVIDER_TYPE_INSTANTIATION_NOT_PROVEN"));
});

test("compiler provider delegates exact anonymous future requirements to Rust inference", { timeout: 300_000 }, () => {
  const project = createUserCargoProject();
  const { result } = compileRustThroughTargetPack({
    target: {
      id: "rust",
      options: {
        outputType: "bin",
        crateName: "compiler_provider_proof",
        projectFile: project.manifestPath,
      },
    },
    files: {
      "index.ts": `
import {
  require_local_future,
  require_send_static_future,
} from "@tsonic/rust/crates/widget_alias/index.js";

async function completeLater(): Promise<void> {}

export function main(): void {
  require_local_future(completeLater());
  require_send_static_future(completeLater());
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const source = result.artifacts.find(({ path }) => path === "src/index.rs")?.text ?? "";
  assert.match(source, /widget_alias::require_local_future::<_>\(complete_later\(\)\)/u);
  assert.match(source, /widget_alias::require_send_static_future::<_>\(complete_later\(\)\)/u);
  writeGeneratedArtifacts(project.root, result.artifacts);
  const run = runCargo(project.manifestPath, ["run", "--quiet", "--locked"]);
  assert.equal(run.status, 0, run.stderr);
});

test("compiler provider lifetime contracts compile and execute through exact selected carriers", { timeout: 300_000 }, () => {
  const project = createUserCargoProject();
  const { result } = compileRustThroughTargetPack({
    target: {
      id: "rust",
      options: {
        outputType: "bin",
        crateName: "compiler_provider_proof",
        projectFile: project.manifestPath,
      },
    },
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
import type {
  Life,
  Mut,
  Outlives,
  Ref,
} from "@tsonic/rust/types.js";
import { mut, ref } from "@tsonic/rust/lang.js";
import {
  LifetimeView,
  LendingValue,
  apply_borrowed,
  choose_borrowed_mixed,
  constrained_lending,
  increment_borrowed,
  inspect_view,
  lending_value,
  opaque_borrow,
  opaque_mixed,
  read_lending_value,
} from "@tsonic/rust/crates/widget_alias/index.js";

function borrowedIdentity<L extends Life>(value: Ref<int32, L>): Ref<int32, L> {
  return value;
}

function chooseMixed<
  Short extends Life,
  Long extends Life & Outlives<Short>,
>(short: Ref<int32, Short>, long: Ref<int32, Long>): int32 {
  return choose_borrowed_mixed<Short, Long, int32, 3>(short, long);
}

function incrementBorrowed<L extends Life>(value: Mut<int32, L>): void {
  increment_borrowed(value);
}

function readView<L extends Life>(view: Ref<LifetimeView, L>): int32 {
  return view.value();
}

function incrementView<L extends Life>(view: Mut<LifetimeView, L>): void {
  view.increment();
}

function retainMixedOpaque<L extends Life>(value: Ref<int32, L>): void {
  opaque_mixed<L, int32, 3>(value);
}

export function main(): void {
  const short: int32 = 31;
  const long: int32 = 47;
  let mutable: int32 = 10;
  incrementBorrowed(mut(mutable));
  if (mutable !== 11) {
    throw new Error("mutable provider reborrow failed");
  }
  if (chooseMixed(ref(short), ref(long)) !== 31) {
    throw new Error("mixed lifetime/type/const provider call failed");
  }
  if (apply_borrowed(borrowedIdentity, short) !== 31) {
    throw new Error("higher-ranked function-pointer call failed");
  }

  let view = new LifetimeView(53);
  incrementView(mut(view));
  if (view.value() !== 54) {
    throw new Error("mutable receiver lifetime call failed");
  }
  if (inspect_view(view) !== 54) {
    throw new Error("trait-object lifetime call failed");
  }
  opaque_borrow(short);
  retainMixedOpaque(ref(short));

  const family = new LendingValue(59);
  const item = lending_value(family);
  const constrained = constrained_lending(family, item);
  if (read_lending_value(constrained) !== 59) {
    throw new Error("GAT or associated constraint call failed");
  }
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const source = result.artifacts.find(({ path }) => path === "src/index.rs")?.text ?? "";
  assert.match(source, /widget_alias::choose_borrowed_mixed::<i32, 3>\(short, long\)/u);
  assert.match(source, /fn increment_borrowed<'l>\(value: &'l mut i32\)/u);
  assert.match(source, /widget_alias::increment_borrowed\(value\)/u);
  assert.match(source, /ModuleCell<for<'l> fn\(&'l i32\) -> &'l i32> = rt::ModuleCell::initialized\(borrowed_identity\)/u);
  assert.match(source, /widget_alias::apply_borrowed\([^,]+, &short\)/u);
  assert.doesNotMatch(source, /for<'l> fn\([^;]+::new/u);
  assert.match(source, /widget_alias::inspect_view\(&view\)/u);
  assert.match(source, /fn read_view<'l>\(view: &'l widget_alias::LifetimeView\) -> i32/u);
  assert.match(
    source,
    /fn read_view<'l>[^}]+<widget_alias::LifetimeView as widget_alias::View>::value\(view\)/u,
  );
  assert.match(source, /fn increment_view<'l>\(view: &'l mut widget_alias::LifetimeView\)/u);
  assert.match(source, /fn increment_view<'l>[^}]+view\.increment\(\)/u);
  assert.doesNotMatch(source, /widget_alias::LifetimeView::increment\(&mut view\)/u);
  assert.match(source, /widget_alias::opaque_borrow\(&short\)/u);
  assert.match(source, /widget_alias::opaque_mixed::<i32, 3>\(value\)/u);
  assert.match(source, /widget_alias::lending_value\(&family\)/u);
  assert.match(source, /widget_alias::constrained_lending::<widget_alias::LendingValue>\(&family, item\)/u);
  writeGeneratedArtifacts(project.root, result.artifacts);
  const run = runCargo(project.manifestPath, ["run", "--quiet", "--locked"]);
  assert.equal(run.status, 0, run.stderr);
});

test("compiler provider keeps native Result separate from the runtime error boundary", { timeout: 300_000 }, () => {
  const project = createUserCargoProject();
  const harness = createRustSession({
    target: { id: "rust", options: { projectFile: project.manifestPath } },
    files: {
      "index.ts": `import { foreign_result } from "@tsonic/rust/crates/widget_alias/index.js";\nexport const selected = foreign_result;\n`,
    },
  });
  assert.equal(rustSourceDiagnostics(harness), "");
});

test("unsafe Cargo provider calls fail closed without an explicit source unsafe region", { timeout: 300_000 }, () => {
  const project = createUserCargoProject();
  const { result } = compileRustThroughTargetPack({
    target: { id: "rust", options: { projectFile: project.manifestPath } },
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
import { dangerous } from "@tsonic/rust/crates/widget_alias/index.js";
export function rejected(value: int32): int32 { return dangerous(value); }
`,
    },
  });
  assert.equal(result.artifacts.length, 0);
  assert.ok(result.diagnostics.some(({ code }) => code === "RUST_UNSAFE_OPERATION_CONTEXT_REQUIRED"));
});

test("compiler provider generic requirements and C variadic tails fail closed", { timeout: 300_000 }, () => {
  const project = createUserCargoProject();
  const generic = compileRustThroughTargetPack({
    target: { id: "rust", options: { projectFile: project.manifestPath } },
    files: {
      "index.ts": `
import { Widget, copied } from "@tsonic/rust/crates/widget_alias/index.js";
export function rejected(value: Widget<string>): Widget<string> {
  return copied<Widget<string>>(value);
}
`,
    },
  });
  assert.equal(generic.result.artifacts.length, 0);
  assert.ok(generic.result.diagnostics.some(({ code }) =>
    code === "RUST_PROVIDER_TYPE_INSTANTIATION_NOT_PROVEN"));

  const variadic = compileRustThroughTargetPack({
    target: { id: "rust", options: { projectFile: project.manifestPath } },
    files: {
      "index.ts": `
import { unsafeContext } from "@tsonic/core/lang.js";
import type { float32, int32 } from "@tsonic/core/types.js";
import { integer_format, variadic_printf } from "@tsonic/rust/crates/widget_alias/index.js";
export function rejected(value: float32): int32 {
  return unsafeContext(variadic_printf(integer_format(), value));
}
`,
    },
  });
  assert.equal(variadic.result.artifacts.length, 0);
  assert.ok(variadic.result.diagnostics.some(({ code }) =>
    code === "RUST_CALL_ARGUMENT_CONVERSION_UNSUPPORTED"), JSON.stringify(variadic.result.diagnostics));
});

test("dependency-closure mutation after snapshot is rejected before rustdoc reuse", { timeout: 300_000 }, () => {
  const copiedCrate = uniquePath("mutable-crate");
  cpSync(fixtureCrate, copiedCrate, { recursive: true });
  writeFileSync(
    resolve(copiedCrate, "Cargo.toml"),
    readFileSync(resolve(copiedCrate, "Cargo.toml"), "utf8").replace(
      'path = "../../../../../rust-runtime/crates/tsonic_rust_runtime"',
      `path = "${tomlPath(runtimeCrate)}"`,
    ),
  );
  const project = createUserCargoProject({ dependencyPath: copiedCrate });
  const worker = createRustCompilerWorkerClient(uniquePath("worker-mutation"));
  const snapshot = worker.snapshot(project.manifestPath);
  const dependency = snapshot.dependencies.find(({ alias }) => alias === "widget_alias");
  assert.ok(dependency);
  appendFileSync(resolve(copiedCrate, "src/lib.rs"), "\n// mutation after immutable snapshot\n");

  assert.throws(
    () => worker.module({
      snapshot,
      dependency,
      foundation: "std",
      modulePath: [],
      requestedExports: ["Widget"],
    }),
    /changed after the compiler-provider snapshot was created/u,
  );
});

function createUserCargoProject({ dependencyPath = fixtureCrate } = {}) {
  const root = uniquePath("cargo-project");
  const generatedSource = resolve(root, "generated/src/main.rs");
  mkdirSync(dirname(generatedSource), { recursive: true });
  writeFileSync(generatedSource, "fn main() {}\n");
  const manifestPath = resolve(root, "Cargo.toml");
  writeFileSync(manifestPath, [
    "[package]",
    'name = "compiler-provider-proof"',
    'version = "0.1.0"',
    'edition = "2021"',
    "",
    "[lib]",
    'path = "generated/src/lib.rs"',
    "",
    "[[bin]]",
    'name = "compiler_provider_proof"',
    'path = "generated/src/main.rs"',
    "",
    "[dependencies]",
    `tsonic_rust_runtime = { path = "${tomlPath(runtimeCrate)}" }`,
    `widget_alias = { package = "acme-widget", path = "${tomlPath(dependencyPath)}", features = ["extras"] }`,
    "",
  ].join("\n"));
  return { root, manifestPath };
}

function writeGeneratedArtifacts(root, artifacts) {
  for (const artifact of artifacts) {
    const path = resolve(root, "generated", artifact.path);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, artifact.text);
  }
}

function createCargoCountingShim() {
  const realCargo = spawnSync("bash", ["-lc", "command -v cargo"], { encoding: "utf8" }).stdout.trim();
  assert.notEqual(realCargo, "");
  const directory = uniquePath("cargo-shim");
  const counterPath = resolve(directory, "commands.log");
  const executable = resolve(directory, "cargo");
  mkdirSync(directory, { recursive: true });
  writeFileSync(executable, [
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    `printf '%s\\n' \"\${1:-}\" >> '${shellText(counterPath)}'`,
    `exec '${shellText(realCargo)}' \"$@\"`,
    "",
  ].join("\n"));
  chmodSync(executable, 0o755);
  return { directory, counterPath };
}

function runCargo(manifestPath, arguments_) {
  return spawnSync("cargo", [...arguments_, "--manifest-path", manifestPath], {
    cwd: dirname(manifestPath),
    encoding: "utf8",
    env: { ...process.env, CARGO_BUILD_JOBS: process.env.CARGO_BUILD_JOBS ?? "2" },
    timeout: 300_000,
    maxBuffer: 16 * 1024 * 1024,
  });
}

function uniquePath(label) {
  const path = resolve(testRoot, `${label}-${process.pid}-${randomUUID()}`);
  mkdirSync(path, { recursive: true });
  return path;
}

function tomlPath(path) {
  return path.replaceAll("\\", "/").replaceAll('"', '\\"');
}

function shellText(text) {
  return text.replaceAll("'", "'\\''");
}
