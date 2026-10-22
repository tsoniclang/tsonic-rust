import { rustValueBlock } from "../../target-ast/syntax/value-block.js";
import { rustPackageFallibleBoundary, rustErrorType } from "../program/fallible-boundaries.js";
import type { Node } from "@tsonic/tsts";
import { emptyRustGenerics, type RustImplFunction, type RustItem } from "../../target-ast/syntax/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { rustCurrentErrorBoundary } from "../program/plan-context.js";
import { rustTypeFromCarrierInContext } from "../types/render.js";
import { rustClassEnvironmentContext } from "./class-environments.js";
import { rustClassEnvironmentType } from "./class-environment-types.js";
import { planRustClassValueForwarder } from "./class-value-callables.js";
import { planRustProjectGenerics } from "./polymorphism/names.js";
import { rustSelfParameter } from "../declarations/callables/self-parameter.js";
import { readRustSourceStaticField, planRustSourceStaticFieldStorage } from "../declarations/classes/static-field-storage.js";
import { createRustSyntheticNameState } from "../names/synthetic.js";
import { rustProjectImplementationContext, rustProjectImplementationGenerics } from "./polymorphism/implementation-generics.js";
import { failRustPlannerInvariant } from "../diagnostics.js";

export function planRustClassValueImplementations(declaration: Node, context: RustPlanContext): readonly RustItem[] | undefined {
  const selected = context.input.program.records.classEnvironment.get(declaration);
  const views = context.input.program.records.classConstructorViews.get(declaration, context.input.program.source.ast.getFileName(context.sourceFile));
  if (views === undefined || views.length === 0) return [];
  if (selected === undefined) failRustPlannerInvariant("An admitted constructor view requires its native class environment.", declaration);
  const environment = selected.environment;
  const definition = context.input.program.records.projectDeclaration.get(declaration);
  const boundary = rustCurrentErrorBoundary(context);
  if (definition === undefined || boundary === undefined) failRustPlannerInvariant("An admitted constructor view requires its native definition and error boundary.", declaration);
  const items: RustItem[] = [];
  const baseContext = context;
  for (const view of views) {
    context = rustProjectImplementationContext(definition, view.sourceCarrier, baseContext);
    const target = rustClassEnvironmentType(view.sourceCarrier, context);
    if (target === undefined) failRustPlannerInvariant("An admitted constructor view requires its native environment type.", declaration);
    const generics = rustProjectImplementationGenerics(view.genericCarrier,
      planRustProjectGenerics(definition, [], context, environment.genericParameterIndexes), context);
    if (generics === undefined) failRustPlannerInvariant("An admitted constructor view requires its native implementation generics.", declaration);
    const wrapper = rustTypeFromCarrierInContext(view.targetCarrier, context);
    if (wrapper?.kind !== "named") failRustPlannerInvariant("An admitted constructor view requires its named native wrapper.", declaration);
    const ownerPath = wrapper.path.slice(0, wrapper.path.lastIndexOf("::") + 2);
    const functions: RustImplFunction[] = [];
    if (view.construction !== undefined) {
      const construct = planRustClassValueForwarder(view.construction.callable, view.construction.name, context, true);
      if (construct === undefined) failRustPlannerInvariant("An admitted constructor view requires its native constructor forwarder.", declaration);
      functions.push(construct);
    }
    for (const field of view.fields) {
      const storage = field.storage;
      if (field.callable !== undefined) {
        const method = planRustClassValueForwarder(field.callable, storage.targetName, context);
        if (method === undefined) failRustPlannerInvariant("An admitted constructor view requires its native static method forwarder.", field.declaration);
        functions.push(method);
        continue;
      }
      const type = rustTypeFromCarrierInContext(storage.carrier, context);
      if (type === undefined || storage.property === undefined) failRustPlannerInvariant("An admitted constructor property requires its native carrier and accessor slots.", field.declaration);
      const syntheticNames = createRustSyntheticNameState(context.input.program.source.ast, field.declaration, ["value"]);
      const local = rustClassEnvironmentContext(environment, { kind: "path", path: "self" },
        { ...context, syntheticNames, fallibleBoundary: rustPackageFallibleBoundary(boundary) });
      const fact = { kind: "source-static-field" as const, declaration: field.declaration,
        storageFileName: field.fileName, storageName: field.targetName, resultCarrier: storage.carrier };
      const read = readRustSourceStaticField(fact, local);
      if (read === undefined) failRustPlannerInvariant("An admitted constructor property requires its native static read.", field.declaration);
      functions.push({ kind: "function", name: storage.property.getterTargetName, visibility: "private", generics: emptyRustGenerics,
        selfParam: rustSelfParameter("ref"), params: [], returnType: type, errorType: rustErrorType(boundary),
        body: { statements: [{ kind: "tail", expr: { kind: "call", path: "Ok", args: [read] } }] } });
      if (storage.property.setterTargetName !== undefined) {
        const target = planRustSourceStaticFieldStorage(fact, local);
        if (target === undefined) failRustPlannerInvariant("An admitted constructor property requires its native static write.", field.declaration);
        functions.push({ kind: "function", name: storage.property.setterTargetName, visibility: "private", generics: emptyRustGenerics,
          selfParam: rustSelfParameter("ref"), params: [{ name: "value", type }], returnType: { kind: "unit" },
          errorType: rustErrorType(boundary), body: { statements: [{ kind: "tail", expr: rustValueBlock(target.bindings, { kind: "evaluate-then", effect: target.write({ kind: "path", path: "value" }), discard: "unit",
              value: { kind: "call", path: "Ok", args: [{ kind: "tuple-literal", elements: [] }] } }) }] } });
      }
    }
    items.push({ kind: "impl", generics, target,
      trait: { kind: "named", path: `${ownerPath}${view.dispatchName}`, genericArguments: wrapper.genericArguments }, members: functions });
  }
  return items;
}
