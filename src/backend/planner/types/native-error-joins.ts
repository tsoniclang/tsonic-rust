import type { RustExpr, RustItem, RustType, RustVisibility } from "../../target-ast/nodes.js";
import { emptyRustGenerics } from "../../target-ast/nodes.js";
import { rustTypeEquals } from "../../target-ast/inspection/type-equality.js";
import { isValidRustIdentifier } from "../../../target-model/names/identifiers.js";
import { rustTypeIsLegalInPosition } from "./type-observations.js";
import { hasExactObjectKeys } from "../../../target-model/metadata/closed-data.js";

export interface RustNativeErrorJoinSource {
  readonly identity: string;
  readonly variant: string;
  readonly errorType: RustType;
}

export type RustNativeErrorJoinSelection = Pick<RustNativeErrorJoinSource, "identity" | "errorType">;

export interface RustNativeErrorJoinPlan {
  readonly errorType: RustType | undefined;
  readonly items: readonly RustItem[];
  accepts(source: RustNativeErrorJoinSelection): boolean;
  inject(source: RustNativeErrorJoinSelection, error: RustExpr): RustExpr | undefined;
  propagate(source: RustNativeErrorJoinSelection, result: RustExpr): RustExpr | undefined;
}

export function planRustNativeErrorJoin(input: {
  readonly identity: string;
  readonly name: string;
  readonly visibility: RustVisibility;
  readonly sources: readonly RustNativeErrorJoinSource[];
}): RustNativeErrorJoinPlan | undefined {
  const semanticName = (name: string): string => name.startsWith("r#") ? name.slice(2) : name;
  if (!hasExactObjectKeys(input, ["identity", "name", "visibility", "sources"]) ||
    input.identity.length === 0 || !isValidRustIdentifier(input.name) ||
    input.sources.some(source => source.identity.length === 0 || !isValidRustIdentifier(source.variant) ||
      source.errorType === undefined || source.errorType.kind === "infer" || !rustTypeIsLegalInPosition(source.errorType, "general")) ||
    new Set(input.sources.map(source => source.identity)).size !== input.sources.length ||
    new Set(input.sources.map(source => semanticName(source.variant))).size !== input.sources.length) return undefined;
  const sources = new Map(input.sources.map(source => [source.identity, Object.freeze({ ...source })]));
  const parameters = input.sources.map((_source, index) => ({ kind: "type" as const, name: `Error${index}`, bounds: [] }));
  const arguments_ = input.sources.map(source => ({ kind: "type" as const, type: source.errorType }));
  const errorType: RustType | undefined = sources.size === 0 ? undefined : sources.size === 1
    ? input.sources[0]!.errorType : { kind: "named", path: input.name, identity: input.identity, genericArguments: arguments_ };
  const items: readonly RustItem[] = sources.size < 2 ? Object.freeze([]) : Object.freeze([{
    kind: "enum", name: input.name, visibility: input.visibility, generics: { ...emptyRustGenerics, parameters },
    variants: Object.freeze([...sources.values()].map((source, index) => ({ name: source.variant,
      fields: [{ kind: "named" as const, path: parameters[index]!.name }] }))),
  }]);
  const select = (source: RustNativeErrorJoinSelection): RustNativeErrorJoinSource | undefined => {
    const selected = sources.get(source.identity);
    return selected !== undefined && rustTypeEquals(selected.errorType, source.errorType) ? selected : undefined;
  };
  return Object.freeze({ errorType, items,
    accepts(source: RustNativeErrorJoinSelection): boolean {
      return select(source) !== undefined;
    },
    inject(source: RustNativeErrorJoinSelection, error: RustExpr): RustExpr | undefined {
      const selected = select(source);
      return selected === undefined || errorType === undefined ? undefined : sources.size === 1 ? error
        : { kind: "associated-call", owner: errorType, method: selected.variant, args: [error] };
    },
    propagate(source: RustNativeErrorJoinSelection, result: RustExpr): RustExpr | undefined {
      const selected = select(source);
      if (selected === undefined || errorType === undefined) return undefined;
      const mapped: RustExpr = sources.size === 1 ? result : {
        kind: "method-call", receiver: result, method: "map_err",
        args: [{ kind: "associated-value", owner: errorType, name: selected.variant }],
      };
      return { kind: "try", expr: mapped, operandErrorType: errorType, resultErrorType: errorType };
    },
  });
}
