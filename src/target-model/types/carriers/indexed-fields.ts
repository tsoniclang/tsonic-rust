import type { RustTargetTraitRef, TargetTypeRef } from "../model.js";
import { rustNamedTargetType } from "./native.js";

export const rustIndexedFieldTrait: RustTargetTraitRef = Object.freeze({
  kind: "trait-ref",
  id: "rust.source.indexed-field",
  path: "rt::Field",
  genericArguments: Object.freeze([]),
  associatedConstraints: Object.freeze([]),
});

export function rustIndexedFieldProjection(owner: TargetTypeRef, key: TargetTypeRef): TargetTypeRef {
  return {
    kind: "associated-type", owner, name: "Output",
    trait: { ...rustIndexedFieldTrait, genericArguments: [{ kind: "type", type: key }] },
  };
}

export function rustIndexedFieldKey(identity: string): TargetTypeRef {
  if (!/^[0-9a-f]{32}$/u.test(identity)) throw new Error("A field key requires its exact bounded identity.");
  return rustNamedTargetType("rust.source.field-key", "rt::FieldKey", [
    { kind: "const", value: { kind: "integer", value: BigInt(`0x${identity}`).toString() } },
  ], [], { implementations: [
    { traitPath: "core::clone::Clone", requirements: [] },
    { traitPath: "core::marker::Copy", requirements: [] },
  ] });
}
