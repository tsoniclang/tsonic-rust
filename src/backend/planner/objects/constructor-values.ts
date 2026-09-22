import type { Node } from "@tsonic/tsts";
import type { RustClassValueDefinition } from "../../../analysis/objects/class-values.js";
import { emptyRustGenerics, type RustExpr, type RustImplFunction, type RustItem } from "../../target-ast/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { rustCurrentErrorBoundary, rustErrorType, sourceModuleItemPath } from "../program/plan-context.js";
import { rustTypeFromCarrierInContext } from "../types/render.js";
import { rustClassEnvironmentType, rustClassEnvironmentContext, planRustClassEnvironmentValue } from "./class-environments.js";
import { planRustClassValueForwarder } from "./class-value-callables.js";
import { rustProjectGenerics } from "./polymorphism/names.js";
import { rustSelfParameter } from "../declarations/self-parameter.js";
import { readRustSourceStaticField, planRustSourceStaticFieldStorage } from "../declarations/static-field-storage.js";
import { allocateRustSyntheticName, createRustSyntheticNameState } from "../names/synthetic.js";
import { rustModuleCellAccess } from "../project/module-storage.js";

type ConstructorView = RustClassValueDefinition["views"][number];

export function planRustConstructorView(
  declaration: Node, view: ConstructorView, expression: Node, context: RustPlanContext,
): RustExpr | undefined {
  const environment = context.input.program.classValues.forDeclaration(declaration)?.environment;
  const type = rustTypeFromCarrierInContext(view.carrier, context);
  if (environment === undefined || type?.kind !== "named" || context.syntheticNames === undefined) return undefined;
  const ast = context.input.program.source.ast;
  const fresh = ast.kindName(expression) === "KindClassExpression";
  const module = ast.parent(declaration) === ast.getSourceFile(declaration);
  const path = module ? sourceModuleItemPath(context, ast.getFileName(ast.getSourceFile(declaration)), environment.bindingName) : undefined;
  const value = fresh ? planRustClassEnvironmentValue(declaration, context)
    : module ? path === undefined ? undefined : rustModuleCellAccess({ kind: "path", path }, "load", [])
    : { kind: "method-call" as const, receiver: { kind: "path" as const, path: environment.bindingName }, method: "clone", args: [] };
  if (value === undefined) return undefined;
  const name = allocateRustSyntheticName(context.syntheticNames, "class_value");
  const selected: RustExpr = { kind: "path", path: name };
  return { kind: "block", bindings: [{ name, value }], value: { kind: "struct-literal", path: type.path, fields: [
    { name: "dispatch", value: selected },
  ] } };
}

export function planRustConstructorImplementations(declaration: Node, context: RustPlanContext): readonly RustItem[] | undefined {
  const selected = context.input.program.classValues.forDeclaration(declaration);
  if (selected === undefined || selected.views.every(view => view.construction === undefined)) return [];
  const environment = selected.environment;
  const definition = context.input.program.projectTypes.definitionForDeclaration(declaration);
  const target = environment === undefined ? undefined : rustClassEnvironmentType(environment.carrier, context);
  const boundary = rustCurrentErrorBoundary(context);
  if (target === undefined || environment === undefined || definition === undefined || boundary === undefined) return undefined;
  const items: RustItem[] = [];
  for (const view of selected.views) {
    if (view.construction === undefined) continue;
    const shape = context.input.program.structuralShapes.definitionForCarrier(view.carrier);
    const wrapper = rustTypeFromCarrierInContext(view.carrier, context);
    if (shape?.dispatchName === undefined || shape.construction === undefined || wrapper?.kind !== "named") return undefined;
    const ownerPath = wrapper.path.slice(0, wrapper.path.lastIndexOf("::") + 2);
    const functions: RustImplFunction[] = [];
    const construct = planRustClassValueForwarder(view.construction, shape.construction.targetName, context, true);
    if (construct === undefined) return undefined;
    functions.push(construct);
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
    items.push({ kind: "impl", generics: rustProjectGenerics(definition, context), target,
      trait: { kind: "named", path: `${ownerPath}${shape.dispatchName}`, genericArguments: wrapper.genericArguments }, functions });
  }
  return items;
}
