import type { SourcePrimitiveKind } from "@tsonic/tsts";
import { rustValueConversionContract } from "../../../target-model/conversions/contracts.js";
import type { RustValueConversion } from "../../../target-model/operations/model.js";
import type {
  RustBound,
  RustGenericArgument,
  RustGenericParameter,
  RustGenerics,
  RustTypeRef,
  RustWherePredicate,
} from "../../../target-model/semantics/index.js";
import { rustSemanticIdentityKey } from "../../../target-model/semantics/index.js";
import {
  isRustNeverCarrier,
  rustOptionElementCarrier,
  rustPrimitiveTypeName,
} from "../../../target-model/types/index.js";
import {
  isRustGenericArgumentValue,
  isRustTraitReference,
  isRustTargetTypeRef,
  rustTargetTypeRefEquals,
} from "../../../target-model/types/equality.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import type { RustProviderPackageDefinition } from "../index.js";
import type { Fail } from "./model.js";
import {
  builtInTargetCarrierIds,
  rustIdentifierPattern,
  rustPathPattern,
} from "./model.js";

export function validateCarrier(
  carrier: TargetTypeRef,
  definition: RustProviderPackageDefinition,
  where: string,
  fail: Fail,
  options: {
    readonly allowImmediateClosure?: boolean;
    readonly allowUnsized?: boolean;
    readonly position?: "value" | "return";
  } = {},
): void {
  if (!isRustTargetTypeRef(carrier)) {
    fail(`${where} is not one canonical closed Rust target type`);
  }
  validateCanonicalCarrier(carrier, definition, where, fail, options, new Set());
}

export function validateRustGenerics(
  generics: RustGenerics,
  definition: RustProviderPackageDefinition,
  where: string,
  fail: Fail,
): void {
  requireExactKeys(asRecord(generics), ["parameters", "wherePredicates"], where, fail);
  if (!Array.isArray(generics.parameters) || !Array.isArray(generics.wherePredicates)) {
    fail(`${where} must contain dense parameter and where-predicate arrays`);
    return;
  }
  const identities = new Set<string>();
  for (const [index, parameter] of generics.parameters.entries()) {
    validateGenericParameter(parameter, definition, `${where}.parameters[${index}]`, fail);
    const identity = genericParameterIdentityKey(parameter);
    if (identity === undefined || identities.has(identity)) {
      fail(`${where}.parameters[${index}] has no unique exact semantic identity`);
    } else {
      identities.add(identity);
    }
  }
  for (const [index, predicate] of generics.wherePredicates.entries()) {
    validateWherePredicate(predicate, definition, `${where}.wherePredicates[${index}]`, fail);
  }
}

function validateGenericParameter(
  parameter: RustGenericParameter,
  definition: RustProviderPackageDefinition,
  where: string,
  fail: Fail,
): void {
  if (parameter.kind === "lifetime") {
    requireExactKeys(asRecord(parameter), ["kind", "identity", "bounds"], where, fail);
    validateGenericArgumentValue({ kind: "lifetime", value: parameter.identity }, `${where}.identity`, fail);
    for (const [index, bound] of parameter.bounds.entries()) {
      validateGenericArgumentValue({ kind: "lifetime", value: bound }, `${where}.bounds[${index}]`, fail);
    }
    return;
  }
  if (parameter.kind === "type") {
    requireExactKeys(asRecord(parameter), ["kind", "identity", "displayName", "bounds", "defaultType"], where, fail);
    validateGenericArgumentValue({
      kind: "type",
      value: { kind: "type-parameter", identity: parameter.identity, displayName: parameter.displayName },
    }, `${where}.identity`, fail);
    for (const [index, bound] of parameter.bounds.entries()) {
      validateRustBound(bound, definition, `${where}.bounds[${index}]`, fail);
    }
    if (parameter.defaultType !== undefined) {
      validateCarrier(parameter.defaultType, definition, `${where}.defaultType`, fail, { allowUnsized: true });
    }
    return;
  }
  requireExactKeys(asRecord(parameter), ["kind", "identity", "displayName", "type", "defaultValue"], where, fail);
  validateGenericArgumentValue({
    kind: "const",
    value: { kind: "parameter", identity: parameter.identity, displayName: parameter.displayName },
  }, `${where}.identity`, fail);
  validateCarrier(parameter.type, definition, `${where}.type`, fail);
  if (parameter.defaultValue !== undefined) {
    validateGenericArgumentValue({ kind: "const", value: parameter.defaultValue }, `${where}.defaultValue`, fail);
  }
}

function validateWherePredicate(
  predicate: RustWherePredicate,
  definition: RustProviderPackageDefinition,
  where: string,
  fail: Fail,
): void {
  if (predicate.kind === "lifetime") {
    requireExactKeys(asRecord(predicate), ["kind", "lifetime", "outlives"], where, fail);
    validateGenericArgumentValue({ kind: "lifetime", value: predicate.lifetime }, `${where}.lifetime`, fail);
    for (const [index, lifetime] of predicate.outlives.entries()) {
      validateGenericArgumentValue({ kind: "lifetime", value: lifetime }, `${where}.outlives[${index}]`, fail);
    }
    return;
  }
  if (predicate.kind === "equality") {
    requireExactKeys(asRecord(predicate), ["kind", "projection", "value"], where, fail);
    validateCarrier(predicate.projection, definition, `${where}.projection`, fail, { allowUnsized: true });
    validateCarrier(predicate.value, definition, `${where}.value`, fail, { allowUnsized: true });
    return;
  }
  requireExactKeys(asRecord(predicate), ["kind", "binder", "type", "bounds"], where, fail);
  validateCarrier(predicate.type, definition, `${where}.type`, fail, { allowUnsized: true });
  for (const [index, bound] of predicate.bounds.entries()) {
    validateRustBound(bound, definition, `${where}.bounds[${index}]`, fail);
  }
  if (predicate.binder !== undefined) {
    for (const [index, lifetime] of predicate.binder.lifetimes.entries()) {
      validateGenericParameter(lifetime, definition, `${where}.binder.lifetimes[${index}]`, fail);
    }
  }
}

export function validateRustBound(
  bound: RustBound,
  definition: RustProviderPackageDefinition,
  where: string,
  fail: Fail,
): void {
  if (bound.kind === "trait") {
    requireExactKeys(asRecord(bound), ["kind", "binder", "trait", "polarity"], where, fail);
    if (!isRustTraitReference(bound.trait)) fail(`${where}.trait is not one exact Rust trait reference`);
    if (bound.binder !== undefined) {
      for (const [index, lifetime] of bound.binder.lifetimes.entries()) {
        validateGenericParameter(lifetime, definition, `${where}.binder.lifetimes[${index}]`, fail);
      }
    }
    return;
  }
  if (bound.kind === "lifetime-outlives") {
    requireExactKeys(asRecord(bound), ["kind", "longer", "shorter"], where, fail);
    validateGenericArgumentValue({ kind: "lifetime", value: bound.longer }, `${where}.longer`, fail);
    validateGenericArgumentValue({ kind: "lifetime", value: bound.shorter }, `${where}.shorter`, fail);
    return;
  }
  if (bound.kind === "type-outlives") {
    requireExactKeys(asRecord(bound), ["kind", "type", "lifetime"], where, fail);
    validateCarrier(bound.type, definition, `${where}.type`, fail, { allowUnsized: true });
    validateGenericArgumentValue({ kind: "lifetime", value: bound.lifetime }, `${where}.lifetime`, fail);
    return;
  }
  if (bound.kind === "associated-equality") {
    requireExactKeys(asRecord(bound), ["kind", "projection", "value"], where, fail);
    validateCarrier(bound.projection, definition, `${where}.projection`, fail, { allowUnsized: true });
    validateCarrier(bound.value, definition, `${where}.value`, fail, { allowUnsized: true });
    return;
  }
}

function validateGenericArgumentValue(
  argument: RustGenericArgument,
  where: string,
  fail: Fail,
): void {
  if (!isRustGenericArgumentValue(argument)) fail(`${where} is not one exact Rust generic value`);
}

function genericParameterIdentityKey(parameter: RustGenericParameter): string | undefined {
  const argument: RustGenericArgument = parameter.kind === "lifetime"
    ? { kind: "lifetime", value: parameter.identity }
    : parameter.kind === "type"
      ? { kind: "type", value: { kind: "type-parameter", identity: parameter.identity, displayName: parameter.displayName } }
      : { kind: "const", value: { kind: "parameter", identity: parameter.identity, displayName: parameter.displayName } };
  return importGenericIdentity(argument);
}

function importGenericIdentity(argument: RustGenericArgument): string | undefined {
  if (argument.kind === "lifetime" && argument.value.kind === "parameter") {
    return rustSemanticIdentityKey(argument.value.identity);
  }
  if (argument.kind === "type" && argument.value.kind === "type-parameter") {
    return rustSemanticIdentityKey(argument.value.identity);
  }
  if (argument.kind === "const" && argument.value.kind === "parameter") {
    return rustSemanticIdentityKey(argument.value.identity);
  }
  return undefined;
}

function validateCanonicalCarrier(
  carrier: RustTypeRef,
  definition: RustProviderPackageDefinition,
  where: string,
  fail: Fail,
  options: {
    readonly allowImmediateClosure?: boolean;
    readonly allowUnsized?: boolean;
    readonly position?: "value" | "return";
  },
  active: Set<RustTypeRef>,
): void {
  if (active.has(carrier)) {
    fail(`${where} contains a recursive Rust type object graph`);
  }
  active.add(carrier);
  try {
    const nested = (type: RustTypeRef, suffix: string, allowUnsized = false): void =>
      validateCanonicalCarrier(type, definition, `${where}.${suffix}`, fail, {
        ...options,
        allowUnsized,
        position: "value",
      }, active);
    switch (carrier.kind) {
      case "source-primitive":
        if (!rustSourcePrimitiveHasCarrier(carrier.name)) {
          fail(`${where} uses source primitive '${carrier.name}' with no Rust carrier`);
        }
        return;
      case "path": {
        const targetId = carrier.identity.kind === "builtin"
          ? carrier.identity.itemId
          : undefined;
        if (targetId !== undefined && !builtInTargetCarrierIds.has(targetId)) {
          fail(`${where} names unknown built-in target carrier '${targetId}'`);
        }
        for (const [index, argument] of carrier.arguments.entries()) {
          validateGenericArgument(argument, definition, `${where}.arguments[${index}]`, fail, active);
        }
        return;
      }
      case "array":
      case "sequence":
        nested(carrier.element, "element");
        return;
      case "slice":
        if (options.allowUnsized !== true) {
          fail(`${where} uses a bare Rust slice outside an unsized type position`);
        }
        nested(carrier.element, "element");
        return;
      case "str":
      case "trait-object":
        if (options.allowUnsized !== true) {
          fail(`${where} uses an unsized Rust type outside a reference, pointer, or type argument`);
        }
        if (carrier.kind === "trait-object") {
          for (const [index, argument] of carrier.principal.arguments.entries()) {
            validateGenericArgument(argument, definition, `${where}.principal.arguments[${index}]`, fail, active);
          }
          for (const [traitIndex, trait] of carrier.autoTraits.entries()) {
            for (const [argumentIndex, argument] of trait.arguments.entries()) {
              validateGenericArgument(
                argument,
                definition,
                `${where}.autoTraits[${traitIndex}].arguments[${argumentIndex}]`,
                fail,
                active,
              );
            }
          }
        }
        return;
      case "tuple":
        for (const [index, element] of carrier.elements.entries()) nested(element, `elements[${index}]`);
        return;
      case "reference":
      case "raw-pointer":
        nested(carrier.target, "target", true);
        return;
      case "function-pointer":
        for (const [index, parameter] of carrier.parameters.entries()) {
          nested(parameter, `parameters[${index}]`);
        }
        nested(carrier.result, "result");
        return;
      case "closure":
        if (options.allowImmediateClosure !== true) {
          fail(`${where} uses a native Rust closure outside an exact immediate-callback parameter`);
        }
        for (const [index, parameter] of carrier.parameters.entries()) {
          nested(parameter, `parameters[${index}]`);
        }
        nested(carrier.result, "result");
        return;
      case "associated-type":
        nested(carrier.owner, "owner", true);
        for (const [index, argument] of carrier.arguments.entries()) {
          validateGenericArgument(argument, definition, `${where}.arguments[${index}]`, fail, active);
        }
        return;
      case "opaque":
        if (options.position !== "return") {
          fail(`${where} uses an opaque Rust type outside a top-level result position`);
        }
        return;
      case "primitive":
      case "never":
      case "unit":
      case "self":
      case "type-parameter":
      case "inference-variable":
      case "source-carrier":
        return;
    }
  } finally {
    active.delete(carrier);
  }
}

function validateGenericArgument(
  argument: RustGenericArgument,
  definition: RustProviderPackageDefinition,
  where: string,
  fail: Fail,
  active: Set<RustTypeRef>,
): void {
  if (argument.kind === "type") {
    validateCanonicalCarrier(
      argument.value,
      definition,
      `${where}.value`,
      fail,
      { allowUnsized: true },
      active,
    );
  }
}

export function validateValueConversion(
  conversion: RustValueConversion,
  definition: RustProviderPackageDefinition,
  where: string,
  expectedSource: TargetTypeRef | undefined,
  expectedTarget: TargetTypeRef | undefined,
  fail: Fail,
): void {
  if (conversion.kind === "semantic-conversion") {
    requireExactKeys(asRecord(conversion), ["kind", "id"], where, fail);
  } else if (conversion.kind === "numeric-promotion") {
    requireExactKeys(asRecord(conversion), ["kind", "source", "target"], where, fail);
  } else if (conversion.kind === "raw-pointer-mut-to-const") {
    requireExactKeys(asRecord(conversion), ["kind", "pointee"], where, fail);
  } else if (conversion.kind === "copy-from-reference") {
    requireExactKeys(asRecord(conversion), ["kind", "target"], where, fail);
  } else if (conversion.kind === "source-union-variant") {
    requireExactKeys(asRecord(conversion), ["kind", "source", "target", "variantName"], where, fail);
  } else if (conversion.kind === "bottom-coercion") {
    requireExactKeys(asRecord(conversion), ["kind", "source", "target"], where, fail);
    if (!isRustNeverCarrier(conversion.source)) {
      fail(`${where}.source is not the exact Rust never carrier`);
    }
  } else if (conversion.kind === "runtime-callable-callback") {
    requireExactKeys(asRecord(conversion), ["kind", "source", "target"], where, fail);
  } else if (conversion.kind === "option-map") {
    requireExactKeys(asRecord(conversion), ["kind", "elementConversion"], where, fail);
    validateValueConversion(
      conversion.elementConversion,
      definition,
      `${where}.elementConversion`,
      rustOptionElementCarrier(expectedSource),
      rustOptionElementCarrier(expectedTarget),
      fail,
    );
  } else if (conversion.kind === "option-some") {
    requireExactKeys(asRecord(conversion), ["kind", "element"], where, fail);
  } else if (conversion.kind === "js-argument-vector-callback") {
    requireExactKeys(
      asRecord(conversion),
      ["kind", "lane", "source", "target", "projections", "sourceInvocationReturnsResult"],
      where,
      fail,
    );
  }
  const contract = rustValueConversionContract(conversion);
  if (contract === undefined) {
    fail(`${where} is not a supported Rust value conversion`);
  }
  validateCarrier(contract.source, definition, `${where}.source`, fail);
  validateCarrier(contract.target, definition, `${where}.target`, fail);
  if (expectedSource !== undefined && !rustTargetTypeRefEquals(contract.source, expectedSource)) {
    fail(`${where}.source does not match its selected source parameter carrier`);
  }
  if (expectedTarget !== undefined && !rustTargetTypeRefEquals(contract.target, expectedTarget)) {
    fail(`${where}.target does not match the selected operation result carrier`);
  }
}

export function requireRustIdentifier(value: unknown, where: string, fail: Fail): asserts value is string {
  if (typeof value !== "string" || !rustIdentifierPattern.test(value)) {
    fail(`${where} '${String(value)}' is not a Rust identifier`);
  }
}

export function rustSourcePrimitiveHasCarrier(name: SourcePrimitiveKind): boolean {
  return name === "native-int" || name === "native-uint" || rustPrimitiveTypeName(name) !== undefined;
}

export function requireRustPath(value: unknown, where: string, fail: Fail): asserts value is string {
  if (typeof value !== "string" || !rustPathPattern.test(value)) {
    fail(`${where} '${String(value)}' is not a closed Rust path`);
  }
}

export function requireNonEmpty(value: unknown, where: string, fail: Fail): asserts value is string {
  if (typeof value !== "string" || value.length === 0) {
    fail(`${where} must not be empty`);
  }
}

export function requireExactKeys(
  value: unknown,
  allowed: readonly string[],
  where: string,
  fail: Fail,
): void {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(`${where} must be a metadata object`);
  }
  const record = value as Readonly<Record<string, unknown>>;
  const allowedSet = new Set(allowed);
  const unexpected = Object.keys(record).filter((key) => !allowedSet.has(key));
  if (unexpected.length > 0) {
    fail(`${where} has unsupported field${unexpected.length === 1 ? "" : "s"} ${unexpected.map((key) => `'${key}'`).join(", ")}`);
  }
}

export function asRecord(value: object): Readonly<Record<string, unknown>> {
  return value as Readonly<Record<string, unknown>>;
}
