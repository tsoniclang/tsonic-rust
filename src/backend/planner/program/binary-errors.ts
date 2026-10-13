import type { Node } from "@tsonic/tsts";
import type { RustExpr, RustItem, RustType } from "../../target-ast/syntax/nodes.js";
import { emptyRustGenerics } from "../../target-ast/syntax/nodes.js";
import { rustTypeEquals } from "../../target-ast/inspection/type-equality.js";
import { rustErrorEffectsFactKey } from "../../../analysis/facts/error-effects.js";
import { planRustSelectedErrorRegion } from "./error-regions.js";
import { rustRuntimeAliasUseItems } from "./plan-context.js";
import { planRustNativeErrorJoin } from "../types/native-error-joins.js";
import type { RustTypeRenderingContext } from "../types/render.js";
import { collectAliasesFromRustType } from "../types/type-observations.js";

export function planRustBinaryEntryError(
  declaration: Node,
  name: string,
  packageErrorType: RustType,
  context: RustTypeRenderingContext,
  programModuleName: string | undefined,
): { readonly errorType?: RustType; readonly libraryItems: readonly RustItem[] } | undefined {
  const effects = context.input.program.facts.getFact(declaration, rustErrorEffectsFactKey);
  const aliases = new Set<string>();
  const selected = effects === undefined ? undefined : planRustSelectedErrorRegion(declaration, effects, { ...context, usedAliases: aliases });
  if (selected === undefined) return undefined;
  const errorType = selected.boundary?.errorType;
  if (errorType === undefined) return Object.freeze({ libraryItems: Object.freeze([]) });
  if (rustTypeEquals(errorType, packageErrorType)) return Object.freeze({ errorType: packageErrorType, libraryItems: Object.freeze([]) });
  if (context.crateName === undefined) return undefined;
  collectAliasesFromRustType(errorType, path => aliases.add(path.split("::")[0]!));
  return Object.freeze({ errorType: { kind: "named", path: `${context.crateName}::${name}` }, libraryItems: Object.freeze([
    ...rustRuntimeAliasUseItems(aliases, programModuleName),
    { kind: "type-alias" as const, name, visibility: "public" as const, generics: emptyRustGenerics, target: errorType },
  ]) });
}

export interface RustBinaryErrorPlan {
  readonly errorType: RustType;
  readonly items: readonly RustItem[];
  entry(result: RustExpr): RustExpr;
  lifecycle(result: RustExpr, operandErrorType: RustType): RustExpr;
  lifecycleError(error: RustExpr, operandErrorType: RustType): RustExpr;
}

export function planRustBinaryErrors(input: {
  readonly entryErrorType: RustType | undefined;
  readonly lifecycleErrorType: RustType;
  readonly lifecycleFallible: boolean;
}): RustBinaryErrorPlan | undefined {
  const same = rustTypeEquals(input.entryErrorType, input.lifecycleErrorType);
  const lifecycle = { identity: "lifecycle", variant: "Lifecycle", errorType: input.lifecycleErrorType };
  const entry = input.entryErrorType === undefined ? undefined : same ? lifecycle
    : { identity: "entry", variant: "Entry", errorType: input.entryErrorType };
  const sources = [...(input.lifecycleFallible || same ? [lifecycle] : []), ...(entry === undefined || same ? [] : [entry])];
  const joined = planRustNativeErrorJoin({ identity: "binary-errors", name: "BinaryErrors", visibility: "private", sources });
  if (joined === undefined) return undefined;
  const importError = (error: RustExpr, source: RustType): RustExpr => rustTypeEquals(source, input.lifecycleErrorType) ? error
    : { kind: "associated-call", owner: input.lifecycleErrorType, method: "from", args: [error] };
  return Object.freeze({ errorType: joined.errorType ?? input.lifecycleErrorType, items: joined.items,
    entry(result: RustExpr): RustExpr {
      if (entry === undefined) throw new Error("An infallible binary entry cannot propagate an error.");
      const selected = joined.propagate(entry, result);
      if (selected === undefined) throw new Error("Binary entry errors require their exact native source.");
      return selected;
    },
    lifecycle(result: RustExpr, operandErrorType: RustType): RustExpr {
      const converted: RustExpr = rustTypeEquals(operandErrorType, input.lifecycleErrorType) ? result : {
        kind: "method-call", receiver: result, method: "map_err",
        args: [{ kind: "associated-value", owner: input.lifecycleErrorType, name: "from" }],
      };
      const selected = joined.propagate(lifecycle, converted);
      if (selected === undefined) throw new Error("Binary lifecycle errors require their exact native source.");
      return selected;
    },
    lifecycleError(error: RustExpr, operandErrorType: RustType): RustExpr {
      const selected = joined.inject(lifecycle, importError(error, operandErrorType));
      if (selected === undefined) throw new Error("Binary lifecycle errors require their exact native source.");
      return selected;
    },
  });
}
