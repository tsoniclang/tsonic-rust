import {
  rustFixedArrayCarrierValue,
  rustNamedTypeCarrierValue,
  rustPrimitiveTypeName,
  isRustNeverCarrier,
  rustOptionElementCarrier,
} from "../../../target-model/types/index.js";
import { builtInTargetCarrierIds, rustIdentifierPattern, rustPathPattern } from "./model.js";
import { isRustTargetTypeRef, rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import { rustValueConversionContract } from "../../../target-model/conversions/contracts.js";
import type { Fail } from "./model.js";
import type { RustProviderPackageDefinition } from "../index.js";
import type { RustValueConversion } from "../../../target-model/operations/model.js";
import type {
  RustTargetTypeRef,
  TargetTypeRef,
} from "../../../target-model/types/model.js";
import { isRustLifetimeRef } from "../../../target-model/lifetimes/index.js";

const carrierFieldsByKind: Readonly<Record<RustTargetTypeRef["kind"], readonly string[]>> =
  Object.freeze({
    "source-primitive": ["kind", "name"],
    "target-named": ["kind", "id", "genericArguments"],
    "type-parameter": ["kind", "name"],
    array: ["kind", "element", "rank"],
    slice: ["kind", "element"],
    tuple: ["kind", "elements"],
    reference: ["kind", "referent", "mutable", "lifetime"],
    pointer: ["kind", "pointee", "mutability"],
    "function-pointer": ["kind", "args", "result", "lifetimeBinder", "abi", "isUnsafe"],
    closure: ["kind", "args", "result", "lifetimeBinder"],
    "trait-ref": [
      "kind",
      "id",
      "path",
      "genericArguments",
      "associatedConstraints",
      "lifetimeBinder",
    ],
    "trait-object": ["kind", "principal", "autoTraits", "lifetime"],
    "impl-trait": ["kind", "id", "bounds", "outlives", "captures"],
    "associated-type": ["kind", "owner", "trait", "name", "genericArguments"],
    opaque: ["kind", "id"],
    "target-specific": ["kind", "target", "name", "value"],
  });

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
  const unchecked = carrier as unknown;
  if (typeof unchecked !== "object" || unchecked === null || Array.isArray(unchecked)) {
    fail(`${where} must be a metadata object`);
  }
  const record = unchecked as Readonly<Record<string, unknown>>;
  const allowedFields = typeof record.kind === "string"
    ? carrierFieldsByKind[record.kind as RustTargetTypeRef["kind"]]
    : undefined;
  if (allowedFields === undefined) {
    fail(`${where}.kind '${String(record.kind)}' is not a supported Rust target type kind`);
  }
  requireExactKeys(record, allowedFields, where, fail);
  if (!isRustTargetTypeRef(carrier)) {
    fail(`${where} is not a closed Rust target type`);
  }
  switch (carrier.kind) {
    case "source-primitive":
      if (!rustSourcePrimitiveHasCarrier(carrier.name)) {
        fail(`${where} uses source primitive '${carrier.name}' with no Rust carrier`);
      }
      return;
    case "target-named":
      requireNonEmpty(carrier.id, `${where}.id`, fail);
      if (!builtInTargetCarrierIds.has(carrier.id) && definition.carrierPaths?.[carrier.id] === undefined) {
        fail(`${where} names target carrier '${carrier.id}' without a Rust carrier path`);
      }
      for (const [index, argument] of (carrier.genericArguments ?? []).entries()) {
        if (argument.kind === "type") {
          validateCarrier(
            argument.type,
            definition,
            `${where}.genericArguments[${index}].type`,
            fail,
            { allowUnsized: true },
          );
        }
      }
      return;
    case "type-parameter":
      requireRustIdentifier(carrier.name, `${where}.name`, fail);
      return;
    case "array":
      if (carrier.rank !== undefined && carrier.rank !== 1) {
        fail(`${where} has unsupported Rust array rank '${carrier.rank}'`);
      }
      validateCarrier(carrier.element, definition, `${where}.element`, fail);
      return;
    case "slice":
      if (options.allowUnsized !== true) {
        fail(`${where} uses a bare Rust slice outside a reference, pointer, or target type argument`);
      }
      validateCarrier(carrier.element, definition, `${where}.element`, fail);
      return;
    case "tuple":
      for (const [index, element] of carrier.elements.entries()) {
        validateCarrier(element, definition, `${where}.elements[${index}]`, fail);
      }
      return;
    case "reference":
      if (typeof carrier.mutable !== "boolean" ||
        (carrier.lifetime !== undefined && !isRustLifetimeRef(carrier.lifetime))) {
        fail(`${where} has an invalid Rust reference contract`);
      }
      validateCarrier(carrier.referent, definition, `${where}.referent`, fail, {
        allowUnsized: true,
      });
      return;
    case "pointer":
      if (carrier.mutability === "const" || carrier.mutability === "mut") {
        validateCarrier(carrier.pointee, definition, `${where}.pointee`, fail, {
          allowUnsized: true,
        });
        return;
      }
      fail(`${where} is not a renderable Rust pointer carrier`);
    case "function-pointer":
      if (carrier.isUnsafe !== undefined && typeof carrier.isUnsafe !== "boolean") {
        fail(`${where}.isUnsafe must be boolean when present`);
      }
      if ((carrier.abi?.length ?? 0) > 1 || carrier.abi?.some((entry) =>
        entry !== "target-default" && entry !== "C" && entry !== "system")) {
        fail(`${where}.abi must contain at most one supported Rust ABI name`);
      }
      for (const [index, argument] of carrier.args.entries()) {
        validateCarrier(argument, definition, `${where}.args[${index}]`, fail);
      }
      validateCarrier(carrier.result, definition, `${where}.result`, fail, {
        position: "return",
      });
      return;
    case "closure":
      if (options.allowImmediateClosure !== true) {
        fail(`${where} uses a native Rust closure outside an exact immediate-callback parameter`);
      }
      for (const [index, argument] of carrier.args.entries()) {
        validateCarrier(argument, definition, `${where}.args[${index}]`, fail);
      }
      validateCarrier(carrier.result, definition, `${where}.result`, fail, {
        position: "return",
      });
      return;
    case "trait-ref":
      requireNonEmpty(carrier.id, `${where}.id`, fail);
      requireRustPath(carrier.path, `${where}.path`, fail);
      if (definition.carrierPaths?.[carrier.id] !== undefined &&
        definition.carrierPaths[carrier.id] !== carrier.path) {
        fail(`${where}.path conflicts with carrierPaths['${carrier.id}']`);
      }
      for (const [index, argument] of carrier.genericArguments.entries()) {
        validateCarrierGenericArgument(argument, definition, `${where}.genericArguments[${index}]`, fail);
      }
      for (const [index, constraint] of carrier.associatedConstraints.entries()) {
        for (const [argumentIndex, argument] of constraint.genericArguments.entries()) {
          validateCarrierGenericArgument(
            argument,
            definition,
            `${where}.associatedConstraints[${index}].genericArguments[${argumentIndex}]`,
            fail,
          );
        }
        if (constraint.kind === "equality") {
          validateCarrier(
            constraint.type,
            definition,
            `${where}.associatedConstraints[${index}].type`,
            fail,
            { allowUnsized: true },
          );
        } else {
          for (const [traitIndex, trait] of constraint.traits.entries()) {
            validateCarrier(
              trait,
              definition,
              `${where}.associatedConstraints[${index}].traits[${traitIndex}]`,
              fail,
              { allowUnsized: true },
            );
          }
          if (constraint.outlives.some((lifetime) => !isRustLifetimeRef(lifetime))) {
            fail(`${where}.associatedConstraints[${index}].outlives contains an invalid lifetime`);
          }
        }
      }
      return;
    case "trait-object":
      validateCarrier(carrier.principal, definition, `${where}.principal`, fail, {
        allowUnsized: true,
      });
      for (const [index, trait] of carrier.autoTraits.entries()) {
        validateCarrier(trait, definition, `${where}.autoTraits[${index}]`, fail, {
          allowUnsized: true,
        });
      }
      return;
    case "impl-trait":
      for (const [index, bound] of carrier.bounds.entries()) {
        validateCarrier(bound, definition, `${where}.bounds[${index}]`, fail, {
          allowUnsized: true,
        });
      }
      if ([...carrier.outlives, ...carrier.captures].some((lifetime) =>
        !isRustLifetimeRef(lifetime))) {
        fail(`${where} contains an invalid opaque lifetime`);
      }
      return;
    case "associated-type":
      validateCarrier(carrier.owner, definition, `${where}.owner`, fail, {
        allowUnsized: true,
      });
      if (carrier.trait !== undefined) {
        validateCarrier(carrier.trait, definition, `${where}.trait`, fail, {
          allowUnsized: true,
        });
      }
      for (const [index, argument] of (carrier.genericArguments ?? []).entries()) {
        if (argument.kind === "type") {
          validateCarrier(
            argument.type,
            definition,
            `${where}.genericArguments[${index}].type`,
            fail,
            { allowUnsized: true },
          );
        }
      }
      return;
    case "opaque":
      return;
    case "target-specific": {
      if (isRustNeverCarrier(carrier)) {
        return;
      }
      const namedType = rustNamedTypeCarrierValue(carrier);
      if (namedType !== undefined) {
        const canonicalPath = definition.carrierPaths?.[namedType.id];
        if (canonicalPath !== undefined && canonicalPath !== namedType.path) {
          fail(`${where}.value.path conflicts with carrierPaths['${namedType.id}']`);
        }
        for (const [index, argument] of namedType.genericArguments.entries()) {
          validateCarrierGenericArgument(
            argument,
            definition,
            `${where}.value.genericArguments[${index}]`,
            fail,
          );
        }
        for (const [index, argument] of namedType.genericDefaults.entries()) {
          validateCarrierGenericArgument(
            argument,
            definition,
            `${where}.value.genericDefaults[${index}]`,
            fail,
          );
        }
        return;
      }
      const fixedArray = rustFixedArrayCarrierValue(carrier);
      if (fixedArray === undefined) {
        fail(`${where} is not a supported Rust target-specific carrier`);
      }
      validateCarrier(fixedArray.element, definition, `${where}.value.element`, fail);
      return;
    }
  }
}

function validateCarrierGenericArgument(
  argument: import("../../../target-model/types/model.js").RustTargetGenericArgument,
  definition: RustProviderPackageDefinition,
  where: string,
  fail: Fail,
): void {
  if (argument.kind === "type") {
    validateCarrier(argument.type, definition, `${where}.type`, fail, {
      allowUnsized: true,
    });
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
    if (!isRustTargetTypeRef(conversion.pointee)) {
      fail(`${where}.pointee is not a closed Rust target type`);
    }
  } else if (conversion.kind === "copy-from-reference") {
    requireExactKeys(asRecord(conversion), ["kind", "target"], where, fail);
    if (!isRustTargetTypeRef(conversion.target)) {
      fail(`${where}.target is not a closed Rust target type`);
    }
  } else if (conversion.kind === "source-union-variant") {
    requireExactKeys(asRecord(conversion), ["kind", "source", "target", "variantName"], where, fail);
    if (!isRustTargetTypeRef(conversion.source) || !isRustTargetTypeRef(conversion.target) ||
      typeof conversion.variantName !== "string" || conversion.variantName.length === 0) {
      fail(`${where} is not an exact closed source-union variant conversion`);
    }
  } else if (conversion.kind === "bottom-coercion") {
    requireExactKeys(asRecord(conversion), ["kind", "source", "target"], where, fail);
    if (!isRustNeverCarrier(conversion.source) || !isRustTargetTypeRef(conversion.target)) {
      fail(`${where} is not an exact Rust bottom coercion`);
    }
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
  } else {
    fail(`${where}.kind '${String((conversion as { readonly kind?: unknown }).kind)}' is not supported`);
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

export function rustSourcePrimitiveHasCarrier(name: import("@tsonic/tsts").SourcePrimitiveKind): boolean {
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
