import {
  rustFixedArrayCarrierValue,
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
import type { TargetTypeRef } from "../../../target-model/types/model.js";

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
  const record = carrier as unknown as Readonly<Record<string, unknown>>;
  switch (carrier.kind) {
    case "source-primitive":
      requireExactKeys(record, ["kind", "name"], where, fail);
      if (!rustSourcePrimitiveHasCarrier(carrier.name)) {
        fail(`${where} uses source primitive '${carrier.name}' with no Rust carrier`);
      }
      return;
    case "target-named":
      requireExactKeys(record, ["kind", "id", "typeArguments"], where, fail);
      requireNonEmpty(carrier.id, `${where}.id`, fail);
      if (!builtInTargetCarrierIds.has(carrier.id) && definition.carrierPaths?.[carrier.id] === undefined) {
        fail(`${where} names target carrier '${carrier.id}' without a Rust carrier path`);
      }
      for (const [index, argument] of (carrier.typeArguments ?? []).entries()) {
        validateCarrier(argument, definition, `${where}.typeArguments[${index}]`, fail, {
          allowUnsized: true,
        });
      }
      return;
    case "type-parameter":
      requireExactKeys(record, ["kind", "name"], where, fail);
      requireRustIdentifier(carrier.name, `${where}.name`, fail);
      return;
    case "array":
      requireExactKeys(record, ["kind", "element", "rank"], where, fail);
      if (carrier.rank !== undefined && carrier.rank !== 1) {
        fail(`${where} has unsupported Rust array rank '${carrier.rank}'`);
      }
      validateCarrier(carrier.element, definition, `${where}.element`, fail);
      return;
    case "slice":
      requireExactKeys(record, ["kind", "element"], where, fail);
      if (options.allowUnsized !== true) {
        fail(`${where} uses a bare Rust slice outside a reference, pointer, or target type argument`);
      }
      validateCarrier(carrier.element, definition, `${where}.element`, fail);
      return;
    case "tuple":
      requireExactKeys(record, ["kind", "elements"], where, fail);
      for (const [index, element] of carrier.elements.entries()) {
        validateCarrier(element, definition, `${where}.elements[${index}]`, fail);
      }
      return;
    case "reference":
      requireExactKeys(record, ["kind", "referent", "mutable", "lifetime"], where, fail);
      if (typeof carrier.mutable !== "boolean" ||
        (carrier.lifetime !== undefined && (typeof carrier.lifetime !== "string" || carrier.lifetime.length === 0))) {
        fail(`${where} has an invalid Rust reference contract`);
      }
      validateCarrier(carrier.referent, definition, `${where}.referent`, fail, {
        allowUnsized: true,
      });
      return;
    case "pointer":
      requireExactKeys(record, ["kind", "pointee", "mutability"], where, fail);
      if (carrier.mutability === "const" || carrier.mutability === "mut") {
        validateCarrier(carrier.pointee, definition, `${where}.pointee`, fail, {
          allowUnsized: true,
        });
        return;
      }
      fail(`${where} is not a renderable Rust pointer carrier`);
    case "function-pointer":
      requireExactKeys(record, ["kind", "args", "result", "abi", "isUnsafe"], where, fail);
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
      requireExactKeys(record, ["kind", "args", "result"], where, fail);
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
    case "target-specific": {
      requireExactKeys(record, ["kind", "target", "name", "value"], where, fail);
      if (isRustNeverCarrier(carrier)) {
        return;
      }
      const fixedArray = rustFixedArrayCarrierValue(carrier);
      if (fixedArray === undefined) {
        fail(`${where} is not a supported Rust target-specific carrier`);
      }
      validateCarrier(fixedArray.element, definition, `${where}.value.element`, fail);
      return;
    }
    default:
      fail(`${where} uses unsupported Rust carrier kind '${carrier.kind}'`);
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
