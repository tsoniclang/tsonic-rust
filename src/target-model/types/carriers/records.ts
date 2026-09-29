import type { TargetTypeRef } from "../model.js";
import { rustOnlyTypeGenericArguments, rustTypeGenericArguments } from "../generic-arguments.js";
import { rustNamedTargetType, rustNamedTypeCarrierValue } from "./native.js";
import { rustTargetTypeRefEquals } from "../equality.js";

export function rustRecordTargetType(key: TargetTypeRef, value: TargetTypeRef): TargetTypeRef {
  return rustNamedTargetType("tsonic.rust.Record", "rt::Record", rustTypeGenericArguments([key, value]), [], {
    implementations: ["core::clone::Clone", "core::cmp::Eq", "core::cmp::PartialEq", "core::default::Default", "core::fmt::Debug"]
      .map(traitPath => ({ traitPath, requirements: [] })),
  });
}

export function rustRecordCarrierValue(carrier: TargetTypeRef | undefined): {
  readonly key: TargetTypeRef;
  readonly value: TargetTypeRef;
} | undefined {
  const named = rustNamedTypeCarrierValue(carrier);
  if (named?.id !== "tsonic.rust.Record") return undefined;
  const arguments_ = rustOnlyTypeGenericArguments(named.genericArguments);
  if (arguments_?.length !== 2 || !rustTargetTypeRefEquals(carrier, rustRecordTargetType(arguments_[0]!, arguments_[1]!))) return undefined;
  return { key: arguments_[0]!, value: arguments_[1]! };
}

export type RustIndexedRecordStorage =
  | { readonly kind: "project-field"; readonly name: string }
  | { readonly kind: "record" };
