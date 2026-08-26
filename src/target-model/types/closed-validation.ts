import { isDenseDataArray } from "../metadata/closed-data.js";
import type {
  RustLifetimeRef,
  RustSemanticIdentity,
} from "../semantics/index.js";
import { singleRustUnicodeScalar } from "../syntax/literals.js";

export function isPlainRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function hasExactKeys(
  value: Readonly<Record<string, unknown>>,
  allowed: readonly string[],
  required: readonly string[],
): boolean {
  return Object.keys(value).every((key) => allowed.includes(key)) &&
    required.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

export function isRustSemanticIdentity(value: unknown): value is RustSemanticIdentity {
  if (!isPlainRecord(value)) return false;
  switch (value.kind) {
    case "builtin":
      return hasExactKeys(value, ["kind", "namespace", "itemId"], ["kind", "namespace", "itemId"]) &&
        (value.namespace === "rust" || value.namespace === "tsonic-runtime") &&
        isNonEmptyString(value.itemId);
    case "provider":
      return hasExactKeys(
        value,
        ["kind", "providerId", "providerVersion", "compilationSnapshotId", "itemId"],
        ["kind", "providerId", "compilationSnapshotId", "itemId"],
      ) && isNonEmptyString(value.providerId) &&
        (value.providerVersion === undefined || isNonEmptyString(value.providerVersion)) &&
        isNonEmptyString(value.compilationSnapshotId) && isNonEmptyString(value.itemId);
    case "project":
      return hasExactKeys(
        value,
        ["kind", "packageId", "sourceFileId", "declarationId"],
        ["kind", "packageId", "sourceFileId", "declarationId"],
      ) && isNonEmptyString(value.packageId) && isNonEmptyString(value.sourceFileId) &&
        isNonEmptyString(value.declarationId);
    case "generated":
      return hasExactKeys(value, ["kind", "artifactId", "itemId"], ["kind", "artifactId", "itemId"]) &&
        isNonEmptyString(value.artifactId) && isNonEmptyString(value.itemId);
    default:
      return false;
  }
}

export function isRustLifetime(value: unknown): value is RustLifetimeRef {
  if (!isPlainRecord(value)) return false;
  switch (value.kind) {
    case "static":
      return hasExactKeys(value, ["kind"], ["kind"]);
    case "parameter":
      return hasExactKeys(
        value,
        ["kind", "identity", "displayName"],
        ["kind", "identity", "displayName"],
      ) && isRustSemanticIdentity(value.identity) && isNonEmptyString(value.displayName);
    case "bound":
      return hasExactKeys(
        value,
        ["kind", "binderId", "parameterId", "displayName"],
        ["kind", "binderId", "parameterId", "displayName"],
      ) && isNonEmptyString(value.binderId) && isNonEmptyString(value.parameterId) &&
        isNonEmptyString(value.displayName);
    case "inferred-region":
      return hasExactKeys(value, ["kind", "regionId"], ["kind", "regionId"]) &&
        isNonEmptyString(value.regionId);
    default:
      return false;
  }
}

export function isRustConstExpr(
  value: unknown,
  active: WeakSet<object>,
  depth: number,
): boolean {
  if (!isPlainRecord(value) || depth > 128 || active.has(value)) return false;
  active.add(value);
  try {
    switch (value.kind) {
      case "literal":
        return hasExactKeys(
          value,
          ["kind", "literalKind", "value"],
          ["kind", "literalKind", "value"],
        ) && (
          value.literalKind === "boolean" && typeof value.value === "boolean" ||
          value.literalKind === "integer" && typeof value.value === "bigint" ||
          value.literalKind === "character" && typeof value.value === "string" &&
            singleRustUnicodeScalar(value.value) !== undefined
        );
      case "parameter":
        return hasExactKeys(
          value,
          ["kind", "identity", "displayName"],
          ["kind", "identity", "displayName"],
        ) && isRustSemanticIdentity(value.identity) && isNonEmptyString(value.displayName);
      case "item":
        return hasExactKeys(
          value,
          ["kind", "identity", "displayPath"],
          ["kind", "identity", "displayPath"],
        ) && isRustSemanticIdentity(value.identity) && isStringList(value.displayPath);
      case "unary":
        return hasExactKeys(value, ["kind", "operator", "operand"], ["kind", "operator", "operand"]) &&
          (value.operator === "negate" || value.operator === "not") &&
          isRustConstExpr(value.operand, active, depth + 1);
      case "binary":
        return hasExactKeys(
          value,
          ["kind", "operator", "left", "right"],
          ["kind", "operator", "left", "right"],
        ) && rustConstBinaryOperators.has(value.operator) &&
          isRustConstExpr(value.left, active, depth + 1) &&
          isRustConstExpr(value.right, active, depth + 1);
      case "inferred":
        return hasExactKeys(value, ["kind"], ["kind"]);
      default:
        return false;
    }
  } finally {
    active.delete(value);
  }
}

export function isStringList(value: unknown): boolean {
  return isDenseDataArray(value) && value.length > 0 && value.every(isNonEmptyString);
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

const rustConstBinaryOperators = new Set<unknown>([
  "add", "subtract", "multiply", "divide", "remainder", "shift-left", "shift-right",
  "bit-and", "bit-or", "bit-xor",
]);
