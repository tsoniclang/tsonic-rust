import type { SourcePrimitiveKind } from "@tsonic/tsts";
import type {
  RustGenericArgument,
  RustSemanticIdentity,
  RustTraitRef,
} from "../../semantics/index.js";
import {
  rustBuiltinIdentity,
} from "../../semantics/index.js";
import {
  rustBuiltinPathTargetType,
  rustFixedArrayType,
  rustInferredLifetime,
  rustPathTargetType,
  rustReferenceTargetType,
  rustSequenceTargetType,
} from "../constructors.js";
import { isRustTargetTypeRef } from "../equality.js";
import {
  rustBigIntTargetId,
  rustNullTargetId,
  rustStringTargetId,
  rustUndefinedTargetId,
} from "./source-types.js";
import type { TargetTypeRef } from "../model.js";

export function rustSourcePrimitiveTargetType(kind: SourcePrimitiveKind): TargetTypeRef {
  return Object.freeze({ kind: "source-primitive", name: kind });
}

export function rustStringTargetType(): TargetTypeRef {
  return rustBuiltinPathTargetType(rustStringTargetId, "String");
}

export function rustBorrowedStrTargetType(): TargetTypeRef {
  return rustReferenceTargetType(
    { kind: "str" },
    false,
    rustInferredLifetime("policy\0borrowed-str"),
  );
}

export function rustBigIntTargetType(): TargetTypeRef {
  return rustBuiltinPathTargetType(
    rustBigIntTargetId,
    "rt::BigInt",
    [],
    "tsonic-runtime",
  );
}

export function rustUnitTargetType(): TargetTypeRef {
  return Object.freeze({ kind: "unit" });
}

export function rustNeverTargetType(): TargetTypeRef {
  return Object.freeze({ kind: "never" });
}

export function rustUndefinedTargetType(): TargetTypeRef {
  return rustBuiltinPathTargetType(
    rustUndefinedTargetId,
    "rt::Undefined",
    [],
    "tsonic-runtime",
  );
}

export function rustNullTargetType(): TargetTypeRef {
  return rustBuiltinPathTargetType(
    rustNullTargetId,
    "rt::Null",
    [],
    "tsonic-runtime",
  );
}

export function rustVecTargetType(element: TargetTypeRef): TargetTypeRef {
  return rustSequenceTargetType(element);
}

export function rustTupleTargetType(elements: readonly TargetTypeRef[]): TargetTypeRef {
  if (elements.length === 0) return rustUnitTargetType();
  return Object.freeze({ kind: "tuple", elements: Object.freeze([...elements]) });
}

export function rustTupleElementCarriers(
  carrier: TargetTypeRef | undefined,
): readonly TargetTypeRef[] | undefined {
  if (carrier?.kind === "unit") return Object.freeze([]);
  return carrier?.kind === "tuple" ? carrier.elements : undefined;
}

export interface RustFixedArrayCarrierValue {
  readonly element: TargetTypeRef;
  readonly length: number;
}

export interface RustNamedTypeCarrierValue {
  readonly identity: RustSemanticIdentity;
  readonly path: string;
  readonly arguments: readonly RustGenericArgument[];
}

export function rustNamedTargetType(
  id: string,
  path: string,
  typeArguments: readonly TargetTypeRef[] = [],
  identity: RustSemanticIdentity = rustBuiltinIdentity(id),
): TargetTypeRef {
  const arguments_ = Object.freeze(typeArguments.map((value) => Object.freeze({
    kind: "type" as const,
    value,
  })));
  return rustPathTargetType({
    identity,
    displayPath: Object.freeze(path.split("::")),
    arguments: arguments_,
  });
}

export function rustNamedTypeCarrierValue(
  carrier: TargetTypeRef | undefined,
): RustNamedTypeCarrierValue | undefined {
  if (carrier?.kind !== "path") return undefined;
  return {
    identity: carrier.identity,
    path: carrier.displayPath.join("::"),
    arguments: carrier.arguments,
  };
}

export function rustTraitReference(
  path: string,
  identity: RustSemanticIdentity = rustBuiltinIdentity(path),
): RustTraitRef {
  return Object.freeze({
    identity,
    displayPath: Object.freeze(path.split("::")),
    arguments: Object.freeze([]),
    associatedConstraints: Object.freeze([]),
  });
}

export function rustFixedArrayTargetType(
  element: TargetTypeRef,
  length: number,
): TargetTypeRef {
  if (!Number.isSafeInteger(length) || length < 0) {
    throw new Error(`Rust fixed-array length must be a non-negative safe integer; received ${String(length)}.`);
  }
  return rustFixedArrayType(element, { kind: "literal", literalKind: "integer", value: BigInt(length) });
}

export function rustFixedArrayCarrierValue(
  carrier: TargetTypeRef | undefined,
): RustFixedArrayCarrierValue | undefined {
  if (carrier?.kind !== "array" || carrier.length.kind !== "literal" ||
    carrier.length.literalKind !== "integer" ||
    typeof carrier.length.value !== "bigint" || carrier.length.value < 0n ||
    carrier.length.value > BigInt(Number.MAX_SAFE_INTEGER) ||
    !isRustTargetTypeRef(carrier.element)) {
    return undefined;
  }
  return { element: carrier.element, length: Number(carrier.length.value) };
}
