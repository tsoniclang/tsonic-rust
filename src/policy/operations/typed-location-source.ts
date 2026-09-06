import {
  pointerOperationFactKey,
} from "@tsonic/tsts";
import type {
  ExtensionFactSubject,
  PointerOperationFact,
  SourceCallMarkerKind,
} from "@tsonic/tsts";

export type RustTypedLocationSourceSelection =
  | { readonly kind: "not-typed-location" }
  | {
      readonly kind: "evidence-missing";
      readonly operation: RustTypedLocationOperationKind;
    }
  | {
      readonly kind: "selected";
      readonly operation: RustTypedLocationOperationKind;
      readonly sourceOperation: RustTypedLocationSourceFact;
    };

export type RustTypedLocationOperationKind = Extract<
  SourceCallMarkerKind,
  | "address-of"
  | "allocate"
  | "bind-pointer"
  | "equal-pointer"
  | "hash-pointer"
  | "load"
  | "project-pointer"
  | "store"
>;

export type RustTypedLocationSourceFact = Extract<
  PointerOperationFact,
  { readonly operation: RustTypedLocationOperationKind }
>;

export type RustAddressOfSourceFact = Extract<
  RustTypedLocationSourceFact,
  { readonly operation: "address-of" }
>;

export function selectRustTypedLocationSourceOperation(
  subject: ExtensionFactSubject,
  marker: SourceCallMarkerKind,
  resolveFact: RustTypedLocationFactLookup,
  getFact: RustTypedLocationFactLookup,
): RustTypedLocationSourceSelection {
  if (!isRustTypedLocationOperation(marker)) {
    return { kind: "not-typed-location" };
  }
  const sourceOperation = rustTypedLocationSourceFact(subject, resolveFact, getFact);
  return sourceOperation !== undefined &&
      isRustTypedLocationSourceFact(sourceOperation) &&
      sourceOperation.operation === marker &&
      sourceOperation.call === subject
    ? { kind: "selected", operation: marker, sourceOperation }
    : { kind: "evidence-missing", operation: marker };
}

export function selectRustAddressOfSourceOperation(
  subject: ExtensionFactSubject,
  resolveFact: RustTypedLocationFactLookup,
  getFact: RustTypedLocationFactLookup,
): RustAddressOfSourceFact | undefined {
  const sourceOperation = rustTypedLocationSourceFact(subject, resolveFact, getFact);
  return sourceOperation?.operation === "address-of" && sourceOperation.call === subject
    ? sourceOperation
    : undefined;
}

function rustTypedLocationSourceFact(
  subject: ExtensionFactSubject,
  resolveFact: RustTypedLocationFactLookup,
  getFact: RustTypedLocationFactLookup,
): RustTypedLocationSourceFact | undefined {
  const sourceOperation = resolveFact(subject, pointerOperationFactKey) ??
    getFact(subject, pointerOperationFactKey);
  return sourceOperation !== undefined && isRustTypedLocationSourceFact(sourceOperation)
    ? sourceOperation
    : undefined;
}

function isRustTypedLocationSourceFact(
  fact: PointerOperationFact,
): fact is RustTypedLocationSourceFact {
  return isRustTypedLocationOperation(fact.operation);
}

type RustTypedLocationFactLookup = (
  subject: ExtensionFactSubject,
  key: typeof pointerOperationFactKey,
) => PointerOperationFact | undefined;

function isRustTypedLocationOperation(
  marker: SourceCallMarkerKind,
): marker is RustTypedLocationOperationKind {
  switch (marker) {
    case "address-of":
    case "allocate":
    case "bind-pointer":
    case "equal-pointer":
    case "hash-pointer":
    case "load":
    case "project-pointer":
    case "store":
      return true;
    default:
      return false;
  }
}
