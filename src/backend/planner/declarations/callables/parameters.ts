import type { Node } from "@tsonic/tsts";
import { rustInlineBindingStoragePath } from "../../expressions/binding-storage.js";
import type { TargetTypeRef } from "../../../../target-model/types/model.js";
import type { SourceCallableContract } from "../../../../target-model/records/callables/source-callable-contract.js";
import type { RustExpr, RustFunctionParam, RustStmt } from "../../../target-ast/syntax/nodes.js";
import { failRustPlannerInvariant } from "../../diagnostics.js";
import { planRustBindingPattern, type RustBindingExpressionPlanner } from "../../bindings/binding-patterns.js";
import type { RustPlanContext } from "../../program/plan-context.js";
import { rustParameterTypeFromCarrierInContext } from "../../types/render.js";
import { allocateRustSyntheticName, type RustSyntheticNameState } from "../../names/synthetic.js";
import { planRustNativeAllocation } from "../../expressions/native-memory.js";
import { rustOptionDefaultValue } from "../../expressions/option-default.js";
import { planRustParameterEntryConversion } from "./parameter-entry-conversion.js";
import { rustBindingLivenessAttributes } from "../../bindings/liveness.js";
import type { RustCallableParameterInitialization } from "../../../../target-model/records/calls/parameter-emission.js";

type RustParameterPrelude =
  | { readonly kind: "statement"; readonly statement: RustStmt }
  | { readonly kind: "default"; readonly initializer: Node; readonly name: string; readonly mutable: boolean;
      readonly carrier: TargetTypeRef; readonly valueCarrier: TargetTypeRef; readonly retainStorage: boolean;
      readonly initialization: RustCallableParameterInitialization }
  | { readonly kind: "binding"; readonly pattern: Node; readonly name: string; readonly sourceCarrier: TargetTypeRef };

export interface RustCallableParameterPlan {
  readonly params: readonly RustFunctionParam[];
  readonly prelude: readonly RustParameterPrelude[];
}

export function planRustCallableParameters(contract: SourceCallableContract, context: RustPlanContext,
  syntheticNames: RustSyntheticNameState, use: "source-body" | "signature"): RustCallableParameterPlan {
  if (contract.kind === "native") {
    return { params: contract.nativeParameters.map(({ targetParameter }) => {
      const type = rustParameterTypeFromCarrierInContext(targetParameter.type, context);
      if (type === undefined) failRustPlannerInvariant("An admitted native constructor parameter requires its exact selected physical type.", contract.sourceDeclaration);
      return { name: targetParameter.name, type, mutable: false };
    }), prelude: [] };
  }
  const parameters = contract.parameters;
  const params: RustFunctionParam[] = [];
  const prelude: RustParameterPrelude[] = [];
  for (const parameter of parameters) {
    if (parameter === undefined) failRustPlannerInvariant("An admitted callable requires its dense checked parameter list.");
    const selected = context.input.program.records.callableParameter.get(parameter);
    if (selected === undefined) failRustPlannerInvariant("An admitted callable parameter requires its sealed native emission record.", parameter);
    const parameterType = rustParameterTypeFromCarrierInContext(selected.carrier, context);
    const name = selected.pattern === undefined ? selected.name : allocateRustSyntheticName(syntheticNames, "binding_parameter");
    if (name === undefined || parameterType === undefined) failRustPlannerInvariant("An admitted callable parameter requires its native name and storage type.", parameter);
    params.push({ name, type: parameterType, mutable: use === "source-body" && selected.parameterMutable,
      ...(use !== "source-body" || selected.pattern !== undefined || selected.default !== undefined || selected.storage !== undefined ||
        context.input.program.records.sourceParameterAbi.get(parameter)?.entryConversion !== undefined ? {}
        : { attrs: rustBindingLivenessAttributes(parameter, selected.parameterMutable, context) }) });
    prelude.push(...planRustParameterEntryConversion(parameter, name, selected.mutable, context)
      .map(statement => ({ kind: "statement" as const, statement })));
    if (selected.default !== undefined) prelude.push({ kind: "default", initializer: selected.default.initializer,
      name, mutable: selected.mutable, carrier: selected.carrier, valueCarrier: selected.default.valueCarrier,
      retainStorage: selected.default.retainStorage, initialization: selected.initialization });
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

export function rustCallableParameterReturnContext(initialization: Extract<RustCallableParameterInitialization, { readonly kind: "return" }>,
  expression: RustExpr, context: RustPlanContext): RustPlanContext {
  const expressionOverrides = new Map(context.expressionOverrides);
  expressionOverrides.set(initialization.expression, { expression, carrier: initialization.carrier, valueForm: "value" });
  return { ...context, expressionOverrides };
}

export function planRustCallableParameterPrelude(plan: RustCallableParameterPlan, context: RustPlanContext,
  planExpression: RustBindingExpressionPlanner): { readonly statements: readonly RustStmt[]; readonly context: RustPlanContext } {
  const statements: RustStmt[] = [];
  let selectedContext = context;
  for (const entry of plan.prelude) {
    if (entry.kind === "statement") {
      statements.push(entry.statement);
      continue;
    }
    if (entry.kind === "default") {
      const initializer = planExpression(entry.initializer, selectedContext);
      if (initializer === undefined) failRustPlannerInvariant("An admitted native default parameter requires its initializer expression.", entry.initializer);
      const value = rustOptionDefaultValue({ kind: "path", path: entry.name }, initializer, entry.carrier, selectedContext, entry.retainStorage);
      if (entry.initialization.kind === "return") {
        selectedContext = rustCallableParameterReturnContext(entry.initialization, value, selectedContext);
        continue;
      }
      // An absent default leaves the parameter itself; only a required mutability transition rebinds it.
      if (!entry.mutable && value.kind === "path" && value.path === entry.name) continue;
      statements.push({ kind: "let", name: entry.name, mutable: entry.mutable, init: value });
      continue;
    }
    const binding = planRustBindingPattern(entry.pattern, { kind: "path", path: entry.name }, entry.sourceCarrier, selectedContext, planExpression);
    if (binding === undefined) failRustPlannerInvariant("An admitted native binding parameter requires its destructuring plan.", entry.pattern);
    statements.push(...binding);
  }
  return { statements, context: selectedContext };
}
