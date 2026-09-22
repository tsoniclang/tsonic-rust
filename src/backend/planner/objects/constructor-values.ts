import type { Node } from "@tsonic/tsts";
import { emptyRustGenerics, type RustImplFunction, type RustItem } from "../../target-ast/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { rustCurrentErrorBoundary, rustErrorType } from "../program/plan-context.js";
import { rustTypeFromCarrierInContext } from "../types/render.js";
import { rustClassEnvironmentContext } from "./class-environments.js";
import { rustClassEnvironmentType } from "./class-environment-types.js";
import { planRustClassValueForwarder } from "./class-value-callables.js";
import { rustProjectGenerics } from "./polymorphism/names.js";
import { rustSelfParameter } from "../declarations/self-parameter.js";
import { readRustSourceStaticField, planRustSourceStaticFieldStorage } from "../declarations/static-field-storage.js";
import { createRustSyntheticNameState } from "../names/synthetic.js";
import { rustProjectImplementationContext, rustProjectImplementationGenerics } from "./polymorphism/implementation-generics.js";
import { rustClassConstructorTargetType } from "../../../target-model/types/carriers/class-constructors.js";
import { rustSourceTypeCarrierValue } from "../../../target-model/types/index.js";

export function planRustClassValueImplementations(declaration: Node, context: RustPlanContext): readonly RustItem[] | undefined {
  const selected = context.input.program.classValues.forDeclaration(declaration);
  const views = context.input.program.classValues.constructorViewImplementations.filter(view => view.declaration === declaration &&
    view.ownerFileName === context.input.program.source.ast.getFileName(context.sourceFile));
  if (selected === undefined || views.length === 0) return [];
  const environment = selected.environment;
  const definition = context.input.program.projectTypes.definitionForDeclaration(declaration);
  const boundary = rustCurrentErrorBoundary(context);
  if (environment === undefined || definition === undefined || boundary === undefined) return undefined;
  const items: RustItem[] = [];
  const baseContext = context;
  for (const view of views) {
    context = rustProjectImplementationContext(definition, view.sourceCarrier, baseContext);
    const target = rustClassEnvironmentType(view.sourceCarrier, context);
    const sourceArguments = rustSourceTypeCarrierValue(view.sourceCarrier)?.genericArguments;
    if (target === undefined || sourceArguments === undefined) return undefined;
    const bound = sourceArguments.flatMap((argument, index) => !environment.genericParameterIndexes.includes(index) &&
      (argument.kind === "type" && argument.type.kind === "type-parameter" || argument.kind === "lifetime" && argument.lifetime.kind === "parameter") ? [index] : []);
    const generics = rustProjectImplementationGenerics(rustClassConstructorTargetType(view.sourceCarrier, bound), definition,
      rustProjectGenerics(definition, context, environment.genericParameterIndexes), context);
    if (generics === undefined) return undefined;
    const shape = context.input.program.structuralShapes.definitionForCarrier(view.carrier);
    const wrapper = rustTypeFromCarrierInContext(view.carrier, context);
    if (shape?.dispatchName === undefined || wrapper?.kind !== "named") return undefined;
    const ownerPath = wrapper.path.slice(0, wrapper.path.lastIndexOf("::") + 2);
    const functions: RustImplFunction[] = [];
    if (view.construction !== undefined) {
      if (shape.construction === undefined) return undefined;
      const construct = planRustClassValueForwarder(view.construction, shape.construction.targetName, context, true);
      if (construct === undefined) return undefined;
      functions.push(construct);
    }
    for (const field of view.fields) {
      const storage = shape.fields[field.storageIndex];
      if (storage === undefined) return undefined;
      if (field.callable !== undefined) {
        const method = planRustClassValueForwarder(field.callable, storage.targetName, context);
        if (method === undefined) return undefined;
        functions.push(method);
        continue;
      }
      const type = rustTypeFromCarrierInContext(storage.carrier, context);
      if (type === undefined || storage.property === undefined) return undefined;
      const syntheticNames = createRustSyntheticNameState(context.input.program.source.ast, field.declaration, ["value"]);
      const local = rustClassEnvironmentContext(environment, { kind: "path", path: "self" },
        { ...context, syntheticNames, fallibleBoundary: boundary });
      const fact = { kind: "source-static-field" as const, declaration: field.declaration,
        storageFileName: field.fileName, storageName: field.targetName, resultCarrier: storage.carrier };
      const read = readRustSourceStaticField(fact, local);
      if (read === undefined) return undefined;
      functions.push({ name: storage.property.getterTargetName, visibility: "private", generics: emptyRustGenerics,
        selfParam: rustSelfParameter("ref"), params: [], returnType: type, errorType: rustErrorType(boundary),
        body: { statements: [{ kind: "tail", expr: { kind: "call", path: "Ok", args: [read] } }] } });
      if (storage.property.setterTargetName !== undefined) {
        const target = planRustSourceStaticFieldStorage(fact, local);
        if (target === undefined) return undefined;
        functions.push({ name: storage.property.setterTargetName, visibility: "private", generics: emptyRustGenerics,
          selfParam: rustSelfParameter("ref"), params: [{ name: "value", type }], returnType: { kind: "unit" },
          errorType: rustErrorType(boundary), body: { statements: [{ kind: "tail", expr: { kind: "block", bindings: target.bindings,
            value: { kind: "evaluate-then", effect: target.write({ kind: "path", path: "value" }), discard: "unit",
              value: { kind: "call", path: "Ok", args: [{ kind: "tuple-literal", elements: [] }] } } } }] } });
      }
    }
    items.push({ kind: "impl", generics, target,
      trait: { kind: "named", path: `${ownerPath}${shape.dispatchName}`, genericArguments: wrapper.genericArguments }, functions });
  }
  return items;
}
