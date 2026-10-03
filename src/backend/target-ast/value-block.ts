import type { RustAttribute } from "./attributes.js";
import type { RustExpr, RustType } from "./nodes.js";

export function rustValueBlock(
  bindings: readonly {
    readonly name: string;
    readonly value?: RustExpr;
    readonly type?: RustType;
    readonly mutable?: boolean;
    readonly attrs?: readonly RustAttribute[];
  }[],
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
        ...bindings.map(binding => ({
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
