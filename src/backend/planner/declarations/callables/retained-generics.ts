import type { Node } from "@tsonic/tsts";
import type { RustCallableGenericPlan } from "./generics.js";

import { rustTypeFromCarrierInContext } from "../../types/render.js";
import { rustLifetimeToAst } from "../../types/lifetime-syntax.js";
import { rustLifetimeKey } from "../../../../target-model/lifetimes/index.js";
import type { RustWherePredicate } from "../../../target-ast/syntax/nodes.js";
import type { TargetTypeRef } from "../../../../target-model/types/model.js";
import { closedMetadataKey } from "../../../../target-model/metadata/closed-data.js";
import { rustGenericsWithAssociatedBounds } from "../../types/generic-bounds.js";

export function planRustRetainedGenerics(declaration: Node, source: RustCallableGenericPlan): RustCallableGenericPlan | undefined {
  const { context } = source;
  const { records, callableValues } = context.input.program;
  const retained = records.retainedEnvironment.get(declaration);
  if (retained === undefined) return source;
  const lifetime = rustLifetimeToAst(context.lifetimeSubstitutions?.get(rustLifetimeKey(retained.lifetime)) ?? retained.lifetime);
  const carriers: TargetTypeRef[] = [];
  for (const parameter of retained.parameters) {
    const abi = records.sourceParameterAbi.get(parameter);
    if (abi === undefined) return undefined;
    const physical = callableValues.nativeStorage.parameterFor(parameter);
    if (physical.kind === "unresolved") return undefined;
    carriers.push(physical.carrier);
  }
  const asynchronous = records.asyncFunction.get(declaration);
  const generator = records.generator.get(declaration);
  if (asynchronous?.kind === "js-promise") {
    const output = callableValues.nativeStorage.returnFor(declaration);
    const error = callableValues.nativeProducers.errorFor(declaration, context.promiseBody === true ? "body" : 0);
    if (output.kind === "unresolved" || error === undefined) return undefined;
    carriers.push(output.carrier, error);
  } else if (generator !== undefined) carriers.push(generator.yieldType, generator.returnType, generator.nextType);
  const predicates = new Map<string, RustWherePredicate>();
  for (const carrier of carriers) {
    const type = rustTypeFromCarrierInContext(carrier, context);
    if (type === undefined) return undefined;
    const predicate: RustWherePredicate = { kind: "type", type, bounds: [{ kind: "lifetime", lifetime }] };
    predicates.set(closedMetadataKey(predicate), predicate);
  }
  const generics = source.finalizeGenerics();
  return { ...source, finalizeGenerics: () => rustGenericsWithAssociatedBounds(generics.parameters,
    [...generics.wherePredicates, ...predicates.values()]) };
}
