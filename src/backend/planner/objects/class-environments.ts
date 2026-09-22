import type { Node } from "@tsonic/tsts";
import { Node_Initializer } from "@tsonic/target-api/source";
import type { RustClassValueDefinition } from "../../../analysis/objects/class-values.js";
import { rustSourceBindingFactKey } from "../../../analysis/facts/keys.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { rustSourceBindingPath, sourceModuleItemPath, rustSourceItemIsPubliclyReachable } from "../program/plan-context.js";
import { emptyRustGenerics, type RustCallGenericArgument, type RustExpr, type RustFunctionParam, type RustItem, type RustStructField } from "../../target-ast/nodes.js";
import { isRustCopyCarrier, rustLocationTargetType } from "../../../target-model/types/index.js";
import { rustTypeFromCarrierInContext } from "../types/render.js";
import { rustProjectGenerics, rustProjectStateMarker } from "./polymorphism/names.js";
import { planExpression } from "../expressions/index.js";
import { planRustCaptureValue } from "../expressions/typed-locations.js";
import { allocateRustSyntheticName } from "../names/synthetic.js";
import { rustSelfParameter } from "../declarations/self-parameter.js";
import { rustModuleCellAccess } from "../project/module-storage.js";
import { rustProjectObjectIdentityImplementation } from "./project-identity.js";
import { rustClassEnvironmentType, rustClassEnvironmentHandleType } from "./class-environment-types.js";
import { rustProjectImplementationVisibility, rustProjectMemberStorageVisibility } from "./project-storage-abi.js";

type Environment = NonNullable<RustClassValueDefinition["environment"]>;

export function planRustClassEnvironmentItems(declaration: Node, context: RustPlanContext): readonly RustItem[] | undefined {
  const environment = context.input.program.classValues.forDeclaration(declaration)?.environment;
  if (environment === undefined) return [];
  const definition = context.input.program.projectTypes.definitionForDeclaration(declaration);
  if (definition === undefined) return undefined;
  const fields: RustStructField[] = [];
  const publiclyReachable = rustSourceItemIsPubliclyReachable(context, environment.typeName);
  if (environment.constructorValue) {
    context.usedAliases?.add("rt");
    fields.push({ name: environment.identityFieldName, visibility: "crate", type: {
      kind: "named", path: "core::cell::OnceCell", genericArguments: [{ kind: "type", type: { kind: "named", path: "rt::ObjectIdentity" } }],
    } });
  }
  for (const capture of environment.captures) {
    const type = rustTypeFromCarrierInContext(capture.storage === "location"
      ? rustLocationTargetType(capture.carrier) : capture.carrier, context);
    if (type === undefined) return undefined;
    fields.push({ name: capture.fieldName, visibility: "private", type });
  }
  for (const field of environment.staticFields) {
    const type = rustTypeFromCarrierInContext(field.carrier, context);
    if (type === undefined) return undefined;
    fields.push({ name: field.fieldName, visibility: rustProjectMemberStorageVisibility(context.input.program.source.ast,
      field.declaration, publiclyReachable), type: field.readonly ? type : {
      kind: "named", path: "core::cell::RefCell", genericArguments: [{ kind: "type", type }],
    } });
  }
  const marker = rustProjectStateMarker(definition, context, environment.genericParameterIndexes);
  if (marker !== undefined) fields.push({ name: marker.name, type: marker.type, visibility: "private" });
  const generics = rustProjectGenerics(definition, context, environment.genericParameterIndexes);
  const manualClone = environment.storage === "value" && (generics.parameters.length > 0 || !environment.copy);
  const target = manualClone ? rustClassEnvironmentType(environment.carrier, context) : undefined;
  if (manualClone && target === undefined) return undefined;
  const identityOwner = environment.constructorValue ? rustClassEnvironmentType(environment.carrier, context) : undefined;
  if (environment.constructorValue && identityOwner === undefined) return undefined;
  const clonedFields: { readonly name: string; readonly value: RustExpr }[] = environment.captures.map(capture => {
    const value: RustExpr = { kind: "field", receiver: { kind: "path", path: "self" }, name: capture.fieldName };
    return { name: capture.fieldName, value: capture.storage === "value" && isRustCopyCarrier(capture.carrier) ? value
      : { kind: "method-call" as const, receiver: value, method: "clone", args: [] } };
  });
  if (marker !== undefined) clonedFields.push({ name: marker.name, value: marker.value });
  const identityItems: RustItem[] = identityOwner === undefined ? [] : [rustProjectObjectIdentityImplementation(
      identityOwner, generics,
      { kind: "method-call", receiver: { kind: "field", receiver: { kind: "path", path: "self" }, name: environment.identityFieldName },
        method: "get_or_init", args: [{ kind: "path", path: "rt::ObjectIdentity::new" }] },
      { kind: "method-call", receiver: { kind: "call", path: "core::ptr::from_ref", args: [{ kind: "path", path: "self" }] },
        method: "addr", args: [] },
    ), { kind: "impl", generics, target: identityOwner, trait: { kind: "named", path: "PartialEq" }, functions: [{
      name: "eq", visibility: "private", generics: emptyRustGenerics, selfParam: rustSelfParameter("ref"),
      params: [{ name: "other", type: { kind: "reference", mutable: false, referent: { kind: "named", path: "Self" } } }],
      returnType: { kind: "primitive", name: "bool" }, body: { statements: [{ kind: "tail", expr: {
        kind: "call", path: "core::ptr::eq", args: [{ kind: "path", path: "self" }, { kind: "path", path: "other" }],
      } }] },
    }] }, { kind: "impl", generics, target: identityOwner, trait: { kind: "named", path: "Eq" }, functions: [] }];
  return [{ kind: "struct", name: environment.typeName, visibility: rustProjectImplementationVisibility(publiclyReachable),
    derives: environment.storage === "value" && !manualClone ? ["Clone", "Copy"] : [], generics, fields },
    ...identityItems,
    ...(target === undefined ? [] : [
      ...(environment.copy ? [{ kind: "impl" as const, generics, target, trait: { kind: "named" as const, path: "Copy" }, functions: [] }] : []),
      { kind: "impl" as const, generics, target, trait: { kind: "named" as const, path: "Clone" }, functions: [{
        name: "clone", visibility: "private" as const, generics: emptyRustGenerics,
        selfParam: rustSelfParameter("ref"), params: [], returnType: { kind: "named" as const, path: "Self" },
        body: { statements: [{ kind: "tail" as const, expr: environment.copy
          ? { kind: "dereference" as const, pointer: { kind: "path" as const, path: "self" } }
          : { kind: "struct-literal" as const, path: "Self", fields: clonedFields } }] },
      }] },
    ]),
  ];
}

export function planRustClassEnvironmentValue(declaration: Node, context: RustPlanContext): RustExpr | undefined {
  const environment = context.input.program.classValues.forDeclaration(declaration)?.environment;
  if (environment === undefined || context.syntheticNames === undefined) return undefined;
  const type = rustClassEnvironmentType(environment.carrier, context);
  if (type?.kind !== "named") return undefined;
  const fields: { name: string; value: RustExpr }[] = [];
  if (environment.constructorValue) fields.push({ name: environment.identityFieldName,
    value: { kind: "call", path: "core::cell::OnceCell::new", args: [] } });
  const bindings: { name: string; value: RustExpr }[] = [];
  for (const capture of environment.captures) {
    const binding = context.input.program.facts.getFact(capture.reference, rustSourceBindingFactKey);
    const path = binding === undefined ? undefined : rustSourceBindingPath(context, binding);
    if (path === undefined) return undefined;
    const name = allocateRustSyntheticName(context.syntheticNames, "class_capture");
    const value = planRustCaptureValue(capture.reference, path, capture.storage,
      context.input.program.valueLifetimes.canMoveCapture(declaration, capture.declaration), context);
    bindings.push({ name, value });
    fields.push({ name: capture.fieldName, value: { kind: "path", path: name } });
  }
  for (const field of environment.staticFields) {
    const initializer = Node_Initializer(context.input.program.source.ast, field.declaration);
    const value = initializer === undefined ? undefined : planExpression(initializer, context);
    if (value === undefined) return undefined;
    const name = allocateRustSyntheticName(context.syntheticNames, "class_static");
    bindings.push({ name, value });
    const reference: RustExpr = { kind: "path", path: name };
    fields.push({ name: field.fieldName, value: field.readonly ? reference
      : { kind: "call", path: "core::cell::RefCell::new", args: [reference] } });
  }
  const definition = context.input.program.projectTypes.definitionForDeclaration(declaration);
  if (definition === undefined) return undefined;
  const marker = rustProjectStateMarker(definition, context, environment.genericParameterIndexes);
  if (marker !== undefined) fields.push({ name: marker.name, value: marker.value });
  const value: RustExpr = { kind: "struct-literal", path: type.path, fields };
  return { kind: "block", bindings, value: environment.storage === "value" ? value
    : { kind: "call", path: "alloc::rc::Rc::new", args: [value] } };
}

export function rustClassEnvironmentParameter(
  declaration: Node,
  context: RustPlanContext,
  mode: "owned" | "borrowed",
): RustFunctionParam | undefined {
  const environment = context.input.program.classValues.forDeclaration(declaration)?.environment;
  if (environment === undefined) return undefined;
  const type = mode === "owned" ? rustClassEnvironmentHandleType(environment.carrier, context)
    : rustClassEnvironmentType(environment.carrier, context);
  return type === undefined ? undefined : { name: environment.parameterName,
    type: mode === "owned" ? type : { kind: "reference", mutable: false, referent: type } };
}

export function rustClassEnvironmentContext(
  environment: Environment,
  value: RustExpr,
  context: RustPlanContext,
): RustPlanContext {
  return { ...context,
    classEnvironment: { declaration: environment.declaration, expression: value },
    capturedBindings: [
      ...(context.capturedBindings ?? []),
      ...environment.captures.map(capture => ({
        declaration: capture.declaration,
        expression: { kind: "reference" as const, expr: {
          kind: "field" as const, receiver: value, name: capture.fieldName,
        } },
        storage: capture.storage,
        valueCarrier: capture.carrier,
        borrowed: true,
      })),
    ],
  };
}

export function rustClassEnvironmentForCall(declaration: Node, context: RustPlanContext): RustExpr | undefined {
  const environment = context.input.program.classValues.forDeclaration(declaration)?.environment;
  if (environment === undefined) return undefined;
  const active = context.classEnvironment;
  const ast = context.input.program.source.ast;
  if (ast.parent(declaration) === ast.getSourceFile(declaration)) {
    const path = sourceModuleItemPath(context, ast.getFileName(ast.getSourceFile(declaration)), environment.bindingName);
    return path === undefined ? undefined : rustModuleCellAccess({ kind: "path", path }, "load", []);
  }
  return active?.declaration === declaration ? active.expression : { kind: "path", path: environment.bindingName };
}

export function rustOwnedClassEnvironmentForCall(declaration: Node, context: RustPlanContext, retained?: RustExpr): RustExpr | undefined {
  const environment = context.input.program.classValues.forDeclaration(declaration)?.environment;
  if (environment !== undefined && !environment.instancesUseEnvironment && !environment.initializationUsesEnvironment) return undefined;
  const value = retained ?? rustClassEnvironmentForCall(declaration, context);
  if (environment === undefined || value === undefined) return undefined;
  const ast = context.input.program.source.ast;
  if (retained !== undefined || ast.parent(declaration) === ast.getSourceFile(declaration)) return value;
  if (!environment.copy) return { kind: "method-call", receiver: value, method: "clone", args: [] };
  return context.classEnvironment?.declaration === declaration && context.classEnvironment.borrowed
    ? { kind: "dereference", pointer: value } : value;
}

export function rustClassMemberEnvironmentContext(member: Node, context: RustPlanContext): RustPlanContext {
  const definition = context.input.program.projectTypes.definitionContainingDeclaration(member);
  const environment = definition === undefined ? undefined
    : context.input.program.classValues.forDeclaration(definition.declaration)?.environment;
  if (environment === undefined) return context;
  const ast = context.input.program.source.ast;
  if (ast.hasModifierKind(member, "static") && !environment.consumers.includes(member)) return context;
  if (!ast.hasModifierKind(member, "static") && !environment.instancesUseEnvironment && ast.kindName(member) !== "KindConstructor") return context;
  const value: RustExpr = ast.hasModifierKind(member, "static") || ast.kindName(member) === "KindConstructor"
    ? { kind: "path", path: environment.parameterName }
    : context.input.program.projectTypes.isPolymorphic(definition!) ||
      context.input.program.objectRepresentations.representationFor(definition)?.kind === "value"
      ? { kind: "field", receiver: context.projectDispatchRoot ?? { kind: "path", path: "self" }, name: environment.instanceFieldName }
      : { kind: "method-call", receiver: {
        kind: "field", receiver: { kind: "path", path: "self" }, name: "state",
      }, method: "context", args: [] };
  const selected = rustClassEnvironmentContext(environment, value, context);
  return { ...selected, classEnvironment: { declaration: environment.declaration, expression: value,
    borrowed: ast.hasModifierKind(member, "static") ||
      !context.input.program.projectTypes.isPolymorphic(definition!) &&
        context.input.program.objectRepresentations.representationFor(definition)?.kind !== "value",
  } };
}

export function rustClassStaticEnvironmentForCall(member: Node | undefined, context: RustPlanContext, retained?: RustExpr): RustExpr | undefined {
  if (member === undefined || !context.input.program.source.ast.hasModifierKind(member, "static")) return undefined;
  const owner = context.input.program.projectTypes.definitionContainingDeclaration(member);
  const environment = owner === undefined ? undefined : context.input.program.classValues.forDeclaration(owner.declaration)?.environment;
  if (environment === undefined || !environment.consumers.includes(member)) return undefined;
  return retained ?? rustClassEnvironmentForCall(environment.declaration, context);
}

export function rustClassStaticCallGenericArguments(
  member: Node | undefined,
  arguments_: readonly RustCallGenericArgument[] | undefined,
  context: RustPlanContext,
): readonly RustCallGenericArgument[] | undefined {
  if (member === undefined || arguments_ === undefined) return arguments_;
  const owner = context.input.program.projectTypes.definitionContainingDeclaration(member);
  const environment = owner === undefined ? undefined : context.input.program.classValues.forDeclaration(owner.declaration)?.environment;
  if (owner === undefined || environment === undefined || !environment.consumers.includes(member)) return arguments_;
  const captured = rustProjectGenerics(owner, context, environment.genericParameterIndexes);
  return [...arguments_, ...captured.parameters.flatMap((parameter): readonly RustCallGenericArgument[] =>
    parameter.kind === "lifetime" ? [] : [{ kind: "type", type: { kind: "infer" } }])];
}
