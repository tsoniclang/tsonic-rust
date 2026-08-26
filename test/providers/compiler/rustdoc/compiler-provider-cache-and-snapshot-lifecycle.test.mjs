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
    assert.equal(
      widget.methods.find(({ name }) => name === "pinned_count")?.receiver?.kind,
      "custom",
    );
    assert.equal(
      widget.unsupportedMembers.find(({ name }) => name === "pinned_count"),
      undefined,
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
    const semanticModule = worker.module({
      snapshot,
      dependency,
      modulePath: [],
      requestedExports: [
        "AlignedRecord",
        "BorrowedPair",
        "BorrowedValue",
        "CRecord",
        "FirstSameName",
        "FixedBuffer",
        "GenericEvidence",
        "Handler",
        "LendingFamily",
        "PackedRecord",
        "SecondSameName",
        "TransparentValue",
        "Trusted",
        "TrustedToken",
        "apply_borrowed",
        "apply_generic_pointer",
        "choose_borrowed",
        "invoke_handler",
        "repeat_label",
        "require_fn",
        "require_fn_mut",
        "require_fn_once",
        "require_local_future",
        "require_send_static_future",
      ],
    });
    assert.deepEqual(semanticModule.unsupportedExports, []);
    const semanticExport = (name) => {
      const selected = semanticModule.exports.find((candidate) => candidate.name === name);
      assert.ok(selected, `missing reflected semantic export ${name}`);
      return selected;
    };
    const borrowedPair = semanticExport("BorrowedPair");
    assert.equal(borrowedPair.kind, "type-alias");
    assert.deepEqual(borrowedPair.generics.parameters.map(({ kind }) => kind), ["lifetime", "type"]);
    assert.equal(borrowedPair.type.kind, "tuple");
    assert.deepEqual(borrowedPair.type.elements.map(({ kind }) => kind), ["reference", "reference"]);
    assert.deepEqual(
      borrowedPair.type.elements.map(({ lifetime }) => lifetime),
      [
        borrowedPair.generics.parameters[0].identity,
        borrowedPair.generics.parameters[0].identity,
      ],
    );

    const fixedBuffer = semanticExport("FixedBuffer");
    assert.equal(fixedBuffer.kind, "struct");
    assert.deepEqual(fixedBuffer.generics.parameters.map(({ kind }) => kind), ["type", "const"]);
    assert.deepEqual(fixedBuffer.generics.parameters[1].defaultValue, {
      kind: "literal",
      literalKind: "integer",
      value: 4n,
    });
    assert.equal(fixedBuffer.fields[0].type.kind, "array");
    assert.deepEqual(
      fixedBuffer.fields[0].type.length,
      {
        kind: "parameter",
        identity: fixedBuffer.generics.parameters[1].identity,
        displayName: "N",
      },
    );

    const borrowedValue = semanticExport("BorrowedValue");
    assert.equal(borrowedValue.kind, "struct");
    assert.deepEqual(borrowedValue.generics.parameters.map(({ kind }) => kind), ["lifetime", "type"]);
    assert.ok(borrowedValue.generics.parameters[1].bounds.some((bound) =>
      bound.kind === "trait" && bound.polarity === "maybe"));
    assert.ok(borrowedValue.generics.parameters[1].bounds.some((bound) =>
      bound.kind === "type-outlives"));

    const genericEvidence = semanticExport("GenericEvidence");
    assert.equal(genericEvidence.kind, "struct");
    assert.deepEqual(genericEvidence.generics.parameters.map(({ kind }) => kind), [
      "lifetime",
      "type",
      "const",
    ]);
    const traitImplementation = (path) => genericEvidence.traits.implementations.find(({ trait }) =>
      trait.identity.canonicalPath.join("::") === path);
    const mixedEvidence = traitImplementation("acme_widget::MixedEvidence");
    assert.ok(mixedEvidence);
    assert.deepEqual(
      mixedEvidence.genericBindings.map(({ genericArgumentIndex, parameter }) => ({
        genericArgumentIndex,
        kind: parameter.kind,
      })),
      [
        { genericArgumentIndex: 0, kind: "lifetime" },
        { genericArgumentIndex: 1, kind: "type" },
        { genericArgumentIndex: 2, kind: "const" },
      ],
    );
    assert.deepEqual(mixedEvidence.trait.arguments.map(({ kind }) => kind), [
      "lifetime",
      "type",
      "const",
    ]);
    const cloneEvidence = traitImplementation("acme_widget::CloneEvidence");
    assert.ok(cloneEvidence?.requirements.some(({ genericArgumentIndex, bound }) =>
      genericArgumentIndex === 1 && bound.kind === "trait" &&
      bound.polarity === "required" &&
      bound.trait.identity.canonicalPath.join("::") === "core::clone::Clone"));
    const higherRankedEvidence = traitImplementation("acme_widget::HigherRankedEvidence");
    assert.equal(higherRankedEvidence?.requirements[0]?.bound.kind, "trait");
    assert.equal(higherRankedEvidence?.requirements[0]?.bound.binder?.lifetimes.length, 1);
    const iteratorEvidence = traitImplementation("acme_widget::IteratorEvidence");
    const iteratorBound = iteratorEvidence?.requirements[0]?.bound;
    assert.equal(iteratorBound?.kind, "trait");
    assert.equal(iteratorBound?.kind === "trait"
      ? iteratorBound.trait.associatedConstraints.some(({ kind }) => kind === "equality")
      : false, true);
    assert.equal(traitImplementation("acme_widget::StaticOnlyEvidence"), undefined);
    assert.equal(traitImplementation("acme_widget::SpecializedEvidence"), undefined);

    assert.deepEqual(semanticExport("CRecord").layout, {
      representation: "c",
    });
    assert.deepEqual(semanticExport("TransparentValue").layout, {
      representation: "transparent",
    });
    assert.deepEqual(semanticExport("AlignedRecord").layout, {
      representation: "c",
      alignment: { kind: "literal", literalKind: "integer", value: 16n },
    });
    assert.deepEqual(semanticExport("PackedRecord").layout, {
      representation: "c",
      packed: { kind: "literal", literalKind: "integer", value: 2n },
    });

    const lendingFamily = semanticExport("LendingFamily");
    assert.equal(lendingFamily.kind, "trait");
    const lendingItem = lendingFamily.associatedTypes.find(({ name }) => name === "Item");
    assert.deepEqual(lendingItem?.generics.parameters.map(({ kind }) => kind), ["lifetime", "type"]);
    assert.ok(lendingItem?.generics.wherePredicates.some((predicate) =>
      predicate.kind === "type" || predicate.kind === "lifetime"));

    const trusted = semanticExport("Trusted");
    assert.equal(trusted.kind, "trait");
    assert.equal(trusted.safety, "unsafe");
    assert.equal(trusted.implementationItemsRequired, false);
    const trustedToken = semanticExport("TrustedToken");
    assert.equal(trustedToken.kind, "struct");
    assert.ok(trustedToken.traits.implementations.some(({ trait }) =>
      trait.identity.itemId === trusted.identity.itemId));

    const chooseBorrowed = semanticExport("choose_borrowed");
    assert.equal(chooseBorrowed.kind, "function");
    assert.deepEqual(chooseBorrowed.function.generics.parameters.map(({ kind }) => kind), [
      "lifetime",
      "lifetime",
      "type",
    ]);
    assert.ok(chooseBorrowed.function.generics.wherePredicates.some((predicate) =>
      predicate.kind === "lifetime"));

    const applyBorrowed = semanticExport("apply_borrowed");
    assert.equal(applyBorrowed.kind, "function");
    const callbackPredicate = applyBorrowed.function.generics.wherePredicates.find((predicate) =>
      predicate.kind === "type" && predicate.bounds.some((bound) => bound.kind === "trait"));
    const callbackBound = callbackPredicate?.kind === "type"
      ? callbackPredicate.bounds.find((bound) => bound.kind === "trait")
      : undefined;
    assert.equal(callbackBound?.kind, "trait");
    assert.equal(callbackBound?.kind === "trait" ? callbackBound.binder?.lifetimes.length : undefined, 1);

    const invokeHandler = semanticExport("invoke_handler");
    assert.equal(invokeHandler.kind, "function");
    const handlerReference = invokeHandler.function.parameters[0].type;
    assert.equal(handlerReference.kind, "reference");
    assert.equal(handlerReference.target.kind, "trait-object");
    assert.equal(handlerReference.target.principal.identity.itemId, semanticExport("Handler").identity.itemId);
    assert.deepEqual(
      handlerReference.target.autoTraits.map(({ displayPath }) => displayPath.at(-1)).sort(),
      ["Send", "Sync"],
    );

    const opaqueResult = semanticExport("repeat_label");
    assert.equal(opaqueResult.kind, "function");
    assert.equal(opaqueResult.function.result.kind, "opaque");
    assert.ok(opaqueResult.function.result.captures.some((argument) => argument.kind === "lifetime"));

    const functionPointer = semanticExport("apply_generic_pointer");
    assert.equal(functionPointer.kind, "function");
    assert.equal(functionPointer.function.parameters[1].type.kind, "function-pointer");
    assert.deepEqual(functionPointer.function.parameters[1].type, {
      kind: "function-pointer",
      parameters: [{
        kind: "type-parameter",
        identity: functionPointer.function.generics.parameters[0].identity,
        displayName: "T",
      }],
      result: {
        kind: "type-parameter",
        identity: functionPointer.function.generics.parameters[0].identity,
        displayName: "T",
      },
      abi: "Rust",
      safety: "safe",
      variadic: false,
    });

    const requiredTraitNames = (name) => {
      const selected = semanticExport(name);
      assert.equal(selected.kind, "function");
      const parameter = selected.function.generics.parameters[0];
      assert.equal(parameter.kind, "type");
      return parameter.bounds
        .filter((bound) => bound.kind === "trait")
        .map((bound) => bound.trait.displayPath.at(-1));
    };
    assert.deepEqual(requiredTraitNames("require_fn"), ["Fn"]);
    assert.deepEqual(requiredTraitNames("require_fn_mut"), ["FnMut"]);
    assert.deepEqual(requiredTraitNames("require_fn_once"), ["FnOnce"]);
    assert.deepEqual(requiredTraitNames("require_local_future"), ["Future"]);
    assert.deepEqual(
      requiredTraitNames("require_send_static_future").sort(),
      ["Future", "Send"],
    );
    const sendStaticFuture = semanticExport("require_send_static_future");
    assert.ok(sendStaticFuture.function.generics.parameters[0].bounds.some((bound) =>
      bound.kind === "type-outlives" && bound.lifetime.kind === "static"));

    assert.notEqual(
      semanticExport("FirstSameName").identity.itemId,
      semanticExport("SecondSameName").identity.itemId,
    );
    const semanticProjection = projectRustCompilerModule(semanticModule, {
      providerModuleId: compilerProviderModuleId(dependency, []),
      moduleSpecifier: "@tsonic/rust/crates/widget_alias/index.js",
    });
    assert.equal(semanticProjection.declarationModel.exports.length > 0, true);
    assert.equal(semanticProjection.operations.some(({ exportId }) =>
      exportId.endsWith("::choose_borrowed")), true);
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
    assert.equal(projection.types.some(({ targetCarrier }) =>
      targetCarrier.kind === "path" &&
      targetCarrier.displayPath.join("::") === "widget_alias::Widget"), true);
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

    const unsupportedBorrowedSlice = worker.module({
      snapshot,
      dependency,
      modulePath: [],
      requestedExports: ["borrowed_slice"],
    });
    assert.match(
      unsupportedBorrowedSlice.unsupportedExports.find(({ name }) =>
        name === "borrowed_slice")?.reason ?? "",
      /borrowed or unsized value with no closed target carrier/u,
    );

    const associatedTypeModule = worker.module({
      snapshot,
      dependency,
      modulePath: [],
      requestedExports: ["pass_family_item"],
    });
    assert.deepEqual(associatedTypeModule.unsupportedExports, []);
    const passFamilyItem = associatedTypeModule.exports.find(({ name }) =>
      name === "pass_family_item");
    assert.equal(passFamilyItem?.kind, "function");
    const associatedParameter = passFamilyItem.function.parameters[0].type;
    assert.equal(associatedParameter.kind, "associated-type");
    assert.equal(associatedParameter.arguments.length, 1);
    assert.deepEqual(passFamilyItem.function.result, associatedParameter);

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
      trait.identity.canonicalPath.join("::") === "core::cmp::Eq" &&
      requirements.some(({ genericArgumentIndex, bound }) =>
        genericArgumentIndex === 0 && bound.kind === "trait" &&
        bound.trait.identity.canonicalPath.join("::") === "core::hash::Hash")));
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
