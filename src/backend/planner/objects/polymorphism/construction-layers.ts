import type { RustProjectConstructionPlan } from "../../../../analysis/project-types/construction-plan.js";
import type { RustStmt } from "../../../target-ast/nodes.js";
import { planRustCallableParameterPrelude, planRustCallableParameters,
  type RustCallableParameterPlan } from "../../declarations/callables/parameters.js";
import type { RustConstructionBody } from "../../declarations/classes/construction-body.js";
import { planExpression, planRustSelectedSourceCallArguments } from "../../expressions/index.js";
import { missingFactDiagnostic } from "../../diagnostics.js";
import { allocateRustSyntheticName } from "../../names/synthetic.js";
import { diagnosticInput, type RustPlanContext } from "../../program/plan-context.js";
import { planStatementSequence } from "../../statements/index.js";
import { planRustExternalProjectInitialization } from "./external-construction.js";
import { planRustImplicitConstructorParameters } from "./construction-parameters.js";
import { projectTypeSubstitutions, projectLifetimeSubstitutions, type ProjectClassStateLayer } from "./model.js";

export function planRustConstructionLayers(
  plan: RustProjectConstructionPlan,
  layers: readonly ProjectClassStateLayer[],
  parameters: RustCallableParameterPlan,
  construction: RustConstructionBody,
  context: RustPlanContext,
): readonly RustStmt[] | undefined {
  if (context.syntheticNames === undefined || context.controlFlow === undefined) return undefined;
  const syntheticNames = context.syntheticNames;
  const controlFlow = context.controlFlow;
  const planLayer = (index: number, parameterPlan: RustCallableParameterPlan): readonly RustStmt[] | undefined => {
    const layer = plan.layers[index];
    const storage = layers[index];
    if (layer === undefined || storage?.definition !== layer.definition) return undefined;
    const selectedContext: RustPlanContext = { ...context, sourceFile: layer.definition.sourceFile,
      typeParameterSubstitutions: new Map([...context.typeParameterSubstitutions ?? [],
        ...projectTypeSubstitutions(layer.definition, storage.carrier)]),
      lifetimeSubstitutions: new Map([...context.lifetimeSubstitutions ?? [],
        ...projectLifetimeSubstitutions(layer.definition, storage.carrier)]),
    };
    const label = !plan.layerHasEarlyReturn(layer.definition) ? undefined
      : { id: controlFlow.nextLoopId++, label: allocateRustSyntheticName(syntheticNames, "constructor_layer") };
    const layerContext = construction.contextForLayer(selectedContext, label);
    const prelude = planRustCallableParameterPrelude(parameterPlan, layerContext, planExpression);
    if (prelude === undefined) return undefined;
    const statements: RustStmt[] = [...prelude];
    if (index > 0) {
      const base = plan.layers[index - 1]!;
      const baseStorage = layers[index - 1]!;
      const baseContext: RustPlanContext = { ...context,
        typeParameterSubstitutions: new Map([...context.typeParameterSubstitutions ?? [],
          ...projectTypeSubstitutions(base.definition, baseStorage.carrier)]),
        lifetimeSubstitutions: new Map([...context.lifetimeSubstitutions ?? [],
          ...projectLifetimeSubstitutions(base.definition, baseStorage.carrier)]),
      };
      const baseParameters = base.constructor === undefined
        ? planRustImplicitConstructorParameters(base.signature, baseStorage.carrier, baseContext)
        : planRustCallableParameters(base.constructor, baseContext, syntheticNames);
      const args = layer.baseCall === undefined
        ? parameterPlan.params.map(parameter => ({ kind: "path" as const, path: parameter.name }))
        : planRustSelectedSourceCallArguments(layer.baseCall, layerContext);
      if (baseParameters === undefined || args === undefined || args.length !== baseParameters.params.length) {
        context.diagnostics.push(missingFactDiagnostic(diagnosticInput(context, layer.constructor ?? layer.definition.declaration),
          "rust.backend.constructor-base-parameters", "Native base construction has no exact selected argument/parameter ABI."));
        return undefined;
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
      if (body === undefined) return undefined;
      statements.push(...temporaries, ...construction.exportInitialized(
        plan.layers.slice(0, index).flatMap(layer => layer.fields.map(field => field.declaration)), [...bindings, ...body]));
      if (!plan.layerCompletes(base.definition)) return statements;
    } else {
      const external = context.input.program.projectTypes.externalBaseForDefinition(layer.definition);
      if (external !== undefined) {
        const initializers = planRustExternalProjectInitialization(external, layer.signature,
          layer.definition.declaration, layer.baseCall, layerContext);
        if (initializers === undefined) return undefined;
        for (const [fieldIndex, field] of external.fields.entries()) {
          const target = construction.values.get(field.declaration);
          const value = initializers[fieldIndex];
          if (target === undefined || value === undefined) return undefined;
          const initialization = construction.initialize(field.declaration, value);
          if (initialization === undefined) return undefined;
          statements.push(...initialization);
        }
      }
    }
    for (const field of layer.fields) {
      if (field.externallyInitialized) continue;
      const target = construction.values.get(field.declaration);
      if (target === undefined) return undefined;
      if (field.initializer !== undefined) {
        const prepared = construction.prepare(field.initializer, layerContext);
        if (prepared === undefined) return undefined;
        const value = planExpression(field.initializer, prepared.context);
        if (value === undefined) return undefined;
        const initialization = construction.initialize(field.declaration, value);
        if (initialization === undefined) return undefined;
        statements.push(...prepared.before, ...prepared.finish(initialization));
      }
    }
    const body = layer.constructor === undefined ? undefined : context.input.program.source.ast.body(layer.constructor);
    if (body !== undefined) {
      const planned = planStatementSequence(layer.statements, body, layerContext);
      if (planned === undefined) return undefined;
      statements.push(...planned.statements);
    }
    return label === undefined ? statements : [{ kind: "scope", label: label.label, body: { statements } }];
  };
  return planLayer(plan.layers.length - 1, parameters);
}
