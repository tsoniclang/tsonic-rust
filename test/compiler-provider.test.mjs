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
import { createRustCompilerWorkerClient } from "../dist/providers/compiler/worker-client.js";
import {
  compilerProviderModuleId,
  projectRustCompilerModule,
} from "../dist/providers/compiler/projection.js";
import {
  rustCompilerProviderProtocolVersion,
} from "../dist/providers/compiler/model.js";
import {
  verifyRustCompilerStandardLibraryMetadata,
} from "../dist/providers/compiler/cargo-snapshot.js";
import {
  compileRustThroughTargetPack,
  createRustSession,
  rustSourceDiagnostics,
} from "./helpers/rust-session.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixtureCrate = resolve(repositoryRoot, "test/fixtures/crates/acme_widget");
const runtimeCrate = resolve(repositoryRoot, "../rust-runtime/crates/tsonic_rust_runtime");
const testRoot = resolve(repositoryRoot, ".temp/compiler-provider-tests");

test("compiler provider rejects Rust scalar char instead of conflating it with neutral UTF-16 char", () => {
  const module = {
    protocolVersion: rustCompilerProviderProtocolVersion,
    projectDigest: "char-contract",
    dependency: {
      alias: "char_contract",
      packageId: "char-contract 1.0.0",
      packageName: "char-contract",
      packageVersion: "1.0.0",
      crateName: "char_contract",
      targetCrateName: "char_contract",
      manifestPath: "/char-contract/Cargo.toml",
      sourceRoot: "/char-contract",
      sourceDigest: "char-contract",
      closurePackageIds: ["char-contract 1.0.0"],
      features: [],
    },
    modulePath: [],
    exports: [{
      kind: "function",
      id: "char_contract::identity",
      name: "identity",
      canonicalPath: ["char_contract", "identity"],
      targetPath: ["char_contract", "identity"],
      function: {
        id: "char_contract::identity",
        name: "identity",
        parameters: [{ name: "value", type: { kind: "primitive", name: "char" } }],
        result: { kind: "primitive", name: "char" },
        typeParameters: [],
        typeRequirements: [],
        asynchronous: false,
        unsafe: false,
        abi: "Rust",
        variadic: false,
      },
    }],
    unsupportedExports: [],
    standardTypeLocations: [],
  };

  assert.throws(
    () => projectRustCompilerModule(module, {
      providerModuleId: "char_contract",
      moduleSpecifier: "@tsonic/rust/crates/char_contract/index.js",
    }),
    /Rust primitive 'char' has no source primitive contract/u,
  );
});

test("compiler provider retains incomplete Rust enums as opaque native types", () => {
  const dependency = {
    alias: "opaque_enum",
    packageId: "opaque-enum 1.0.0",
    packageName: "opaque-enum",
    packageVersion: "1.0.0",
    crateName: "opaque_enum",
    targetCrateName: "opaque_enum",
    manifestPath: "/opaque-enum/Cargo.toml",
    sourceRoot: "/opaque-enum",
    sourceDigest: "opaque-enum",
    closurePackageIds: ["opaque-enum 1.0.0"],
    features: [],
  };
  const projection = projectRustCompilerModule({
    protocolVersion: rustCompilerProviderProtocolVersion,
    projectDigest: "opaque-enum",
    dependency,
    modulePath: [],
    exports: [{
      kind: "enum",
      id: "opaque_enum::Mode",
      name: "Mode",
      canonicalPath: ["opaque_enum", "Mode"],
      targetPath: ["opaque_enum", "Mode"],
      typeParameters: [],
      variantsComplete: false,
      variants: [],
      methods: [],
      associatedConstants: [],
      unsupportedMembers: [{ kind: "variant", name: "Hidden", reason: "stripped by rustdoc" }],
      traits: { implementations: [] },
    }],
    unsupportedExports: [],
    standardTypeLocations: [],
  }, {
    providerModuleId: "opaque-enum",
    moduleSpecifier: "@tsonic/rust/crates/opaque_enum/index.js",
  });

  assert.deepEqual(
    projection.declarationModel.exports.map(({ kind, name }) => ({ kind, name })),
    [{ kind: "class", name: "Mode" }],
  );
  assert.deepEqual(projection.operations, []);
  assert.deepEqual([...projection.carrierPaths.values()], ["opaque_enum::Mode"]);
});

test("standard-library metadata snapshots fail closed after exact artifact mutation", () => {
  const root = uniquePath("standard-metadata");
  const artifactPath = resolve(root, "libstd-proof.rmeta");
  mkdirSync(root, { recursive: true });
  writeFileSync(artifactPath, "original");
  const artifactStat = statSync(artifactPath);
  const snapshot = {
    kind: "standard-library",
    metadataArtifacts: [{
      crateName: "std",
      path: artifactPath,
      byteLength: artifactStat.size,
      modifiedMilliseconds: artifactStat.mtimeMs,
      digest: "not-consumed-by-mutation-check",
    }],
  };
  verifyRustCompilerStandardLibraryMetadata(snapshot);
  writeFileSync(artifactPath, "mutated metadata");
  assert.throws(
    () => verifyRustCompilerStandardLibraryMetadata(snapshot),
    /changed after the compiler-provider snapshot was created/u,
  );
});

test("compiler worker reflects exact Cargo and standard-library snapshots once per session", { timeout: 300_000 }, () => {
  const project = createUserCargoProject();
  const workerRoot = uniquePath("worker-cache");
  const shim = createCargoCountingShim();
  const originalPath = process.env.PATH;
  process.env.PATH = `${shim.directory}:${originalPath ?? ""}`;
  try {
    const worker = createRustCompilerWorkerClient(workerRoot);
    const snapshot = worker.snapshot(project.manifestPath);
    const dependency = snapshot.dependencies.find(({ alias }) => alias === "widget_alias");
    assert.ok(dependency);
    assert.equal(dependency.packageName, "acme-widget");
    assert.equal(dependency.targetCrateName, "widget_alias");
    assert.deepEqual(dependency.features, ["default", "extras"]);
    assert.ok(dependency.closurePackageIds.includes(dependency.packageId));

    const widgetModule = worker.module({
      snapshot,
      dependency,
      modulePath: [],
      requestedExports: ["Widget"],
    });
    const widget = widgetModule.exports.find(({ name }) => name === "Widget");
    assert.equal(widget?.kind, "struct");
    const valueMethod = widget.methods.find(({ name }) => name === "value");
    assert.deepEqual(valueMethod?.borrowedResult, {
      sourceType: { kind: "generic", name: "T" },
      origin: { kind: "receiver" },
      conversion: "copy",
    });
    assert.deepEqual(valueMethod?.typeRequirements, [{ name: "T", requirements: ["copy"] }]);
    assert.equal(
      widget.methods.find(({ name }) => name === "into_box_value")?.receiver?.kind,
      "custom",
    );
    assert.ok(widget.methods.some(({ name, traitDispatch }) =>
      name === "measure" && traitDispatch?.path === "acme_widget::Metric"));
    assert.ok(widget.methods.some(({ name, traitDispatch }) =>
      name === "reset" && traitDispatch?.path === "acme_widget::Metric"));
    assert.ok(widget.methods.some(({ name, traitDispatch }) =>
      name === "from_metric" && traitDispatch?.path === "acme_widget::Metric"));
    assert.deepEqual(
      widget.associatedConstants.map(({ name, traitDispatch }) => ({ name, trait: traitDispatch.path })),
      [
        { name: "SLOT", trait: "acme_widget::ConstantSlot" },
        { name: "UNIT", trait: "acme_widget::Metric" },
      ],
    );

    const functionModule = worker.module({
      snapshot,
      dependency,
      modulePath: [],
      requestedExports: [
        "ANSWER",
        "CheckedWidget",
        "GLOBAL_COUNT",
        "MUTABLE_COUNT",
        "Mode",
        "NumberBits",
        "Pair",
        "SimpleMode",
        "apply",
        "borrowed_answer",
        "borrowed_label",
        "byte_ptr",
        "checked_double",
        "cloned",
        "copied",
        "dangerous",
        "double",
        "featured",
        "fill",
        "first_byte",
        "integer_bits",
        "integer_format",
        "mode_code",
        "pair_sum",
        "simple_mode_code",
        "sum",
        "variadic_printf",
      ],
    });
    assert.deepEqual(
      functionModule.exports.map(({ name }) => name),
      [
        "ANSWER",
        "CheckedWidget",
        "GLOBAL_COUNT",
        "MUTABLE_COUNT",
        "Mode",
        "NumberBits",
        "Pair",
        "SimpleMode",
        "apply",
        "borrowed_answer",
        "borrowed_label",
        "byte_ptr",
        "checked_double",
        "cloned",
        "copied",
        "dangerous",
        "double",
        "featured",
        "fill",
        "first_byte",
        "integer_bits",
        "integer_format",
        "mode_code",
        "pair_sum",
        "simple_mode_code",
        "sum",
        "variadic_printf",
      ],
    );
    assert.equal(functionModule.exports.find(({ name }) => name === "ANSWER")?.kind, "constant");
    assert.equal(functionModule.exports.find(({ name }) => name === "GLOBAL_COUNT")?.kind, "static");
    assert.equal(functionModule.exports.find(({ name }) => name === "Pair")?.kind, "type-alias");
    assert.deepEqual(
      functionModule.exports.find(({ name }) => name === "Mode")?.variants.map(({ name, kind }) => ({ name, kind })),
      [
        { name: "Payload", kind: "tuple" },
        { name: "Read", kind: "plain" },
        { name: "Write", kind: "plain" },
      ],
    );
    assert.deepEqual(
      functionModule.exports.find(({ name }) => name === "pair_sum")?.function.parameters[0].type,
      {
        kind: "tuple",
        elements: [
          { kind: "primitive", name: "i32" },
          { kind: "primitive", name: "i32" },
        ],
      },
    );
    assert.deepEqual(
      functionModule.exports.find(({ name }) => name === "apply")?.function.parameters[1].type,
      {
        kind: "function-pointer",
        parameters: [{ kind: "primitive", name: "i32" }],
        result: { kind: "primitive", name: "i32" },
        abi: "Rust",
        unsafe: false,
      },
    );
    const closedFunctionModule = worker.module({
      snapshot,
      dependency,
      modulePath: [],
      requestedExports: ["mode_code"],
    });
    assert.deepEqual(closedFunctionModule.exports.map(({ name }) => name), ["Mode", "mode_code"]);
    const explicitlyRequestedClosureModule = worker.module({
      snapshot,
      dependency,
      modulePath: [],
      requestedExports: ["Mode", "mode_code"],
    });
    assert.deepEqual(
      explicitlyRequestedClosureModule.exports.map(({ name }) => name),
      ["Mode", "mode_code"],
      "an explicitly requested export is emitted once when another requested export also depends on it",
    );
    const unsupportedModule = worker.module({
      snapshot,
      dependency,
      modulePath: [],
      requestedExports: ["StructuredMode"],
    });
    assert.deepEqual(unsupportedModule.exports.map(({ name }) => name), ["StructuredMode"]);
    assert.deepEqual(unsupportedModule.unsupportedExports, []);
    assert.match(
      unsupportedModule.exports.find(({ name }) => name === "StructuredMode")?.unsupportedMembers
        .find(({ name }) => name === "Named")?.reason ?? "",
      /struct payload/u,
    );
    const dangerous = functionModule.exports.find(({ name }) => name === "dangerous");
    assert.equal(dangerous?.kind, "function");
    assert.equal(dangerous.function.unsafe, true);
    const firstByte = functionModule.exports.find(({ name }) => name === "first_byte");
    assert.equal(firstByte?.kind, "function");
    assert.deepEqual(firstByte.function.parameters[0].type, {
      kind: "raw-pointer",
      mutable: false,
      target: { kind: "primitive", name: "u8" },
    });
    const functionProjection = projectRustCompilerModule(functionModule, {
      providerModuleId: compilerProviderModuleId(dependency, []),
      moduleSpecifier: "@tsonic/rust/crates/widget_alias/index.js",
    });
    const firstByteOperation = functionProjection.operations.find(
      ({ exportId }) => exportId.endsWith("::first_byte"),
    );
    assert.equal(firstByteOperation?.isUnsafe, true);
    assert.deepEqual(firstByteOperation?.parameterCarriers, [{
      kind: "pointer",
      pointee: { kind: "source-primitive", name: "uint8" },
      mutability: "const",
    }]);
    const mutableStaticOperations = functionProjection.operations.filter(
      ({ exportId }) => exportId.endsWith("::MUTABLE_COUNT"),
    );
    assert.deepEqual(
      mutableStaticOperations.map(({ operationKind, target, isUnsafe }) => ({ operationKind, target, isUnsafe })),
      [
        { operationKind: "property", target: { form: "static", path: "widget_alias::MUTABLE_COUNT" }, isUnsafe: true },
        { operationKind: "property-set", target: { form: "static", path: "widget_alias::MUTABLE_COUNT" }, isUnsafe: true },
      ],
    );
    const numberBits = functionModule.exports.find(({ name }) => name === "NumberBits");
    assert.equal(numberBits?.kind, "union");
    assert.deepEqual(numberBits?.fields.map(({ name }) => name), ["float", "integer"]);
    const variadic = functionProjection.operations.find(
      ({ exportId }) => exportId.endsWith("::variadic_printf"),
    );
    assert.deepEqual(variadic?.target, {
      form: "call-c-variadic",
      path: "widget_alias::variadic_printf",
      fixedArgumentModes: ["value"],
    });
    assert.equal(variadic?.isUnsafe, true);
    const borrowedAnswer = functionModule.exports.find(({ name }) => name === "borrowed_answer");
    assert.deepEqual(borrowedAnswer?.kind === "function" ? borrowedAnswer.function.borrowedResult : undefined, {
      sourceType: { kind: "primitive", name: "i32" },
      origin: { kind: "parameter", index: 0 },
      conversion: "copy",
    });
    const borrowedLabel = functionModule.exports.find(({ name }) => name === "borrowed_label");
    assert.deepEqual(borrowedLabel?.kind === "function" ? borrowedLabel.function.borrowedResult : undefined, {
      sourceType: { kind: "primitive", name: "str" },
      origin: { kind: "static" },
      conversion: "owned-string",
    });
    const cloned = functionModule.exports.find(({ name }) => name === "cloned");
    assert.deepEqual(cloned?.kind === "function" ? cloned.function.typeRequirements : undefined, [{
      name: "T",
      requirements: ["clone"],
    }]);
    const copied = functionModule.exports.find(({ name }) => name === "copied");
    assert.deepEqual(copied?.kind === "function" ? copied.function.typeRequirements : undefined, [{
      name: "T",
      requirements: ["copy"],
    }]);
    const checkedDoubleOperation = functionProjection.operations.find(
      ({ exportId }) => exportId.endsWith("::checked_double"),
    );
    assert.equal(checkedDoubleOperation?.isFallible, true);
    assert.deepEqual(checkedDoubleOperation?.resultCarrier, {
      kind: "source-primitive",
      name: "int32",
    });
    const checkedWidgetConstructor = functionProjection.operations.find(
      ({ exportId, operationKind }) => exportId.endsWith("::CheckedWidget") && operationKind === "constructor",
    );
    assert.equal(checkedWidgetConstructor?.isFallible, true);
    const genericFactoryModule = worker.module({
      snapshot,
      dependency,
      modulePath: [],
      requestedExports: ["GenericFactory"],
    });
    const genericFactoryProjection = projectRustCompilerModule(genericFactoryModule, {
      providerModuleId: compilerProviderModuleId(dependency, []),
      moduleSpecifier: "@tsonic/rust/crates/widget_alias/index.js",
    });
    const genericFactoryNew = genericFactoryProjection.declarationModel.exports
      .find(({ name }) => name === "GenericFactory")?.members?.find(({ name }) => name === "new");
    assert.equal(genericFactoryNew?.kind, "method");
    assert.equal(genericFactoryNew?.static, true);
    assert.deepEqual(genericFactoryNew?.signatures?.[0]?.typeParameters, [{ name: "T" }]);
    assert.deepEqual(
      functionProjection.declarationModel.imports,
      [
        {
          moduleSpecifier: "@tsonic/core/types.js",
          namedImports: [{ exportedName: "FunctionPointer" }],
        },
        {
          moduleSpecifier: "@tsonic/rust/types.js",
          namedImports: [{ exportedName: "constPtr" }],
        },
      ],
    );
    const nestedModule = worker.module({
      snapshot,
      dependency,
      modulePath: ["math"],
      requestedExports: ["triple"],
    });
    assert.deepEqual(nestedModule.exports.map(({ name }) => name), ["triple"]);

    const projection = projectRustCompilerModule(widgetModule, {
      providerModuleId: compilerProviderModuleId(dependency, []),
      moduleSpecifier: "@tsonic/rust/crates/widget_alias/index.js",
    });
    assert.match(projection.carrierPaths.values().next().value, /^widget_alias::Widget$/u);
    assert.equal(
      projection.declarationModel.exports.find(({ name }) => name === "Widget")?.members
        ?.some(({ name }) => name === "SLOT"),
      false,
      "a trait constant and trait method occupying one source static slot are both omitted",
    );

    const unsupportedBorrowedResult = worker.module({
      snapshot,
      dependency,
      modulePath: [],
      requestedExports: ["borrowed_owned_string"],
    });
    assert.match(
      unsupportedBorrowedResult.unsupportedExports.find(({ name }) =>
        name === "borrowed_owned_string")?.reason ?? "",
      /borrowed or unsized value with no closed target carrier/u,
    );

    const standardSnapshot = worker.standardSnapshot();
    const standardDependency = standardSnapshot.dependencies.find(({ alias }) => alias === "std");
    assert.ok(standardDependency);
    const collectionsModule = worker.module({
      snapshot: standardSnapshot,
      dependency: standardDependency,
      modulePath: ["collections"],
      requestedExports: ["HashMap"],
    });
    const hashMap = collectionsModule.exports.find(({ name }) => name === "HashMap");
    assert.equal(hashMap?.kind, "struct");
    assert.deepEqual(hashMap.typeParameters.map(({ name, defaultType }) => ({
      name,
      hasDefault: defaultType !== undefined,
    })), [
      { name: "K", hasDefault: false },
      { name: "V", hasDefault: false },
      { name: "S", hasDefault: true },
      { name: "A", hasDefault: true },
    ]);
    assert.ok(hashMap.methods.some(({ name }) => name === "new"));
    assert.deepEqual(
      hashMap.methods.find(({ name }) => name === "insert")?.typeRequirements,
      [{
        name: "K",
        requirements: [
          { kind: "trait", path: "core::cmp::Eq" },
          { kind: "trait", path: "core::hash::Hash" },
        ],
      }],
    );
    assert.ok(hashMap.traits.implementations.some(({ trait, requirements }) =>
      trait.kind === "trait" && trait.path === "core::cmp::Eq" &&
      requirements.some(({ typeArgumentIndex, requirement }) =>
        typeArgumentIndex === 0 && requirement.kind === "trait" && requirement.path === "core::hash::Hash")));
    const collectionsProjection = projectRustCompilerModule(collectionsModule, {
      providerModuleId: compilerProviderModuleId(standardDependency, ["collections"]),
      moduleSpecifier: "@tsonic/rust/std/collections.js",
    });
    const projectedHashMap = collectionsProjection.declarationModel.exports.find(({ name }) => name === "HashMap");
    assert.equal(
      projectedHashMap?.members?.find(({ name }) => name === "extend_one")?.signatures?.[0]?.parameters[0]?.name,
      "argument0",
      "Rust destructuring patterns become deterministic positional source parameter names",
    );

    const opsModule = worker.module({
      snapshot: standardSnapshot,
      dependency: standardDependency,
      modulePath: ["ops"],
      requestedExports: ["ControlFlow"],
    });
    const opsProjection = projectRustCompilerModule(opsModule, {
      providerModuleId: compilerProviderModuleId(standardDependency, ["ops"]),
      moduleSpecifier: "@tsonic/rust/std/ops.js",
    });
    const controlFlow = opsProjection.declarationModel.exports.find(({ name }) => name === "ControlFlow");
    assert.deepEqual(controlFlow?.typeParameters, [{ name: "B" }]);
    assert.deepEqual(
      controlFlow?.members?.find(({ name }) => name === "Continue")?.signatures?.[0]?.parameters[0]?.type,
      { kind: "tuple", elementTypes: [] },
      "a hidden trailing Rust default parameter is substituted with its exact default source type",
    );

    const vecModule = worker.module({
      snapshot: standardSnapshot,
      dependency: standardDependency,
      modulePath: ["vec"],
      requestedExports: ["Vec"],
    });
    const vecProjection = projectRustCompilerModule(vecModule, {
      providerModuleId: compilerProviderModuleId(standardDependency, ["vec"]),
      moduleSpecifier: "@tsonic/rust/std/vec.js",
    });
    const boxedSliceConversion = vecProjection.operations.find(({ target }) =>
      target.form === "trait-call" && target.traitTypeArguments.some((argument) =>
        argument.kind === "target-named" && argument.typeArguments?.some(({ kind }) => kind === "slice")));
    assert.ok(boxedSliceConversion);
    assert.equal(
      boxedSliceConversion.target.form === "trait-call"
        ? boxedSliceConversion.target.traitTypeArguments[0]?.typeArguments?.[0]?.kind
        : undefined,
      "slice",
      "nested Rust slices remain unsized target types instead of becoming owned Vec carriers",
    );

    const ioModule = worker.module({
      snapshot: standardSnapshot,
      dependency: standardDependency,
      modulePath: ["io"],
      requestedExports: ["ErrorKind"],
    });
    const errorKind = ioModule.exports.find(({ name }) => name === "ErrorKind");
    assert.equal(errorKind?.kind, "enum");
    assert.equal(errorKind.variantsComplete, false);
    assert.deepEqual(errorKind.variants, []);
    const ioProjection = projectRustCompilerModule(ioModule, {
      providerModuleId: compilerProviderModuleId(standardDependency, ["io"]),
      moduleSpecifier: "@tsonic/rust/std/io.js",
    });
    assert.deepEqual(
      ioProjection.declarationModel.exports.map(({ kind, name }) => ({ kind, name })),
      [{ kind: "class", name: "ErrorKind" }],
    );

    const cargoCommands = readFileSync(shim.counterPath, "utf8").trim().split("\n");
    assert.equal(cargoCommands.filter((command) => command === "metadata").length, 2);
    assert.equal(
      cargoCommands.filter((command) => command === "rustdoc").length,
      4,
      "the Cargo dependency and each required std/core/alloc rustdoc document are generated once",
    );
  } finally {
    process.env.PATH = originalPath;
  }
});

test("compiler worker replaces a corrupt rustdoc cache artifact from its immutable snapshot", { timeout: 300_000 }, () => {
  const project = createUserCargoProject();
  const workerRoot = uniquePath("worker-corrupt-cache");
  const shim = createCargoCountingShim();
  const originalPath = process.env.PATH;
  process.env.PATH = `${shim.directory}:${originalPath ?? ""}`;
  try {
    const worker = createRustCompilerWorkerClient(workerRoot);
    const snapshot = worker.snapshot(project.manifestPath);
    const dependency = snapshot.dependencies.find(({ alias }) => alias === "widget_alias");
    assert.ok(dependency);
    const first = worker.module({
      snapshot,
      dependency,
      modulePath: [],
      requestedExports: ["Widget"],
    });
    assert.deepEqual(first.exports.map(({ name }) => name), ["Widget"]);

    const artifactPath = resolve(
      workerRoot,
      "cargo",
      snapshot.digest,
      dependency.sourceDigest,
      "doc",
      `${dependency.crateName.replace(/-/gu, "_")}.json`,
    );
    writeFileSync(artifactPath, "{corrupt rustdoc cache");

    const recovered = worker.module({
      snapshot,
      dependency,
      modulePath: [],
      requestedExports: ["Widget"],
    });
    assert.deepEqual(recovered.exports.map(({ name }) => name), ["Widget"]);
    assert.doesNotThrow(() => JSON.parse(readFileSync(artifactPath, "utf8")));
    const cargoCommands = readFileSync(shim.counterPath, "utf8").trim().split("\n");
    assert.equal(
      cargoCommands.filter((command) => command === "rustdoc").length,
      5,
      "the recovered Cargo document is regenerated while its exact standard-library closure remains cached",
    );
  } finally {
    process.env.PATH = originalPath;
  }
});

test("Cargo provider virtual imports compile, execute, and preserve the user-owned manifest", { timeout: 300_000 }, () => {
  const project = createUserCargoProject();
  const source = `
import type { int32 } from "@tsonic/core/types.js";
import type { FunctionPointer } from "@tsonic/core/types.js";
import { unsafeContext } from "@tsonic/core/lang.js";
import type { constPtr, i8, mutPtr, u8 } from "@tsonic/rust/types.js";
import { Box } from "@tsonic/rust/std/boxed.js";
import type { Pair } from "@tsonic/rust/crates/widget_alias/index.js";
import { ANSWER, CheckedWidget, GenericFactory, GLOBAL_COUNT, MUTABLE_COUNT, Mode, NumberBits, SimpleMode, Widget, apply, borrowed_answer, borrowed_label, byte_ptr, checked_double, cloned, copied, dangerous, double, duplicate, featured, fill, first_byte, identity, integer_bits, integer_format, maybe_positive, mode_code, pair_sum, simple_mode_code, singleton_map, sum, variadic_printf } from "@tsonic/rust/crates/widget_alias/index.js";
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
  assert.match(result.artifacts.find(({ path }) => path === "src/index.rs")?.text ?? "", /\*widget_alias::borrowed_answer\(&18\)/u);
  assert.match(result.artifacts.find(({ path }) => path === "src/index.rs")?.text ?? "", /let owned_borrowed_label: String = String::from\(widget_alias::borrowed_label\(\)\);/u);
  assert.match(result.artifacts.find(({ path }) => path === "src/index.rs")?.text ?? "", /widget_alias::borrowed_label\(\) != "widget"/u);
  assert.match(result.artifacts.find(({ path }) => path === "src/index.rs")?.text ?? "", /widget_alias::Widget::into_box_value\(boxed\)/u);
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
    () => worker.module({ snapshot, dependency, modulePath: [], requestedExports: ["Widget"] }),
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
