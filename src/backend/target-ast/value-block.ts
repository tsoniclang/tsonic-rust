import type { RustAttribute } from "./attributes.js";
import type { RustExpr, RustType } from "./nodes.js";

export type RustValueBlockEntry =
  | { readonly name: string; readonly value?: RustExpr; readonly type?: RustType;
      readonly mutable?: boolean; readonly attrs?: readonly RustAttribute[] }
  | { readonly name?: never; readonly value: RustExpr; readonly type?: never;
      readonly mutable?: never; readonly attrs?: never };

export function rustValueBlock(
  bindings: readonly RustValueBlockEntry[],
  value: RustExpr,
  attributes?: {
    readonly inner?: readonly RustAttribute[];
    readonly value?: readonly RustAttribute[];
  },
): RustExpr {
  return {
    kind: "block",
    body: {
      ...(attributes?.inner === undefined ? {} : { innerAttrs: attributes.inner }),
      statements: [
        ...bindings.map(binding => binding.name === undefined ? { kind: "expr" as const, expr: binding.value } : ({
          kind: "let" as const,
          name: binding.name,
          mutable: binding.mutable === true,
          ...(binding.value === undefined ? {} : { init: binding.value }),
          ...(binding.type === undefined ? {} : { type: binding.type }),
          ...(binding.attrs === undefined ? {} : { attrs: binding.attrs }),
        })),
        {
          kind: "tail",
          expr: value,
          ...(attributes?.value === undefined ? {} : { attrs: attributes.value }),
        },
      ],
    },
  };
}
