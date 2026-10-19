import type { Node } from "@tsonic/tsts";
import { rustInlineBindingStoragePath } from "../../expressions/binding-storage.js";
import type { TargetTypeRef } from "../../../../target-model/types/model.js";
import type { RustExpr, RustFunctionParam, RustStmt } from "../../../target-ast/syntax/nodes.js";
import { failRustPlannerInvariant } from "../../../invariants.js";
import { planRustBindingPattern, type RustBindingExpressionPlanner } from "../../bindings/binding-patterns.js";
import type { RustPlanContext } from "../../program/plan-context.js";
import { rustParameterTypeFromCarrierInContext } from "../../types/render.js";
import { allocateRustSyntheticName, type RustSyntheticNameState } from "../../names/synthetic.js";
import { planRustNativeAllocation } from "../../expressions/native-memory.js";
import { rustOptionDefaultValue } from "../../expressions/option-default.js";
import { planRustParameterEntryConversion } from "./parameter-entry-conversion.js";

type RustParameterPrelude =
  | { readonly kind: "statement"; readonly statement: RustStmt }
  | { readonly kind: "default"; readonly initializer: Node; readonly name: string; readonly mutable: boolean;
      readonly carrier: TargetTypeRef; readonly valueCarrier: TargetTypeRef }
  | { readonly kind: "binding"; readonly pattern: Node; readonly name: string; readonly sourceCarrier: TargetTypeRef };

export interface RustCallableParameterPlan {
  readonly params: readonly RustFunctionParam[];
  readonly prelude: readonly RustParameterPrelude[];
}

export function planRustCallableParameters(callable: Node, context: RustPlanContext, syntheticNames: RustSyntheticNameState): RustCallableParameterPlan {
  const params: RustFunctionParam[] = [];
  const prelude: RustParameterPrelude[] = [];
  for (const parameter of context.input.program.source.ast.parameters(callable)) {
    if (parameter === undefined) failRustPlannerInvariant("An admitted callable requires its dense checked parameter list.", callable);
    const selected = context.input.program.records.callableParameter.get(parameter);
    if (selected === undefined) failRustPlannerInvariant("An admitted callable parameter requires its sealed native emission record.", parameter);
    const parameterType = rustParameterTypeFromCarrierInContext(selected.carrier, context);
    const name = selected.pattern === undefined ? selected.name : allocateRustSyntheticName(syntheticNames, "binding_parameter");
    if (name === undefined || parameterType === undefined) failRustPlannerInvariant("An admitted callable parameter requires its native name and storage type.", parameter);
    params.push({ name, type: parameterType, mutable: selected.parameterMutable });
    prelude.push(...planRustParameterEntryConversion(parameter, name, selected.mutable, context)
      .map(statement => ({ kind: "statement" as const, statement })));
    if (selected.default !== undefined) prelude.push({ kind: "default", initializer: selected.default.initializer,
      name, mutable: selected.mutable, carrier: selected.carrier, valueCarrier: selected.default.valueCarrier });
    if (selected.pattern !== undefined) {
      if (selected.sourceCarrier === undefined) failRustPlannerInvariant("An admitted binding parameter requires its exact source carrier.", parameter);
      prelude.push({ kind: "binding", pattern: selected.pattern, name, sourceCarrier: selected.sourceCarrier });
      continue;
    }
    const storage = selected.storage;
    if (storage === undefined) continue;
    if (storage.storage !== "location") {
      prelude.push({ kind: "statement", statement: { kind: "let", name, mutable: false,
        init: { kind: "call", path: rustInlineBindingStoragePath(storage.storage) + "::new", args: [{ kind: "path", path: name }] } } });
      continue;
    }
    context.usedAliases?.add("rt");
    const initial: RustExpr = { kind: "path", path: name };
    const allocation = context.input.program.records.nativeBacking.get(parameter) === undefined
      ? { kind: "call" as const, path: "rt::Location::allocate", args: [initial] } : planRustNativeAllocation(parameter, initial, context);
    if (allocation === undefined) failRustPlannerInvariant("An admitted promoted parameter requires its native backing allocation.", parameter);
    prelude.push({ kind: "statement", statement: { kind: "let", name, mutable: false, init: allocation } });
  }
  return { params, prelude };
}

export function planRustCallableParameterPrelude(plan: RustCallableParameterPlan, context: RustPlanContext, planExpression: RustBindingExpressionPlanner): readonly RustStmt[] {
  const statements: RustStmt[] = [];
  for (const entry of plan.prelude) {
    if (entry.kind === "statement") {
      statements.push(entry.statement);
      continue;
    }
    if (entry.kind === "default") {
      const initializer = planExpression(entry.initializer, context);
      if (initializer === undefined) failRustPlannerInvariant("An admitted native default parameter requires its initializer expression.", entry.initializer);
      const value = rustOptionDefaultValue({ kind: "path", path: entry.name }, initializer, entry.carrier, context, entry.valueCarrier);
      statements.push({ kind: "let", name: entry.name, mutable: entry.mutable, init: value });
      continue;
    }
    const binding = planRustBindingPattern(entry.pattern, { kind: "path", path: entry.name }, entry.sourceCarrier, context, planExpression);
    if (binding === undefined) failRustPlannerInvariant("An admitted native binding parameter requires its destructuring plan.", entry.pattern);
    statements.push(...binding);
  }
  return statements;
}
