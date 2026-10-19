import type { RustExpr, RustItem, RustPattern, RustType, RustVisibility } from "../../target-ast/syntax/nodes.js";
import { emptyRustGenerics } from "../../target-ast/syntax/nodes.js";
import { rustDeriveAttributes } from "../../target-ast/syntax/attributes.js";
import { rustTypeEquals } from "../../target-ast/inspection/type-equality.js";
import { isValidRustIdentifier } from "../../../target-model/names/identifiers.js";
import { rustTypeIsLegalInPosition } from "./type-observations.js";
import { hasExactObjectKeys } from "../../../target-model/metadata/closed-data.js";
import { snapshotRustNativeErrorSources, type RustNativeErrorSource } from "../../../target-model/types/native-error-joins.js";

export type RustNativeErrorJoinSource = RustNativeErrorSource<RustType>;

export type RustNativeErrorJoinSelection = Pick<RustNativeErrorJoinSource, "identity" | "errorType">;

export interface RustNativeErrorJoinPlan {
  readonly errorType: RustType | undefined;
  readonly items: readonly RustItem[];
  mapError(error: RustExpr, bindingName: string,
    select: (source: RustNativeErrorJoinSelection, value: RustExpr) => RustExpr | undefined): RustExpr | undefined;
  accepts(source: RustNativeErrorJoinSelection): boolean;
  inject(source: RustNativeErrorJoinSelection, error: RustExpr): RustExpr | undefined;
  propagate(source: RustNativeErrorJoinSelection, result: RustExpr): RustExpr | undefined;
  propagatedValue(source: RustNativeErrorJoinSelection, result: RustExpr): RustExpr | undefined;
  propagateReturn(source: RustNativeErrorJoinSelection, result: RustExpr): RustExpr | undefined;
}

export function planRustNativeErrorJoin(input: {
  readonly identity: string;
  readonly name: string;
  readonly referencePath?: string;
  readonly visibility: RustVisibility;
  readonly sources: readonly RustNativeErrorJoinSource[];
  readonly clone?: boolean;
}): RustNativeErrorJoinPlan | undefined {
  const selectedSources = snapshotRustNativeErrorSources(input.sources, errorType => errorType !== undefined &&
    errorType.kind !== "infer" && rustTypeIsLegalInPosition(errorType, "general"));
  if (!hasExactObjectKeys(input, ["identity", "name", "visibility", "sources",
      ...(input.referencePath === undefined ? [] : ["referencePath"]),
      ...(input.clone === undefined ? [] : ["clone"])]) ||
    input.clone !== undefined && typeof input.clone !== "boolean" ||
    input.identity.length === 0 || !isValidRustIdentifier(input.name) ||
    input.referencePath !== undefined && !input.referencePath.split("::").every(segment =>
      segment === "crate" || segment === "self" || segment === "super" || isValidRustIdentifier(segment)) ||
    selectedSources === undefined) return undefined;
  const sources = new Map(selectedSources.map(source => [source.identity, source]));
  const parameters = selectedSources.map((_source, index) => ({ kind: "type" as const, name: `Error${index}`, bounds: [] }));
  const arguments_ = selectedSources.map(source => ({ kind: "type" as const, type: source.errorType }));
  const errorType: RustType | undefined = selectedSources.length === 0 ? undefined : selectedSources.length === 1
    ? selectedSources[0]!.errorType : { kind: "named", path: input.referencePath ?? input.name,
      identity: input.identity, genericArguments: arguments_ };
  const items: readonly RustItem[] = selectedSources.length < 2 ? Object.freeze([]) : Object.freeze([{
    kind: "enum", name: input.name, visibility: input.visibility, generics: { ...emptyRustGenerics, parameters },
    attrs: rustDeriveAttributes(input.clone === true ? ["Debug", "Clone"] : ["Debug"]),
    variants: Object.freeze([...sources.values()].map((source, index) => ({ name: source.variant,
      fields: [{ kind: "named" as const, path: parameters[index]!.name }] }))),
  }]);
  const select = (source: RustNativeErrorJoinSelection): RustNativeErrorJoinSource | undefined => {
    const selected = sources.get(source.identity);
    return selected !== undefined && rustTypeEquals(selected.errorType, source.errorType) ? selected : undefined;
  };
  const propagatedValue = (source: RustNativeErrorJoinSelection, result: RustExpr): RustExpr | undefined => {
    const selected = select(source);
    if (selected === undefined || errorType === undefined) return undefined;
    return sources.size === 1 ? result : {
      kind: "method-call", receiver: result, method: "map_err",
      args: [{ kind: "associated-value", owner: errorType, name: selected.variant }],
    };
  };
  return Object.freeze({ errorType, items,
    propagatedValue,
    propagateReturn(source: RustNativeErrorJoinSelection, result: RustExpr): RustExpr | undefined {
      const value = propagatedValue(source, result);
      return value === undefined ? undefined : { kind: "try", expr: value, nativeReturn: true,
        operandErrorType: errorType, resultErrorType: errorType };
    },
    mapError(error: RustExpr, bindingName: string,
      select: (source: RustNativeErrorJoinSelection, value: RustExpr) => RustExpr | undefined): RustExpr | undefined {
      if (errorType === undefined || !isValidRustIdentifier(bindingName)) return undefined;
      if (selectedSources.length === 1) return select(selectedSources[0]!, error);
      const value: RustExpr = { kind: "path", path: bindingName };
      const arms: { pattern: RustPattern; expression: RustExpr }[] = [];
      for (const source of sources.values()) {
        const expression = select(source, value);
        if (expression === undefined) return undefined;
        arms.push({ pattern: { kind: "tuple-variant", path: `${input.referencePath ?? input.name}::${source.variant}`,
          elements: [{ kind: "binding", name: bindingName }] }, expression });
      }
      return { kind: "match", expression: error, arms };
    },
    accepts(source: RustNativeErrorJoinSelection): boolean {
      return select(source) !== undefined;
    },
    inject(source: RustNativeErrorJoinSelection, error: RustExpr): RustExpr | undefined {
      const selected = select(source);
      return selected === undefined || errorType === undefined ? undefined : sources.size === 1 ? error
        : { kind: "associated-call", owner: errorType, method: selected.variant, args: [error] };
    },
    propagate(source: RustNativeErrorJoinSelection, result: RustExpr): RustExpr | undefined {
      const mapped = propagatedValue(source, result);
      if (mapped === undefined) return undefined;
      return { kind: "try", expr: mapped, operandErrorType: errorType, resultErrorType: errorType };
    },
  });
}
