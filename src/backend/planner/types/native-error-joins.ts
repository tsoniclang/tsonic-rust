import { rustTypeEquals } from "../../target-ast/syntax/type-equality.js";
import { failRustPlannerInvariant } from "../diagnostics.js";
import type { RustExpr, RustItem, RustPattern, RustType, RustVisibility } from "../../target-ast/syntax/nodes.js";
import { emptyRustGenerics } from "../../target-ast/syntax/nodes.js";
import { rustDeriveAttributes } from "../../target-ast/syntax/attributes.js";
import { isValidRustIdentifier } from "../../../target-model/names/identifiers.js";
import type { RustNativeErrorSource } from "../../../target-model/types/native-error-joins.js";
import type { RustErrorJoinDeclaration } from "../../../target-model/records/errors/error-regions.js";
import { rustTargetRuntimeErrorType } from "./error-boundary.js";

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

export function planRustNativeErrorRuntimeFrom(declaration: RustErrorJoinDeclaration): RustItem | undefined {
  const arm = declaration.runtimeErrorArm;
  if (arm === undefined) return undefined;
  if (!Number.isInteger(arm) || arm < 0 || arm >= declaration.arity || declaration.arity < 2)
    failRustPlannerInvariant("An admitted intrinsic error conversion requires its exact declared native join arm.");
  const parameters = Array.from({ length: declaration.arity }, (_value, index) => ({
    kind: "type" as const, name: `Error${index}`, bounds: [],
  }));
  const selected: RustType = { kind: "named", path: parameters[arm]!.name };
  const from: RustType = { kind: "named", path: "core::convert::From",
    genericArguments: [{ kind: "type", type: rustTargetRuntimeErrorType }] };
  return {
    kind: "impl", trait: from,
    target: { kind: "named", path: declaration.name, genericArguments: parameters.map(parameter => ({
      kind: "type", type: { kind: "named", path: parameter.name },
    })) },
    generics: { parameters, wherePredicates: [{ kind: "type", type: selected,
      bounds: [{ kind: "trait-type", reference: { trait: from } }] }] },
    members: [{ kind: "function", name: "from", visibility: "private", generics: emptyRustGenerics,
      params: [{ name: "value", type: rustTargetRuntimeErrorType }], returnType: { kind: "named", path: "Self" },
      body: { statements: [{ kind: "tail", expr: { kind: "call", path: `Self::Error${arm}`, args: [{
        kind: "associated-call", owner: selected, trait: from, method: "from", args: [{ kind: "path", path: "value" }],
      }] } }] },
    }],
  };
}

export function planRustNativeErrorJoin(input: {
  readonly identity: string;
  readonly name: string;
  readonly referencePath?: string;
  readonly visibility: RustVisibility;
  readonly resultShape: "value" | "result";
  readonly sources: readonly RustNativeErrorJoinSource[];
  readonly clone?: boolean;
}): RustNativeErrorJoinPlan | undefined {
  if (input.resultShape !== "value" && input.resultShape !== "result")
    failRustPlannerInvariant("An admitted native error join requires its explicit Result or value ABI.");
  const selectedSources = input.sources;
  if (input.resultShape === "value" && selectedSources.length !== 0)
    failRustPlannerInvariant("An admitted native value ABI cannot carry a fallible error join.");
  if (new Set(selectedSources.map(source => source.identity)).size !== selectedSources.length)
    failRustPlannerInvariant("An admitted native error join requires its unique sealed source identities.");
  const sources = new Map(selectedSources.map(source => [source.identity, source]));
  const parameters = selectedSources.map((_source, index) => ({ kind: "type" as const, name: `Error${index}`, bounds: [] }));
  const arguments_ = selectedSources.map(source => ({ kind: "type" as const, type: source.errorType }));
  const errorType: RustType | undefined = selectedSources.length === 0
    ? input.resultShape === "value" ? undefined : { kind: "named", path: "core::convert::Infallible" }
    : selectedSources.length === 1
    ? selectedSources[0]!.errorType : { kind: "named", path: input.referencePath ?? input.name,
      identity: input.identity, genericArguments: arguments_ };
  const items: readonly RustItem[] = selectedSources.length < 2 ? Object.freeze([]) : Object.freeze([{
    kind: "enum", name: input.name, visibility: input.visibility, generics: { ...emptyRustGenerics, parameters },
    attrs: rustDeriveAttributes(input.clone === true ? ["Debug", "Clone"] : ["Debug"]),
    variants: Object.freeze([...sources.values()].map((source, index) => ({ name: source.variant,
      fields: [{ kind: "named" as const, path: parameters[index]!.name }] }))),
  }]);
  const select = (source: RustNativeErrorJoinSelection): RustNativeErrorJoinSource | undefined => {
    // A selection must name a sealed source with the identical error type; a foreign or inconsistent carrier rejects.
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
      if (value === undefined) return undefined;
      if (errorType === undefined) failRustPlannerInvariant("An admitted error propagation requires its native joined error type.");
      return { kind: "try", expr: value, nativeReturn: true,
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
      if (errorType === undefined) failRustPlannerInvariant("An admitted error propagation requires its native joined error type.");
      return { kind: "try", expr: mapped, operandErrorType: errorType, resultErrorType: errorType };
    },
  });
}
