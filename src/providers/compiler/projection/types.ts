import {
  rustFixedArrayTargetType,
  rustNeverTargetType,
  rustOptionTargetId,
  rustSourcePrimitiveTargetType,
  rustStringTargetType,
  rustUnitTargetType,
} from "../../../target-model/types/index.js";
import { canonicalCompilerTypePathKey, importedSourceType, isRustOptionPath, isRustStringPath, requireCurrentType, rustCompilerTypeText, standardSourceTypeArguments, standardTargetTypeArguments } from "./utilities.js";
import { compilerModuleSpecifier, compilerTargetTypeId, providerFunctionPointerAbi, recordCarrierPath, rustPath } from "./operations.js";
import { rustConstPointerExport, rustMutPointerExport } from "../../../source/extension/source-extension.js";
import { rustTypesModule } from "../../../source/profiles/source-modules.js";
import { sourcePrimitiveByRustName } from "./model.js";
import type { ProjectionContext } from "./model.js";
import type { ProviderTypeExpression } from "@tsonic/tsts";
import type { RustCompilerType } from "../model/model.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";

export function sourceTypeFor(
  type: RustCompilerType,
  context: ProjectionContext,
  position: "parameter" | "result",
  nested = false,
): ProviderTypeExpression {
  if (type.kind === "generic") {
    const bound = context.defaultTypeBindings?.get(type.name);
    if (bound !== undefined) {
      return sourceTypeFor(bound, context, position, nested);
    }
  }
  if (type.kind === "reference") {
    if (position === "result") {
      throw new Error("Borrowed Rust results require an explicit lifetime-bearing source contract.");
    }
    return sourceTypeFor(type.target, context, position, nested);
  }
  switch (type.kind) {
    case "unit":
      return { kind: "void" };
    case "primitive": {
      if (type.name === "str") {
        return { kind: "string" };
      }
      if (type.name === "never") {
        return { kind: "never" };
      }
      const primitive = sourcePrimitiveByRustName.get(type.name);
      if (primitive === undefined) {
        throw new Error(`Rust primitive '${type.name}' has no source primitive contract.`);
      }
      return { kind: "source-primitive", name: primitive };
    }
    case "generic":
      return { kind: "type-parameter", name: type.name };
    case "self":
      return requireCurrentType(context).sourceType;
    case "tuple":
      return { kind: "tuple", elementTypes: type.elements.map((element) => sourceTypeFor(element, context, position, true)) };
    case "array":
      return { kind: "array", elementType: sourceTypeFor(type.element, context, position, true) };
    case "slice":
      if (position === "result" && !nested) {
        throw new Error("Borrowed Rust slice results require an explicit lifetime-bearing source contract.");
      }
      return { kind: "array", elementType: sourceTypeFor(type.element, context, position, true) };
    case "raw-pointer":
      return importedSourceType(
        context,
        rustTypesModule,
        type.mutable ? rustMutPointerExport : rustConstPointerExport,
        [sourceTypeFor(type.target, context, position, true)],
      );
    case "function-pointer":
      return importedSourceType(context, "@tsonic/core/types.js", "FunctionPointer", [{
          kind: "tuple",
          elementTypes: type.parameters.map((parameter) =>
            sourceTypeFor(parameter, context, position, true)),
        }, sourceTypeFor(type.result, context, position, true)]);
    case "associated-type":
      throw new Error("Unresolved Rust associated type reached source provider projection.");
    case "path": {
      if (isRustStringPath(type)) {
        return { kind: "string" };
      }
      if (isRustOptionPath(type)) {
        const arguments_ = type.typeArguments.map((argument) =>
          sourceTypeFor(argument, context, position, true));
        if (arguments_.length !== 1) {
          throw new Error("Rust Option must carry exactly one source type argument.");
        }
        return { kind: "union", types: [arguments_[0]!, { kind: "undefined" }] };
      }
      const standard = context.standardTypes.get(canonicalCompilerTypePathKey(type));
      if (standard !== undefined) {
        const typeArguments = standardSourceTypeArguments(type, standard, context, position);
        const localName = context.localStandardTypeNames.get(canonicalCompilerTypePathKey(type));
        return importedSourceType(
          context,
          localName === undefined ? standard.sourceModuleSpecifier : context.owner.moduleSpecifier,
          localName ?? standard.sourceExportName,
          typeArguments,
        );
      }
      if (type.crateName !== context.dependency.crateName) {
        throw new Error(`External Rust type '${rustCompilerTypeText(type)}' has no imported provider contract.`);
      }
      const moduleSpecifier = compilerModuleSpecifier(context.dependency.alias, type.modulePath);
      if (moduleSpecifier !== context.owner.moduleSpecifier) {
        const names = context.imports.get(moduleSpecifier) ?? new Set<string>();
        names.add(type.name);
        context.imports.set(moduleSpecifier, names);
      }
      return {
        kind: "provider-ref",
        moduleSpecifier,
        exportName: type.name,
        ...(type.typeArguments.length === 0
          ? {}
          : { typeArguments: type.typeArguments.map((argument) => sourceTypeFor(argument, context, position, true)) }),
      };
    }
  }
}

export function targetTypeFor(
  type: RustCompilerType,
  context: ProjectionContext,
  position: "parameter" | "result",
  nested = false,
): TargetTypeRef {
  if (type.kind === "generic") {
    const bound = context.defaultTypeBindings?.get(type.name);
    if (bound !== undefined) {
      return targetTypeFor(bound, context, position, nested);
    }
  }
  switch (type.kind) {
    case "unit":
      return rustUnitTargetType();
    case "primitive": {
      if (type.name === "str") {
        return rustStringTargetType();
      }
      if (type.name === "never") {
        return rustNeverTargetType();
      }
      const primitive = sourcePrimitiveByRustName.get(type.name);
      if (primitive === undefined) {
        throw new Error(`Rust primitive '${type.name}' has no target carrier contract.`);
      }
      return rustSourcePrimitiveTargetType(primitive);
    }
    case "generic":
      return { kind: "type-parameter", name: type.name };
    case "self":
      return requireCurrentType(context).carrier;
    case "tuple":
      return { kind: "tuple", elements: type.elements.map((element) => targetTypeFor(element, context, position, true)) };
    case "array":
      return rustFixedArrayTargetType(targetTypeFor(type.element, context, position, true), type.length);
    case "slice":
      if (position === "result" && !nested) {
        throw new Error("Borrowed Rust slice results require an explicit lifetime-bearing target carrier.");
      }
      return nested
        ? { kind: "slice", element: targetTypeFor(type.element, context, position, true) }
        : { kind: "array", element: targetTypeFor(type.element, context, position, true) };
    case "reference":
      return {
        kind: "reference",
        referent: targetTypeFor(type.target, context, "parameter", true),
        mutable: type.mutable,
        ...(type.lifetime === undefined ? {} : { lifetime: type.lifetime }),
      };
    case "raw-pointer":
      return {
        kind: "pointer",
        pointee: targetTypeFor(type.target, context, position, true),
        mutability: type.mutable ? "mut" : "const",
      };
    case "function-pointer":
      return {
        kind: "function-pointer",
        args: type.parameters.map((parameter) =>
          targetTypeFor(parameter, context, position, true)),
        result: targetTypeFor(type.result, context, position, true),
        abi: [providerFunctionPointerAbi(type.abi)],
        ...(type.unsafe ? { isUnsafe: true } : {}),
      };
    case "associated-type":
      throw new Error("Unresolved Rust associated type reached target provider projection.");
    case "path": {
      if (isRustStringPath(type)) {
        return rustStringTargetType();
      }
      if (isRustOptionPath(type)) {
        const arguments_ = type.typeArguments.map((argument) =>
          targetTypeFor(argument, context, position, true));
        if (arguments_.length !== 1) {
          throw new Error("Rust Option must carry exactly one target type argument.");
        }
        return { kind: "target-named", id: rustOptionTargetId, typeArguments: arguments_ };
      }
      const standard = context.standardTypes.get(canonicalCompilerTypePathKey(type));
      if (standard !== undefined) {
        const arguments_ = standardTargetTypeArguments(type, standard, context, position);
        const path = standard.targetPath.join("::");
        recordCarrierPath(context.carrierPaths, standard.targetId, path);
        return {
          kind: "target-named",
          id: standard.targetId,
          ...(arguments_.length === 0 ? {} : { typeArguments: arguments_ }),
        };
      }
      if (type.crateName !== context.dependency.crateName) {
        throw new Error(`External Rust type '${rustCompilerTypeText(type)}' has no target carrier contract.`);
      }
      const canonicalPath = [type.crateName, ...type.modulePath, type.name];
      const id = compilerTargetTypeId(context.dependency, canonicalPath);
      const path = rustPath(context.dependency.targetCrateName, type.modulePath, type.name);
      recordCarrierPath(context.carrierPaths, id, path);
      const typeArguments = type.typeArguments.map((argument) =>
        targetTypeFor(argument, context, position, true));
      return {
        kind: "target-named",
        id,
        ...(typeArguments.length === 0 ? {} : { typeArguments }),
      };
    }
  }
}

export function parameterPassing(type: RustCompilerType): {
  readonly type: RustCompilerType;
  readonly sourceMode: "by-value" | "borrow-shared" | "borrow-mut";
  readonly targetMode: "value" | "ref" | "mut-ref";
} {
  if (type.kind !== "reference") {
    return { type, sourceMode: "by-value", targetMode: "value" };
  }
  return type.mutable
    ? { type: type.target, sourceMode: "borrow-mut", targetMode: "mut-ref" }
    : { type: type.target, sourceMode: "borrow-shared", targetMode: "ref" };
}
