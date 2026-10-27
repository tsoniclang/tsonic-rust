import type { RustAdmittedConstruction } from "../../../../target-model/records/objects/construction.js";
import type { RustStmt } from "../../../target-ast/syntax/nodes.js";
import { planRustCallableParameterPrelude, planRustCallableParameters,
  type RustCallableParameterPlan } from "../../declarations/callables/parameters.js";
import type { RustConstructionBody } from "../../declarations/classes/construction-body.js";
import { requireRustConstructorContract } from "../../declarations/classes/constructor-contracts.js";
import { planExpression, planRustSelectedSourceCallArguments } from "../../expressions/index.js";
import { failRustPlannerInvariant } from "../../diagnostics.js";
import { allocateRustSyntheticName } from "../../names/synthetic.js";
import type { RustPlanContext } from "../../program/plan-context.js";
import { planStatementSequence } from "../../statements/index.js";
import { planRustExternalProjectInitialization } from "./external-construction.js";
import { planRustImplicitConstructorParameters } from "./construction-parameters.js";
import type { ProjectClassStateLayer } from "./model.js";

export function planRustConstructionLayers(
  plan: RustAdmittedConstruction,
  layers: readonly ProjectClassStateLayer[],
  parameters: RustCallableParameterPlan,
  construction: RustConstructionBody,
  context: RustPlanContext,
): readonly RustStmt[] | undefined {
  if (context.syntheticNames === undefined || context.controlFlow === undefined) failRustPlannerInvariant("An admitted construction requires its native name and control-flow scopes.", plan.definition.declaration);
  const syntheticNames = context.syntheticNames;
  const controlFlow = context.controlFlow;
  const planLayer = (index: number, parameterPlan: RustCallableParameterPlan): readonly RustStmt[] | undefined => {
    const layer = plan.layers[index];
    const storage = layers[index];
    if (layer === undefined || storage?.definition !== layer.definition) failRustPlannerInvariant("An admitted construction layer requires its exact native storage owner.", plan.definition.declaration);
    const bindings = context.input.program.records.classImplementationContext.get(layer.definition.declaration, storage.carrier);
    if (bindings === undefined) failRustPlannerInvariant("An admitted construction layer requires its exact generic correspondence.", layer.definition.declaration);
    const selectedContext: RustPlanContext = { ...context, sourceFile: layer.definition.sourceFile,
      typeParameterSubstitutions: new Map([...context.typeParameterSubstitutions ?? [],
        ...bindings.types]),
      lifetimeSubstitutions: new Map([...context.lifetimeSubstitutions ?? [],
        ...bindings.lifetimes]),
    };
    const label = !plan.earlyReturnLayers.has(layer.definition) ? undefined
      : { id: controlFlow.nextLoopId++, label: allocateRustSyntheticName(syntheticNames, "constructor_layer") };
    const parameterContext = construction.contextForLayer(selectedContext, layer, label);
    const prelude = planRustCallableParameterPrelude(parameterPlan, parameterContext, planExpression);
    if (prelude === undefined) failRustPlannerInvariant("An admitted constructor layer requires its exact native body and initialization plan.", layer.definition.declaration);
    const layerContext = prelude.context;
    const statements: RustStmt[] = [...prelude.statements];
    if (index > 0) {
      const base = plan.layers[index - 1]!;
      const baseStorage = layers[index - 1]!;
      const baseBindings = context.input.program.records.classImplementationContext.get(base.definition.declaration, baseStorage.carrier);
      if (baseBindings === undefined) failRustPlannerInvariant("An admitted native base layer requires its exact generic correspondence.", base.definition.declaration);
      const baseContext: RustPlanContext = { ...context,
        typeParameterSubstitutions: new Map([...context.typeParameterSubstitutions ?? [],
          ...baseBindings.types]),
        lifetimeSubstitutions: new Map([...context.lifetimeSubstitutions ?? [],
          ...baseBindings.lifetimes]),
      };
      const nativeBase = context.input.program.records.nativeClass.get(base.definition.declaration);
      if (nativeBase === undefined) failRustPlannerInvariant("An admitted native base layer requires its sealed class parameters.", base.definition.declaration);
      const baseParameters = base.constructor === undefined
        ? planRustImplicitConstructorParameters(base.signature, baseStorage.carrier, baseContext)
        : planRustCallableParameters(requireRustConstructorContract(nativeBase), baseContext, syntheticNames, "source-body");
      const argumentsPlan = layer.baseCall === undefined
        ? { arguments: parameterPlan.params.map(parameter => ({ kind: "path" as const, path: parameter.name })), statements: [] }
        : planRustSelectedSourceCallArguments(layer.baseCall, layerContext);
      const args = argumentsPlan.arguments;
      if (baseParameters === undefined || args.length !== baseParameters.params.length) {
        failRustPlannerInvariant("Native base construction requires its exact selected argument and parameter ABI.", layer.constructor ?? layer.definition.declaration);
      }
      const temporaries: RustStmt[] = [];
      const bindings: RustStmt[] = [];
      for (const [argumentIndex, argument] of args.entries()) {
        const parameter = baseParameters.params[argumentIndex]!;
        const name = allocateRustSyntheticName(syntheticNames, "base_argument");
        temporaries.push({ kind: "let", name, mutable: false, init: argument });
        bindings.push({ kind: "let", name: parameter.name, mutable: parameter.mutable === true,
          type: parameter.type, init: { kind: "path", path: name } });
      }
      const body = planLayer(index - 1, baseParameters);
      if (body === undefined) failRustPlannerInvariant("An admitted constructor layer requires its exact native body and initialization plan.", layer.definition.declaration);
      statements.push(...argumentsPlan.statements, ...temporaries, ...construction.exportInitialized(
        base.definition, plan.layers.slice(0, index).flatMap(layer => layer.fields.map(field => field.declaration)), [...bindings, ...body]));
      if (!plan.completingLayers.has(base.definition)) return statements;
    } else {
      const external = context.input.program.records.externalProjectBase.get(layer.definition);
      if (external !== undefined) {
        const initializers = planRustExternalProjectInitialization(external, layer.signature,
          layer.definition.declaration, layer.baseCall, layerContext);
        if (initializers === undefined) failRustPlannerInvariant("An admitted constructor layer requires its exact native body and initialization plan.", layer.definition.declaration);
        for (const [fieldIndex, field] of external.fields.entries()) {
          const target = construction.values.get(field.declaration);
          const value = initializers[fieldIndex];
          if (target === undefined || value === undefined) failRustPlannerInvariant("An admitted constructor layer requires its exact native body and initialization plan.", layer.definition.declaration);
          const initialization = construction.initialize(field.declaration, value);
          if (initialization === undefined) failRustPlannerInvariant("An admitted constructor layer requires its exact native body and initialization plan.", layer.definition.declaration);
          statements.push(...initialization);
        }
      }
    }
    for (const field of layer.fields) {
      if (field.externallyInitialized) continue;
      const target = construction.values.get(field.declaration);
      if (target === undefined) failRustPlannerInvariant("An admitted constructor layer requires its exact native body and initialization plan.", layer.definition.declaration);
      if (field.initializer !== undefined) {
        const prepared = construction.prepare(field.initializer, layerContext);
        if (prepared === undefined) failRustPlannerInvariant("An admitted constructor layer requires its exact native body and initialization plan.", layer.definition.declaration);
        const value = construction.input(field.declaration, field.initializer, prepared.context,
          () => planExpression(field.initializer!, prepared.context));
        if (value === undefined) failRustPlannerInvariant("An admitted constructor layer requires its exact native body and initialization plan.", layer.definition.declaration);
        const initialization = construction.initialize(field.declaration, value);
        if (initialization === undefined) failRustPlannerInvariant("An admitted constructor layer requires its exact native body and initialization plan.", layer.definition.declaration);
        statements.push(...prepared.before, ...prepared.finish(initialization));
      }
    }
    const body = layer.constructor === undefined ? undefined : context.input.program.source.ast.body(layer.constructor);
    if (body !== undefined) {
      const planned = planStatementSequence(layer.statements, body, layerContext);
      if (planned === undefined) failRustPlannerInvariant("An admitted constructor layer requires its exact native body and initialization plan.", layer.definition.declaration);
      statements.push(...planned.statements);
    }
    return label === undefined ? statements : [{ kind: "scope", label: label.label, body: { statements } }];
  };
  return planLayer(plan.layers.length - 1, parameters);
}
