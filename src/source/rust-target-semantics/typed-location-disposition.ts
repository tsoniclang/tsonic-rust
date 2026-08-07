import {
  pointerOperationFactKey,
} from "@tsonic/tsts";
import type {
  ExtensionFactSubject,
  PointerOperationFact,
  SourceCallMarkerKind,
} from "@tsonic/tsts";

export type RustTypedLocationDisposition =
  | { readonly kind: "not-typed-location" }
  | {
      readonly kind: "evidence-missing";
      readonly operation: RustTypedLocationOperationKind;
    }
  | {
      readonly kind: "unsupported";
      readonly operation: RustTypedLocationOperationKind;
    };

export type RustTypedLocationOperationKind = Extract<
  SourceCallMarkerKind,
  "address-of" | "allocate" | "load" | "store"
>;

export function selectRustTypedLocationDisposition(
  subject: ExtensionFactSubject,
  marker: SourceCallMarkerKind,
  resolveFact: RustTypedLocationFactLookup,
  getFact: RustTypedLocationFactLookup,
): RustTypedLocationDisposition {
  if (!isRustTypedLocationOperation(marker)) {
    return { kind: "not-typed-location" };
  }
  const sourceOperation = resolveFact(subject, pointerOperationFactKey) ??
    getFact(subject, pointerOperationFactKey);
  return sourceOperation?.operation === marker
    ? { kind: "unsupported", operation: marker }
    : { kind: "evidence-missing", operation: marker };
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
    case "load":
    case "store":
      return true;
    default:
      return false;
  }
}
