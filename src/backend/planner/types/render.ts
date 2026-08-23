import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { registerAliasFromPath } from "../program/plan-context.js";
import type { RustType } from "../../target-ast/nodes.js";
import {
  rustSourceTypeCarrierValue,
  rustSourceUnionCarrierValue,
  rustStructuralObjectCarrierValue,
} from "../../../target-model/types/index.js";
import { rustSourceItemIdentity } from "../program/source-package-facades.js";
import {
  rustBigIntTargetId,
  rustJsArrayTargetId,
  rustJsArrayConcatItemTargetId,
  rustJsDateTargetId,
  rustJsMapTargetId,
  rustJsRegExpExecArrayTargetId,
  rustJsRegExpIndicesTargetId,
  rustJsRegExpMatchArrayTargetId,
  rustJsRegExpNamedGroupsTargetId,
  rustJsRegExpNamedIndicesTargetId,
  rustJsRegExpStringIteratorTargetId,
  rustJsRegExpTargetId,
  rustJsSetTargetId,
  rustJsStringTargetId,
  rustJsValueTargetId,
  rustLocationTargetId,
  rustCallableTargetId,
  rustGeneratorTargetId,
  rustAsyncGeneratorTargetId,
  rustIteratorResultTargetId,
  rustNullTargetId,
  rustUndefinedTargetId,
  rustJsErrorTargetId,
  rustProgramErrorTargetId,
  rustFixedArrayCarrierValue,
  rustOptionTargetId,
  rustNamedTypeCarrierValue,
  rustPrimitiveTypeName,
  substituteRustTargetTypeParameters,
  rustStringTargetId,
  rustRegExpExecArrayTargetId,
  rustRegExpIndicesTargetId,
  rustRegExpMatchArrayTargetId,
  rustRegExpNamedGroupsTargetId,
  rustRegExpNamedIndicesTargetId,
  rustRegExpStringIteratorTargetId,
  isRustNeverCarrier,
} from "../../../target-model/types/index.js";

const namedCarrierPaths: Readonly<Record<string, string>> = {
  [rustBigIntTargetId]: "rt::BigInt",
  [rustOptionTargetId]: "Option",
  [rustLocationTargetId]: "rt::Location",
  [rustGeneratorTargetId]: "rt::Generator",
  [rustAsyncGeneratorTargetId]: "rt::AsyncGenerator",
  [rustIteratorResultTargetId]: "rt::IteratorResult",
  [rustNullTargetId]: "rt::Null",
  [rustUndefinedTargetId]: "rt::Undefined",
  [rustJsErrorTargetId]: "rt::JsError",
  [rustProgramErrorTargetId]: "rt::TsonicError",
  [rustJsValueTargetId]: "js_abi::JsValue",
  [rustJsArrayTargetId]: "js_abi::JsArray",
  [rustJsArrayConcatItemTargetId]: "js_abi::JsArrayConcatItem",
  [rustJsMapTargetId]: "js_abi::JsMap",
  [rustJsSetTargetId]: "js_abi::JsSet",
  [rustJsDateTargetId]: "js_abi::JsDate",
  [rustJsStringTargetId]: "js_abi::JsString",
  [rustJsRegExpTargetId]: "js_abi::JsRegExp",
  [rustRegExpExecArrayTargetId]: "js_abi::RegExpExecArray",
  [rustJsRegExpExecArrayTargetId]: "js_abi::JsRegExpExecArray",
  [rustRegExpMatchArrayTargetId]: "js_abi::RegExpMatchArray",
  [rustJsRegExpMatchArrayTargetId]: "js_abi::JsRegExpMatchArray",
  [rustRegExpIndicesTargetId]: "js_abi::RegExpIndices",
  [rustJsRegExpIndicesTargetId]: "js_abi::JsRegExpIndices",
  [rustRegExpNamedGroupsTargetId]: "js_abi::RegExpNamedGroups",
  [rustJsRegExpNamedGroupsTargetId]: "js_abi::JsRegExpNamedGroups",
  [rustRegExpNamedIndicesTargetId]: "js_abi::RegExpNamedIndices",
  [rustJsRegExpNamedIndicesTargetId]: "js_abi::JsRegExpNamedIndices",
  [rustRegExpStringIteratorTargetId]: "js_abi::RegExpStringIterator",
  [rustJsRegExpStringIteratorTargetId]: "js_abi::JsRegExpStringIterator",
};

export const rustStrRefType: RustType = { kind: "str-ref" };

export function rustTypeFromCarrier(
  carrier: TargetTypeRef | undefined,
  resolveSourceTypePath?: (value: { readonly fileName: string; readonly typeName: string }) => string | undefined,
  resolveStructuralShape?: (carrier: TargetTypeRef) => RustType | undefined,
): RustType | undefined {
  if (carrier === undefined) {
    return undefined;
  }
  if (isRustNeverCarrier(carrier)) {
    return undefined;
  }
  if (carrier.kind === "source-primitive") {
    const name = rustPrimitiveTypeName(carrier.name);
    return name === undefined ? undefined : { kind: "primitive", name };
  }
  if (carrier.kind === "target-named" && carrier.id === rustStringTargetId) {
    return { kind: "string" };
  }
  if (carrier.kind === "target-named" && carrier.id === rustCallableTargetId) {
    const [argumentsCarrier, resultCarrier] = carrier.typeArguments ?? [];
    if (carrier.typeArguments?.length !== 2 || argumentsCarrier?.kind !== "tuple" ||
      resultCarrier === undefined) {
      return undefined;
    }
    const argumentsType = rustTypeFromCarrier(argumentsCarrier, resolveSourceTypePath, resolveStructuralShape);
    const resultType = rustTypeFromCarrier(resultCarrier, resolveSourceTypePath, resolveStructuralShape);
    return argumentsType === undefined || resultType === undefined
      ? undefined
      : {
          kind: "named",
          path: "rt::Callable",
          typeArguments: [
            argumentsType,
            {
              kind: "named",
              path: "rt::TsonicResult",
              typeArguments: [resultType],
            },
          ],
        };
  }
  if (carrier.kind === "target-named") {
    const path = namedCarrierPaths[carrier.id];
    if (path === undefined) {
      return undefined;
    }
    const typeArguments = (carrier.typeArguments ?? []).map((argument) =>
      rustTypeFromCarrier(argument, resolveSourceTypePath, resolveStructuralShape));
    if (typeArguments.some((argument) => argument === undefined)) {
      return undefined;
    }
    return {
      kind: "named",
      path,
      ...(typeArguments.length === 0 ? {} : { typeArguments: typeArguments as RustType[] }),
    };
  }
  if (carrier.kind === "type-parameter") {
    return { kind: "named", path: carrier.name };
  }
  if (carrier.kind === "reference" && carrier.referent.kind === "target-named" &&
    carrier.referent.id === rustStringTargetId && carrier.mutable === false) {
    return rustStrRefType;
  }
  if (carrier.kind === "reference") {
    const referent = rustTypeFromCarrier(carrier.referent, resolveSourceTypePath, resolveStructuralShape);
    return referent === undefined ? undefined : { kind: "reference", referent, mutable: carrier.mutable };
  }
  if (carrier.kind === "slice") {
    const element = rustTypeFromCarrier(carrier.element, resolveSourceTypePath, resolveStructuralShape);
    return element === undefined ? undefined : { kind: "slice", element };
  }
  if (carrier.kind === "pointer" &&
    (carrier.mutability === "const" || carrier.mutability === "mut")) {
    const pointee = rustTypeFromCarrier(carrier.pointee, resolveSourceTypePath, resolveStructuralShape);
    return pointee === undefined
      ? undefined
      : { kind: "raw-pointer", pointee, mutable: carrier.mutability === "mut" };
  }
  if (carrier.kind === "function-pointer") {
    const parameters = carrier.args.map((argument) =>
      rustTypeFromCarrier(argument, resolveSourceTypePath, resolveStructuralShape));
    const result = rustReturnTypeFromCarrier(
      carrier.result,
      resolveSourceTypePath,
      resolveStructuralShape,
    );
    return result === undefined || parameters.some((parameter) => parameter === undefined)
      ? undefined
      : {
          kind: "function-pointer",
          parameters: parameters as RustType[],
          result,
          ...(carrier.abi === undefined ? {} : { abi: carrier.abi }),
          ...(carrier.isUnsafe === true ? { isUnsafe: true } : {}),
        };
  }
  const fixedArray = rustFixedArrayCarrierValue(carrier);
  if (fixedArray !== undefined) {
    const element = rustTypeFromCarrier(fixedArray.element, resolveSourceTypePath, resolveStructuralShape);
    return element === undefined ? undefined : { kind: "fixed-array", element, length: fixedArray.length };
  }
  const namedType = rustNamedTypeCarrierValue(carrier);
  if (namedType !== undefined) {
    const typeArguments = namedType.typeArguments.map((argument) =>
      rustTypeFromCarrier(argument, resolveSourceTypePath, resolveStructuralShape));
    return typeArguments.some((argument) => argument === undefined)
      ? undefined
      : {
          kind: "named",
          path: namedType.path,
          ...(typeArguments.length === 0 ? {} : { typeArguments: typeArguments as RustType[] }),
      };
  }
  const structuralObject = rustStructuralObjectCarrierValue(carrier);
  if (structuralObject !== undefined) {
    return resolveStructuralShape?.(carrier);
  }
  if (carrier.kind === "array") {
    const element = rustTypeFromCarrier(carrier.element, resolveSourceTypePath, resolveStructuralShape);
    return element === undefined ? undefined : { kind: "named", path: "Vec", typeArguments: [element] };
  }
  if (carrier.kind === "tuple") {
    if (carrier.elements.length === 0) {
      return { kind: "unit" };
    }
    const elements = carrier.elements.map((element) =>
      rustTypeFromCarrier(element, resolveSourceTypePath, resolveStructuralShape));
    if (elements.some((element) => element === undefined)) {
      return undefined;
    }
    return { kind: "tuple", elements: elements as RustType[] };
  }
  if (resolveSourceTypePath !== undefined) {
    const value = rustSourceTypeCarrierValue(carrier);
    if (value !== undefined) {
      const path = resolveSourceTypePath(value);
      const typeArguments = value.typeArguments.map((argument) =>
        rustTypeFromCarrier(argument, resolveSourceTypePath, resolveStructuralShape));
      return path === undefined || typeArguments.some((argument) => argument === undefined)
        ? undefined
        : {
            kind: "named",
            path,
            ...(typeArguments.length === 0
              ? {}
              : { typeArguments: typeArguments as RustType[] }),
          };
    }
    const union = rustSourceUnionCarrierValue(carrier);
    if (union !== undefined) {
      const path = resolveSourceTypePath(union);
      return path === undefined ? undefined : { kind: "named", path };
    }
  }
  return undefined;
}

export function rustReturnTypeFromCarrier(
  carrier: TargetTypeRef | undefined,
  resolveSourceTypePath?: (value: { readonly fileName: string; readonly typeName: string }) => string | undefined,
  resolveStructuralShape?: (carrier: TargetTypeRef) => RustType | undefined,
): RustType | undefined {
  return isRustNeverCarrier(carrier)
    ? { kind: "never" }
    : rustTypeFromCarrier(carrier, resolveSourceTypePath, resolveStructuralShape);
}

export function isFloatCarrier(carrier: TargetTypeRef | undefined): boolean {
  return carrier?.kind === "source-primitive" && (carrier.name === "float32" || carrier.name === "float64");
}

export function rustTypeFromCarrierInContext(
  carrier: TargetTypeRef | undefined,
  context: {
    readonly moduleName: string;
    readonly moduleNameByFileName: ReadonlyMap<string, string>;
    readonly externalCrateNameByFileName: ReadonlyMap<string, string>;
    readonly externalItemPathByIdentity: ReadonlyMap<string, string>;
    readonly externalStructuralShapeModuleByFileName: ReadonlyMap<string, string>;
    readonly crateName?: string;
    readonly structuralShapesModuleName: string;
    readonly usedAliases?: Set<string>;
    readonly typeParameterSubstitutions?: ReadonlyMap<string, TargetTypeRef>;
    readonly input: {
      readonly program: {
        readonly names: import("../../../target-model/names/model.js").RustNamePlan;
        readonly structuralShapes: import("../../../analysis/objects/structural-shape-plan.js").RustStructuralShapePlan;
      };
    };
  },
): RustType | undefined {
  const selectedCarrier = carrier === undefined || context.typeParameterSubstitutions === undefined
    ? carrier
    : substituteRustTargetTypeParameters(carrier, context.typeParameterSubstitutions);
  const resolveSourceTypePath = (value: { readonly fileName: string; readonly typeName: string }): string | undefined => {
    const moduleName = context.moduleNameByFileName.get(value.fileName);
    if (moduleName === undefined) {
      return undefined;
    }
    const typeName = context.input.program.names.nameForSourceType(value.fileName, value.typeName);
    if (typeName === undefined) {
      return undefined;
    }
    const externalCrate = context.externalCrateNameByFileName.get(value.fileName);
    return externalCrate !== undefined && externalCrate !== context.crateName
      ? context.externalItemPathByIdentity.get(
          rustSourceItemIdentity(value.fileName, typeName),
        )
      : moduleName === context.moduleName ? typeName : `crate::${moduleName}::${typeName}`;
  };
  const resolveStructuralShape = (shapeCarrier: TargetTypeRef): RustType | undefined => {
    const definition = context.input.program.structuralShapes.definitionForCarrier(shapeCarrier);
    if (definition === undefined) {
      return undefined;
    }
    const typeArguments = definition.typeParameterNames.map((name) =>
      rustTypeFromCarrier(
        { kind: "type-parameter", name },
        resolveSourceTypePath,
        resolveStructuralShape,
      ));
    if (typeArguments.some((argument) => argument === undefined)) {
      return undefined;
    }
    const externalShapeModule = context.externalStructuralShapeModuleByFileName.get(
      definition.ownerFileName,
    );
    const externalShapeCrate = context.externalCrateNameByFileName.get(
      definition.ownerFileName,
    );
    const stateType: RustType = {
      kind: "named",
      path: externalShapeModule !== undefined && externalShapeCrate !== context.crateName
        ? `${externalShapeModule}::${definition.targetName}`
        : context.moduleName === context.structuralShapesModuleName
        ? definition.targetName
        : `crate::${context.structuralShapesModuleName}::${definition.targetName}`,
      ...(typeArguments.length === 0
        ? {}
        : { typeArguments: typeArguments as readonly RustType[] }),
    };
    return {
      kind: "named",
      path: "rt::ObjectHandle",
      typeArguments: [stateType],
    };
  };
  const rendered = rustTypeFromCarrier(
    selectedCarrier,
    resolveSourceTypePath,
    resolveStructuralShape,
  );
  collectAliasesFromRustType(rendered, (path) => {
    registerAliasFromPath(context, path);
  });
  return rendered;
}

export function rustReturnTypeFromCarrierInContext(
  carrier: TargetTypeRef | undefined,
  context: {
    readonly moduleName: string;
    readonly moduleNameByFileName: ReadonlyMap<string, string>;
    readonly externalCrateNameByFileName: ReadonlyMap<string, string>;
    readonly externalItemPathByIdentity: ReadonlyMap<string, string>;
    readonly externalStructuralShapeModuleByFileName: ReadonlyMap<string, string>;
    readonly crateName?: string;
    readonly structuralShapesModuleName: string;
    readonly usedAliases?: Set<string>;
    readonly typeParameterSubstitutions?: ReadonlyMap<string, TargetTypeRef>;
    readonly input: {
      readonly program: {
        readonly names: import("../../../target-model/names/model.js").RustNamePlan;
        readonly structuralShapes: import("../../../analysis/objects/structural-shape-plan.js").RustStructuralShapePlan;
      };
    };
  },
): RustType | undefined {
  return isRustNeverCarrier(carrier)
    ? { kind: "never" }
    : rustTypeFromCarrierInContext(carrier, context);
}

export function collectAliasesFromRustType(
  type: RustType | undefined,
  register: (path: string) => void,
): void {
  if (type === undefined) {
    return;
  }
  if (type.kind === "named") {
    register(type.path);
    for (const argument of type.typeArguments ?? []) {
      collectAliasesFromRustType(argument, register);
    }
    return;
  }
  if (type.kind === "slice") {
    collectAliasesFromRustType(type.element, register);
    return;
  }
  if (type.kind === "reference") {
    collectAliasesFromRustType(type.referent, register);
    return;
  }
  if (type.kind === "function-pointer") {
    for (const parameter of type.parameters) {
      collectAliasesFromRustType(parameter, register);
    }
    collectAliasesFromRustType(type.result, register);
    return;
  }
  if (type.kind === "fixed-array") {
    collectAliasesFromRustType(type.element, register);
    return;
  }
  if (type.kind === "tuple") {
    for (const element of type.elements) {
      collectAliasesFromRustType(element, register);
    }
  }
}
