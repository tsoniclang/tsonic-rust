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
  rustNamedTypeCarrierValue,
} from "../../../../dist/target-model/types/index.js";
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
      foundation: "std",
      modulePath: [],
      requestedExports: ["Widget"],
    });
    const widget = widgetModule.exports.find(({ name }) => name === "Widget");
    assert.equal(widget?.kind, "struct");
    const widgetTypeParameter = widget.genericParameters.find((parameter) =>
      parameter.kind === "type" && parameter.name === "T");
    assert.ok(widgetTypeParameter);
    const valueMethod = widget.methods.find(({ name }) => name === "value");
    assert.deepEqual(valueMethod?.borrowedResult, {
      sourceType: {
        kind: "generic",
        identity: widgetTypeParameter.identity,
        name: "T",
      },
      origin: { kind: "receiver" },
      conversion: "copy",
    });
    assert.deepEqual(valueMethod?.typeRequirements, [{
      kind: "type",
      identity: widgetTypeParameter.identity,
      name: "T",
      requirements: ["copy"],
      outlives: [],
      maybeSized: false,
    }]);
    assert.equal(
      widget.methods.find(({ name }) => name === "into_box_value")?.receiver?.kind,
      "custom",
    );
    const pinnedCount = widget.methods.find(({ name }) => name === "pinned_count");
    assert.equal(pinnedCount?.receiver?.kind, "custom");
    assert.equal(
      pinnedCount?.receiver?.kind === "custom" ? pinnedCount.receiver.type.kind : undefined,
      "path",
    );
    assert.equal(widget.unsupportedMembers.some(({ name }) => name === "pinned_count"), false);
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
      foundation: "std",
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
    const lifetimeModule = worker.module({
      snapshot,
      dependency,
      foundation: "std",
      modulePath: [],
      requestedExports: [
        "LifetimeView",
        "LendingValue",
        "apply_borrowed",
        "borrowed_owned_string",
        "borrowed_slice",
        "choose_borrowed",
        "constrained_lending",
        "inspect_view",
        "lending_value",
        "opaque_borrow",
        "pass_lending_item",
        "read_lending_value",
      ],
    });
    assert.deepEqual(lifetimeModule.unsupportedExports, []);

    const chooseBorrowed = lifetimeModule.exports.find(
      ({ name }) => name === "choose_borrowed",
    )?.function;
    assert.ok(chooseBorrowed);
    assert.deepEqual(
      chooseBorrowed.genericParameters.map(({ kind }) => kind),
      ["lifetime", "lifetime", "type", "const"],
    );
    const [shortLifetime, longLifetime, valueType, length] =
      chooseBorrowed.genericParameters;
    assert.equal(shortLifetime.kind, "lifetime");
    assert.equal(longLifetime.kind, "lifetime");
    assert.equal(valueType.kind, "type");
    assert.equal(length.kind, "const");
    assert.deepEqual(longLifetime.outlives, [shortLifetime.lifetime]);
    assert.deepEqual(valueType.outlives, [shortLifetime.lifetime]);
    assert.equal(valueType.maybeSized, true);
    assert.equal(chooseBorrowed.parameters[0].type.kind, "reference");
    assert.deepEqual(
      chooseBorrowed.parameters[0].type.lifetime,
      shortLifetime.lifetime,
    );
    assert.equal(chooseBorrowed.parameters[1].type.kind, "reference");
    assert.deepEqual(
      chooseBorrowed.parameters[1].type.lifetime,
      longLifetime.lifetime,
    );
    assert.equal(chooseBorrowed.result.kind, "reference");
    assert.deepEqual(chooseBorrowed.result.lifetime, shortLifetime.lifetime);

    const applyBorrowed = lifetimeModule.exports.find(
      ({ name }) => name === "apply_borrowed",
    )?.function;
    assert.equal(applyBorrowed?.parameters[0].type.kind, "function-pointer");
    const callback = applyBorrowed.parameters[0].type;
    assert.equal(callback.lifetimeBinder?.parameters.length, 1);
    const callbackLifetime = callback.lifetimeBinder.parameters[0].lifetime;
    assert.equal(callbackLifetime.kind, "bound");
    assert.deepEqual(callback.parameters[0].lifetime, callbackLifetime);
    assert.deepEqual(callback.result.lifetime, callbackLifetime);

    const lending = lifetimeModule.exports.find(
      ({ name }) => name === "pass_lending_item",
    )?.function;
    assert.equal(lending?.parameters[0].type.kind, "associated-type");
    assert.equal(lending?.result.kind, "associated-type");
    assert.equal(lending?.result.name, "Item");
    assert.equal(lending?.result.genericArguments[0].kind, "lifetime");
    const lendingFamily = lifetimeModule.exports.find(
      ({ name }) => name === "LendingFamily",
    );
    assert.equal(lendingFamily?.kind, "trait");
    const lendingItem = lendingFamily.associatedTypes.find(({ name }) => name === "Item");
    assert.equal(lendingItem?.genericParameters[0].kind, "lifetime");
    assert.deepEqual(
      lendingItem?.ownerOutlives,
      [lendingItem.genericParameters[0].lifetime],
    );
    assert.equal(lendingItem?.ownerMaybeSized, true);

    const inspectView = lifetimeModule.exports.find(
      ({ name }) => name === "inspect_view",
    )?.function;
    assert.equal(inspectView?.parameters[0].type.kind, "reference");
    assert.equal(inspectView?.parameters[0].type.target.kind, "trait-object");

    const opaqueBorrow = lifetimeModule.exports.find(
      ({ name }) => name === "opaque_borrow",
    )?.function;
    assert.equal(opaqueBorrow?.result.kind, "opaque");
    assert.equal(opaqueBorrow?.result.captures[0].kind, "lifetime");

    const borrowedOwnedString = lifetimeModule.exports.find(
      ({ name }) => name === "borrowed_owned_string",
    )?.function;
    assert.equal(borrowedOwnedString?.parameters[0].type.kind, "reference");
    assert.equal(borrowedOwnedString?.result.kind, "reference");
    assert.equal(borrowedOwnedString?.result.target.kind, "path");
    assert.equal(borrowedOwnedString?.borrowedResult, undefined);

    const borrowedSlice = lifetimeModule.exports.find(
      ({ name }) => name === "borrowed_slice",
    )?.function;
    assert.equal(borrowedSlice?.parameters[0].type.kind, "reference");
    assert.equal(borrowedSlice?.result.kind, "reference");
    assert.equal(borrowedSlice?.result.target.kind, "slice");
    assert.equal(borrowedSlice?.borrowedResult, undefined);

    const lifetimeProjection = projectRustCompilerModule(lifetimeModule, {
      providerModuleId: compilerProviderModuleId(dependency, []),
      moduleSpecifier: "@tsonic/rust/crates/widget_alias/index.js",
    });
    const chooseOperation = lifetimeProjection.operations.find(
      ({ exportId }) => exportId.endsWith("::choose_borrowed"),
    );
    assert.deepEqual(
      chooseOperation?.genericParameters?.map(({ kind }) => kind),
      ["lifetime", "lifetime", "type", "const"],
    );
    const projectedApplyBorrowed = lifetimeProjection.declarationModel.exports
      .find(({ name }) => name === "apply_borrowed")?.signatures?.[0];
    const projectedCallback = projectedApplyBorrowed?.parameters[0]?.type;
    assert.equal(projectedCallback?.kind, "function");
    assert.deepEqual(projectedCallback?.typeParameters?.map(({ name }) => name), ["a"]);
    assert.equal(projectedCallback?.parameters[0]?.type.exportName, "Ref");
    assert.equal(projectedCallback?.returnType?.exportName, "Ref");
    assert.equal(
      lifetimeProjection.declarationModel.imports.some(({ moduleSpecifier, namedImports }) =>
        moduleSpecifier === "@tsonic/core/types.js" &&
        namedImports.some(({ exportedName }) => exportedName === "FunctionPointer")),
      false,
      "higher-ranked source functions bind their lifetime in the source callable contract",
    );
    const lifetimeViewConstructor = lifetimeProjection.operations.find(({ exportId, operationKind }) =>
      exportId.endsWith("::LifetimeView") && operationKind === "constructor");
    assert.deepEqual(
      rustNamedTypeCarrierValue(lifetimeViewConstructor?.resultCarrier)?.traits,
      {
        implementations: [{ traitPath: "widget_alias::View", requirements: [] }],
      },
      "compiler trait evidence uses the exact Cargo target alias",
    );
    const constrainedLending = lifetimeProjection.operations.find(
      ({ exportId }) => exportId.endsWith("::constrained_lending"),
    );
    assert.deepEqual(
      constrainedLending?.typeRequirements?.map(({ name, requirements }) => ({
        name,
        requirements: requirements.map((requirement) =>
          typeof requirement === "string"
            ? requirement
            : {
                kind: requirement.kind,
                path: requirement.path,
                genericArguments: requirement.genericArguments,
              }),
      })),
      [{
        name: "F",
        requirements: [{
          kind: "trait",
          path: "widget_alias::LendingFamily",
          genericArguments: [],
        }],
      }],
    );
    const lendingOperation = lifetimeProjection.operations.find(
      ({ exportId }) => exportId.endsWith("::pass_lending_item"),
    );
    assert.equal(lendingOperation?.resultCarrier.kind, "associated-type");
    assert.equal(lendingOperation?.resultCarrier.genericArguments?.[0].kind, "lifetime");
    assert.equal(
      lifetimeProjection.operations.find(({ exportId }) =>
        exportId.endsWith("::borrowed_owned_string"))?.resultCarrier.kind,
      "reference",
    );
    assert.equal(
      lifetimeProjection.operations.find(({ exportId }) =>
        exportId.endsWith("::borrowed_slice"))?.resultCarrier.kind,
      "reference",
    );
    const closedFunctionModule = worker.module({
      snapshot,
      dependency,
      foundation: "std",
      modulePath: [],
      requestedExports: ["mode_code"],
    });
    assert.deepEqual(closedFunctionModule.exports.map(({ name }) => name), ["Mode", "mode_code"]);
    const explicitlyRequestedClosureModule = worker.module({
      snapshot,
      dependency,
      foundation: "std",
      modulePath: [],
      requestedExports: ["Mode", "mode_code"],
    });
    assert.deepEqual(
      explicitlyRequestedClosureModule.exports.map(({ name }) => name),
      ["Mode", "mode_code"],
      "an explicitly requested export is emitted once when another requested export also depends on it",
    );
    const structuredModule = worker.module({
      snapshot,
      dependency,
      foundation: "std",
      modulePath: [],
      requestedExports: ["StructuredMode"],
    });
    assert.deepEqual(structuredModule.exports.map(({ name }) => name), ["StructuredMode"]);
    assert.deepEqual(structuredModule.unsupportedExports, []);
    const structuredMode = structuredModule.exports.find(({ name }) => name === "StructuredMode");
    assert.deepEqual(
      structuredMode?.kind === "enum"
        ? structuredMode.variants.map(({ name, kind, fields }) => ({
            name,
            kind,
            fields: fields.map((field) => field.name),
          }))
        : undefined,
      [{ name: "Named", kind: "struct", fields: ["value"] }],
    );
    const structuredProjection = projectRustCompilerModule(structuredModule, {
      providerModuleId: compilerProviderModuleId(dependency, []),
      moduleSpecifier: "@tsonic/rust/crates/widget_alias/index.js",
    });
    assert.deepEqual(
      structuredProjection.operations.find(({ memberId }) =>
        memberId?.endsWith("::variant:Named"))?.target,
      {
        form: "struct-variant",
        path: "widget_alias::StructuredMode::Named",
        fields: ["value"],
      },
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
    assert.equal(cloned?.kind, "function");
    const clonedParameter = cloned.function.genericParameters.find((parameter) =>
      parameter.kind === "type" && parameter.name === "T");
    assert.ok(clonedParameter);
    assert.deepEqual(cloned.function.typeRequirements, [{
      kind: "type",
      identity: clonedParameter.identity,
      name: "T",
      requirements: ["clone"],
      outlives: [],
      maybeSized: false,
    }]);
    const copied = functionModule.exports.find(({ name }) => name === "copied");
    assert.equal(copied?.kind, "function");
    const copiedParameter = copied.function.genericParameters.find((parameter) =>
      parameter.kind === "type" && parameter.name === "T");
    assert.ok(copiedParameter);
    assert.deepEqual(copied.function.typeRequirements, [{
      kind: "type",
      identity: copiedParameter.identity,
      name: "T",
      requirements: ["copy"],
      outlives: [],
      maybeSized: false,
    }]);
    const projectedCopied = functionProjection.declarationModel.exports.find(
      ({ name }) => name === "copied",
    );
    assert.deepEqual(projectedCopied?.signatures?.[0]?.typeParameters, [{ name: "T" }]);
    assert.deepEqual(
      functionProjection.operations.find(({ exportId }) => exportId.endsWith("::copied"))
        ?.typeRequirements,
      [{ name: "T", requirements: ["copy"] }],
      "native Rust requirements remain target policy rather than TypeScript structural constraints",
    );
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
      foundation: "std",
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
      foundation: "std",
      modulePath: ["math"],
      requestedExports: ["triple"],
    });
    assert.deepEqual(nestedModule.exports.map(({ name }) => name), ["triple"]);

    const projection = projectRustCompilerModule(widgetModule, {
      providerModuleId: compilerProviderModuleId(dependency, []),
      moduleSpecifier: "@tsonic/rust/crates/widget_alias/index.js",
    });
    assert.equal(
      [...projection.carrierPaths.values()].includes("widget_alias::Widget"),
      true,
    );
    const projectedWidgetMembers = projection.declarationModel.exports
      .find(({ name }) => name === "Widget")?.members ?? [];
    assert.equal(
      projectedWidgetMembers.some(({ name }) => name === "pinned_count"),
      true,
      "a declaration-backed borrowed custom receiver remains callable",
    );
    assert.equal(
      projectedWidgetMembers.some(({ name }) => name === "measure"),
      true,
      "a supported associated-result method remains available",
    );
    assert.equal(
      projectedWidgetMembers.some(({ name }) => name === "SLOT"),
      false,
      "a trait constant and trait method occupying one source static slot are both omitted",
    );

    const openAssociatedType = worker.module({
      snapshot,
      dependency,
      foundation: "std",
      modulePath: [],
      requestedExports: ["pass_family_item"],
    });
    assert.equal(
      openAssociatedType.exports.some(({ name }) => name === "pass_family_item"),
      true,
    );
    assert.deepEqual(openAssociatedType.unsupportedExports, []);

    const advancedTypeModule = worker.module({
      snapshot,
      dependency,
      foundation: "std",
      modulePath: [],
      requestedExports: [
        "MixedFamily",
        "MixedValue",
        "NON_CLONE_STATIC",
        "first_mixed_item",
        "mixed_item",
        "opaque_mixed",
        "scalar_code",
        "scalar_smile",
      ],
    });
    assert.deepEqual(advancedTypeModule.unsupportedExports, []);
    const nonCloneStatic = advancedTypeModule.exports.find(
      ({ name }) => name === "NON_CLONE_STATIC",
    );
    assert.equal(nonCloneStatic?.kind, "static");
    assert.equal(nonCloneStatic?.copy, false);
    const scalarCode = advancedTypeModule.exports.find(
      ({ name }) => name === "scalar_code",
    );
    assert.equal(scalarCode?.kind, "function");
    assert.equal(scalarCode?.function.parameters[0].type.name, "char");
    const mixedItem = advancedTypeModule.exports.find(
      ({ name }) => name === "mixed_item",
    );
    assert.equal(mixedItem?.kind, "function");
    assert.equal(mixedItem?.function.result.kind, "associated-type");
    assert.deepEqual(
      mixedItem?.function.result.kind === "associated-type"
        ? mixedItem.function.result.genericArguments.map(({ kind }) => kind)
        : undefined,
      ["lifetime", "type", "const"],
    );
    const opaqueMixed = advancedTypeModule.exports.find(
      ({ name }) => name === "opaque_mixed",
    );
    assert.equal(opaqueMixed?.kind, "function");
    assert.equal(opaqueMixed?.function.result.kind, "opaque");
    assert.deepEqual(
      opaqueMixed?.function.result.kind === "opaque"
        ? opaqueMixed.function.result.captures.map(({ kind }) => kind)
        : undefined,
      ["lifetime", "type", "const"],
    );

    const advancedTypeProjection = projectRustCompilerModule(advancedTypeModule, {
      providerModuleId: compilerProviderModuleId(dependency, []),
      moduleSpecifier: "@tsonic/rust/crates/widget_alias/index.js",
    });
    const nonCloneOperation = advancedTypeProjection.operations.find(
      ({ exportId }) => exportId.endsWith("::NON_CLONE_STATIC"),
    );
    assert.deepEqual(nonCloneOperation?.target, {
      form: "reference-path",
      path: "widget_alias::NON_CLONE_STATIC",
      mutable: false,
    });
    assert.equal(nonCloneOperation?.resultCarrier.kind, "reference");
    const scalarOperation = advancedTypeProjection.operations.find(
      ({ exportId }) => exportId.endsWith("::scalar_code"),
    );
    assert.deepEqual(scalarOperation?.parameterCarriers, [{
      kind: "target-named",
      id: "rust.native.char",
    }]);
    const opaqueOperation = advancedTypeProjection.operations.find(
      ({ exportId }) => exportId.endsWith("::opaque_mixed"),
    );
    assert.deepEqual(
      opaqueOperation?.resultCarrier.kind === "impl-trait"
        ? opaqueOperation.resultCarrier.captures.map(({ kind }) => kind)
        : undefined,
      ["lifetime", "type", "const"],
    );

    const standardSnapshot = worker.standardSnapshot();
    const standardDependency = standardSnapshot.dependencies.find(({ alias }) => alias === "std");
    assert.ok(standardDependency);
    const collectionsModule = worker.module({
      snapshot: standardSnapshot,
      dependency: standardDependency,
      foundation: "std",
      modulePath: ["collections"],
      requestedExports: ["HashMap"],
    });
    const hashMap = collectionsModule.exports.find(({ name }) => name === "HashMap");
    assert.equal(hashMap?.kind, "struct");
    const hashMapTypeParameters = hashMap.genericParameters.filter(
      ({ kind }) => kind === "type",
    );
    assert.deepEqual(hashMapTypeParameters.map(({ name, defaultType }) => ({
      name,
      hasDefault: defaultType !== undefined,
    })), [
      { name: "K", hasDefault: false },
      { name: "V", hasDefault: false },
      { name: "S", hasDefault: true },
      { name: "A", hasDefault: true },
    ]);
    assert.ok(hashMap.methods.some(({ name }) => name === "new"));
    const hashMapGet = hashMap.methods.find(({ name }) => name === "get");
    assert.ok(hashMapGet);
    assert.ok(hashMapGet.typeRequirements.some(({ name, requirements }) =>
      name === "K" && requirements.some((requirement) =>
        typeof requirement === "object" &&
        requirement.kind === "trait" &&
        requirement.trait.path === "core::borrow::Borrow")));
    assert.ok(hashMapGet.typeRequirements.some(({ name, requirements }) =>
      name === "V" && requirements.includes("copy")));
    assert.equal(hashMapGet.borrowedResult?.conversion, "optional-copy");
    const hashMapProjection = projectRustCompilerModule(collectionsModule, {
      providerModuleId: compilerProviderModuleId(standardDependency, ["collections"]),
      moduleSpecifier: "@tsonic/rust/std/collections.js",
    });
    const projectedFromIterator = hashMapProjection.declarationModel.exports
      .find(({ name }) => name === "HashMap")?.members
      ?.find(({ name }) => name === "from_iter")?.signatures?.[0];
    assert.deepEqual(
      projectedFromIterator?.typeParameters?.map(({ name, defaultType }) => ({
        name,
        hasDefault: defaultType !== undefined,
      })),
      [
        { name: "K", hasDefault: false },
        { name: "V", hasDefault: false },
        { name: "S", hasDefault: false },
        { name: "A", hasDefault: false },
        { name: "T", hasDefault: false },
      ],
      "flattened static-call generics cannot retain owner defaults before callable parameters",
    );
    const projectedGet = hashMapProjection.declarationModel.exports
      .find(({ name }) => name === "HashMap")?.members
      ?.find(({ name }) => name === "get")?.signatures?.[0];
    assert.deepEqual(projectedGet?.returnType, {
      kind: "union",
      types: [
        { kind: "type-parameter", name: "V" },
        { kind: "undefined" },
      ],
    });
    const projectedGetOperation = hashMapProjection.operations.find(
      ({ memberId }) => memberId?.endsWith("::method:get"),
    );
    assert.equal(
      projectedGetOperation?.genericParameters
        ?.find(({ kind, sourceName }) => kind === "type" && sourceName === "Q")
        ?.maybeSized,
      true,
    );
    const projectedBorrowRequirement = projectedGetOperation?.typeRequirements
      ?.find(({ name }) => name === "K")?.requirements
      .find((requirement) =>
        typeof requirement === "object" &&
        requirement.path === "core::borrow::Borrow");
    assert.equal(projectedBorrowRequirement?.kind, "trait");
    assert.equal(projectedBorrowRequirement?.path, "core::borrow::Borrow");
    assert.deepEqual(projectedBorrowRequirement?.genericArguments, [{
      kind: "type",
      type: { kind: "type-parameter", name: "Q" },
    }]);
    const hashMapKeyParameter = hashMapTypeParameters.find(({ name }) => name === "K");
    const insertKeyRequirement = hashMap.methods
      .find(({ name }) => name === "insert")?.typeRequirements
      .find(({ name }) => name === "K");
    assert.deepEqual(insertKeyRequirement?.identity, hashMapKeyParameter?.identity);
    assert.deepEqual(
      insertKeyRequirement?.requirements.map(({ kind, trait }) => ({
        kind,
        path: trait.path,
        canonicalPath: trait.identity.canonicalPath,
        hasItemIdentity: trait.identity.itemId.length > 0,
      })),
      [
        {
          kind: "trait",
          path: "core::cmp::Eq",
          canonicalPath: ["core", "cmp", "Eq"],
          hasItemIdentity: true,
        },
        {
          kind: "trait",
          path: "core::hash::Hash",
          canonicalPath: ["core", "hash", "Hash"],
          hasItemIdentity: true,
        },
      ],
    );
    assert.deepEqual(insertKeyRequirement?.outlives, []);
    assert.equal(insertKeyRequirement?.maybeSized, false);
    assert.ok(hashMap.traits.implementations.some(({ trait, requirements }) =>
      trait.kind === "trait" && trait.trait.path === "core::cmp::Eq" &&
      requirements.some(({ typeArgumentIndex, requirement }) =>
        typeArgumentIndex === 0 && requirement.kind === "trait" &&
        requirement.trait.path === "core::hash::Hash")));
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
      foundation: "std",
      modulePath: ["ops"],
      requestedExports: ["ControlFlow"],
    });
    const opsProjection = projectRustCompilerModule(opsModule, {
      providerModuleId: compilerProviderModuleId(standardDependency, ["ops"]),
      moduleSpecifier: "@tsonic/rust/std/ops.js",
    });
    const controlFlow = opsProjection.declarationModel.exports.find(({ name }) => name === "ControlFlow");
    assert.deepEqual(controlFlow?.typeParameters, [
      { name: "B" },
      { name: "C", defaultType: { kind: "tuple", elementTypes: [] } },
    ]);
    assert.deepEqual(
      controlFlow?.members?.find(({ name }) => name === "Continue")?.signatures?.[0]?.parameters[0]?.type,
      { kind: "type-parameter", name: "C" },
      "a trailing Rust default remains an authored generic with its exact source default",
    );

    const vecModule = worker.module({
      snapshot: standardSnapshot,
      dependency: standardDependency,
      foundation: "std",
      modulePath: ["vec"],
      requestedExports: ["Vec"],
    });
    const vecProjection = projectRustCompilerModule(vecModule, {
      providerModuleId: compilerProviderModuleId(standardDependency, ["vec"]),
      moduleSpecifier: "@tsonic/rust/std/vec.js",
    });
    const boxedSliceConversion = vecProjection.operations.find(({ target }) =>
      target.form === "trait-call" && target.traitGenericArguments.some((argument) =>
        argument.kind === "type" && rustNamedTypeCarrierValue(argument.type)?.genericArguments.some((genericArgument) =>
          genericArgument.kind === "type" && genericArgument.type.kind === "slice")));
    assert.ok(boxedSliceConversion);
    assert.equal(
      boxedSliceConversion.target.form === "trait-call"
        ? boxedSliceConversion.target.traitGenericArguments[0]?.kind === "type" &&
            rustNamedTypeCarrierValue(
              boxedSliceConversion.target.traitGenericArguments[0].type,
            )?.genericArguments[0]?.kind === "type"
          ? rustNamedTypeCarrierValue(
              boxedSliceConversion.target.traitGenericArguments[0].type,
            )?.genericArguments[0].type.kind
          : undefined
        : undefined,
      "slice",
      "nested Rust slices remain unsized target types instead of becoming owned Vec carriers",
    );
    const projectedIntoIterator = vecProjection.declarationModel.exports
      .find(({ name }) => name === "IntoIter");
    assert.deepEqual(
      projectedIntoIterator?.members?.find(({ name }) => name === "try_fold")
        ?.signatures?.[0]?.typeParameters?.map(({ name }) => name),
      ["B", "R", "F"],
      "callable generic constraints are declared after every source-visible dependency",
    );
    const projectedVec = vecProjection.declarationModel.exports.find(({ name }) => name === "Vec");
    assert.deepEqual(
      projectedVec?.members?.find(({ name }) => name === "dedup_by_key")
        ?.signatures?.[0]?.typeParameters?.map(({ name }) => name),
      ["K", "F"],
      "later Rust callable dependencies move before the constrained source parameter",
    );

    const fmtModule = worker.module({
      snapshot: standardSnapshot,
      dependency: standardDependency,
      foundation: "std",
      modulePath: ["fmt"],
      requestedExports: ["Formatter", "Debug"],
    });
    const fmtProjection = projectRustCompilerModule(fmtModule, {
      providerModuleId: compilerProviderModuleId(standardDependency, ["fmt"]),
      moduleSpecifier: "@tsonic/rust/std/fmt.js",
    });
    assert.ok(fmtProjection.declarationModel.exports.some(({ name }) => name === "Formatter"));
    const formatterFill = fmtProjection.declarationModel.exports
      .find(({ name }) => name === "Formatter")?.members?.find(({ name }) => name === "fill");
    assert.equal(
      formatterFill?.signatures?.[0]?.returnType?.exportName,
      "scalar",
      "a reflected char result uses the exact declared scalar source carrier",
    );
    assert.deepEqual(
      fmtProjection.operations.find(({ memberId }) => memberId === formatterFill?.id)
        ?.resultCarrier,
      { kind: "target-named", id: "rust.native.char" },
      "a reflected char result retains the exact native Rust carrier",
    );

    const ioModule = worker.module({
      snapshot: standardSnapshot,
      dependency: standardDependency,
      foundation: "std",
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
      foundation: "std",
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
      foundation: "std",
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
