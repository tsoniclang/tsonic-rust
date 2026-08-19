import {
  sourcePrimitive,
} from "@tsonic/tsts";
import type {
  SourceSemanticsModule,
} from "@tsonic/tsts";

export const rustTypesModule = "@tsonic/rust/types.js";
export const rustLangModule = "@tsonic/rust/lang.js";

const rustPrimitiveAliases = [
  sourcePrimitive("bool", "bool", "boolean"),
  sourcePrimitive("i8", "int8", "number", true, 8),
  sourcePrimitive("u8", "uint8", "number", false, 8),
  sourcePrimitive("i16", "int16", "number", true, 16),
  sourcePrimitive("u16", "uint16", "number", false, 16),
  sourcePrimitive("i32", "int32", "number", true, 32),
  sourcePrimitive("u32", "uint32", "number", false, 32),
  sourcePrimitive("i64", "int64", "bigint", true, 64),
  sourcePrimitive("u64", "uint64", "bigint", false, 64),
  sourcePrimitive("i128", "int128", "bigint", true, 128),
  sourcePrimitive("u128", "uint128", "bigint", false, 128),
  sourcePrimitive("isize", "native-int", "number", true),
  sourcePrimitive("usize", "native-uint", "number", false),
  sourcePrimitive("f32", "float32", "number", true, 32),
  sourcePrimitive("f64", "float64", "number", true, 64),
] satisfies SourceSemanticsModule["exports"];

const rustFlowAliases = [
  { kind: "call-marker", exportName: "borrow", marker: "shared-borrow" },
  { kind: "call-marker", exportName: "borrowMut", marker: "mutable-borrow" },
  { kind: "call-marker", exportName: "move", marker: "move" },
] satisfies SourceSemanticsModule["exports"];

export function rustSourceSemanticsModules(): readonly SourceSemanticsModule[] {
  return [
    {
      moduleSpecifier: rustTypesModule,
      packageName: "@tsonic/rust",
      subpath: "types.js",
      capabilities: ["primitive"],
      exports: rustPrimitiveAliases,
    },
    {
      moduleSpecifier: rustLangModule,
      packageName: "@tsonic/rust",
      subpath: "lang.js",
      capabilities: ["call-marker"],
      exports: rustFlowAliases,
    },
  ];
}
