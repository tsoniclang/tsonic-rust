import type { TargetTypeRef } from "../model.js";
import { rustNamedTargetType, rustNativeTraitRef } from "./native.js";

export function rustRuntimeRecordFieldTargetType(value: TargetTypeRef, error: TargetTypeRef): TargetTypeRef {
  return rustNamedTargetType("rust.runtime.RecordField", "rt::RecordField", [
    { kind: "type", type: value }, { kind: "type", type: error },
  ], [], { implementations: [
    { trait: rustNativeTraitRef("core::clone::Clone"), requirements: [{ typeArgumentIndex: 0, trait: rustNativeTraitRef("core::clone::Clone") }] },
    { trait: rustNativeTraitRef("core::default::Default"), requirements: [{ typeArgumentIndex: 0, trait: rustNativeTraitRef("core::default::Default") }] },
  ] }, [], undefined, []);
}

export function rustRuntimeNativeLayoutTargetType(pointee: TargetTypeRef): TargetTypeRef {
  return rustNamedTargetType("rust.runtime.NativeLayout", "rt::raw_memory::NativeLayout", [
    { kind: "type", type: pointee },
  ], [], { implementations: [
    { trait: rustNativeTraitRef("core::clone::Clone"), requirements: [] },
    { trait: rustNativeTraitRef("core::marker::Copy"), requirements: [] },
  ] }, [], undefined, []);
}

export function rustRuntimeNativeArrayTargetType(pointee: TargetTypeRef): TargetTypeRef {
  return rustNamedTargetType("rust.runtime.NativeArray", "rt::raw_memory::NativeArray", [
    { kind: "type", type: pointee },
  ], [], { implementations: [{ trait: rustNativeTraitRef("core::clone::Clone"), requirements: [] }] }, [], undefined, []);
}

export function rustRuntimeNativeMethodTargetType(
  parameters: readonly TargetTypeRef[], result: TargetTypeRef, error: TargetTypeRef,
): Extract<TargetTypeRef, { readonly kind: "function-pointer" }> {
  return { kind: "function-pointer", args: parameters,
    result: rustNamedTargetType("rust.core.Result", "Result", [
      { kind: "type", type: result }, { kind: "type", type: error },
    ], [], undefined, [], undefined, []) };
}
