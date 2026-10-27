import { rustValueBlock } from "../../target-ast/syntax/value-block.js";
import { rustDeriveAttributes } from "../../target-ast/syntax/attributes.js";
import type { Node } from "@tsonic/tsts";
import type { RustNamedClassEnvironment } from "../../../target-model/records/objects/class-values.js";
import { failRustPlannerInvariant } from "../diagnostics.js";

import type { RustPlanContext } from "../program/plan-context.js";
import { rustSourceBindingPath, sourceModuleItemPath } from "../program/plan-context.js";
import { emptyRustGenerics, type RustCallGenericArgument, type RustExpr, type RustFunctionParam, type RustItem, type RustStructField } from "../../target-ast/syntax/nodes.js";
import { rustTypeFromCarrierInContext } from "../types/render.js";
import { rustProjectGenerics, rustProjectStateMarker } from "./polymorphism/names.js";
import { planExpression } from "../expressions/index.js";
import { planRustCaptureValue } from "../expressions/typed-locations.js";
import { allocateRustSyntheticName } from "../names/synthetic.js";
import { rustSelfParameter } from "../declarations/callables/self-parameter.js";
import { rustModuleCellAccess } from "../project/module-storage.js";
import { rustProjectObjectIdentityImplementation } from "./project-identity.js";
import { rustClassEnvironmentType, rustClassEnvironmentHandleType } from "./class-environment-types.js";
import { rustProjectTypeParameterContext } from "../names/type-parameters.js";

type Environment = RustNamedClassEnvironment;

export function planRustClassEnvironmentItems(declaration: Node, context: RustPlanContext): readonly RustItem[] | undefined {
  const emission = context.input.program.records.classEnvironment.get(declaration);
  if (emission === undefined) return [];
  const { environment, definition } = emission;
  context = rustProjectTypeParameterContext(definition, context, "declaration");
  const fields: RustStructField[] = [];
  if (environment.constructorIdentity) {
    context.usedAliases?.add("rt");
    fields.push({ name: environment.identityFieldName, visibility: "crate", type: {
      kind: "named", path: "core::cell::OnceCell", genericArguments: [{ kind: "type", type: { kind: "named", path: "rt::ObjectIdentity" } }],
    } });
  }
  for (const capture of emission.captures) {
    const type = rustTypeFromCarrierInContext(capture.carrier, context);
    if (type === undefined) failRustPlannerInvariant("An admitted class capture requires its native storage carrier.", declaration);
    fields.push({ name: capture.name, visibility: "private", type });
  }
  for (const { field, visibility, deadCode } of emission.fields) {
    const type = rustTypeFromCarrierInContext(field.carrier, context);
    if (type === undefined) failRustPlannerInvariant("An admitted class environment field requires its finalized native storage syntax.", field.declaration);
    fields.push({ name: field.fieldName, visibility, ...(deadCode === undefined ? {} : { deadCode }), type: field.readonly ? type : {
      kind: "named", path: "core::cell::RefCell", genericArguments: [{ kind: "type", type }],
    } });
  }
  const marker = rustProjectStateMarker(definition, context, environment.genericParameterIndexes);
  if (marker !== undefined) fields.push({ name: marker.name, type: marker.type, visibility: "private" });
  const generics = rustProjectGenerics(definition, context, environment.genericParameterIndexes);
  const manualClone = emission.manualClone;
  const target = manualClone ? rustClassEnvironmentType(environment.carrier, context) : undefined;
  if (manualClone && target === undefined) failRustPlannerInvariant("An admitted class environment Clone implementation requires its native type.", declaration);
  const identityOwner = environment.constructorIdentity ? rustClassEnvironmentType(environment.carrier, context) : undefined;
  if (environment.constructorIdentity && identityOwner === undefined) failRustPlannerInvariant("An admitted class environment identity requires its native owner type.", declaration);
  const clonedFields: { readonly name: string; readonly value: RustExpr }[] = emission.captures.map(capture => {
    const value: RustExpr = { kind: "field", receiver: { kind: "path", path: "self" }, name: capture.name };
    return { name: capture.name, value: capture.copy ? value
      : { kind: "method-call" as const, receiver: value, method: "clone", args: [] } };
  });
  if (marker !== undefined) clonedFields.push({ name: marker.name, value: marker.value });
  const identityItems: RustItem[] = identityOwner === undefined ? [] : [rustProjectObjectIdentityImplementation(
      identityOwner, generics,
      { kind: "method-call", receiver: { kind: "field", receiver: { kind: "path", path: "self" }, name: environment.identityFieldName },
        method: "get_or_init", args: [{ kind: "path", path: "rt::ObjectIdentity::new" }] },
      { kind: "method-call", receiver: { kind: "call", path: "core::ptr::from_ref", args: [{ kind: "path", path: "self" }] },
        method: "addr", args: [] },
    ), { kind: "impl", generics, target: identityOwner, trait: { kind: "named", path: "PartialEq" }, members: [{ kind: "function",
      name: "eq", visibility: "private", generics: emptyRustGenerics, selfParam: rustSelfParameter("ref"),
      params: [{ name: "other", type: { kind: "reference", mutable: false, referent: { kind: "named", path: "Self" } } }],
      returnType: { kind: "primitive", name: "bool" }, body: { statements: [{ kind: "tail", expr: {
        kind: "call", path: "core::ptr::eq", args: [{ kind: "path", path: "self" }, { kind: "path", path: "other" }],
      } }] },
    }] }, { kind: "impl", generics, target: identityOwner, trait: { kind: "named", path: "Eq" }, members: [] }];
  return [{ kind: "struct", name: environment.typeName, visibility: emission.visibility,
    attrs: rustDeriveAttributes(environment.storage === "value" && !manualClone ? ["Clone", "Copy"] : []), generics, fields },
    ...identityItems,
    ...(target === undefined ? [] : [
      ...(environment.copy ? [{ kind: "impl" as const, generics, target, trait: { kind: "named" as const, path: "Copy" }, members: [] }] : []),
      { kind: "impl" as const, generics, target, trait: { kind: "named" as const, path: "Clone" }, members: [{ kind: "function" as const,
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
  const emission = context.input.program.records.classEnvironment.get(declaration);
  if (emission === undefined) return undefined;
  const { environment, definition } = emission;
  if (context.syntheticNames === undefined) failRustPlannerInvariant("An admitted class environment requires its native synthetic-name scope.", declaration);
  const type = rustClassEnvironmentType(environment.carrier, context);
  if (type?.kind !== "named") failRustPlannerInvariant("An admitted class environment requires its native named type.", declaration);
  const fields: { name: string; value: RustExpr }[] = [];
  if (environment.constructorIdentity) fields.push({ name: environment.identityFieldName,
    value: { kind: "call", path: "core::cell::OnceCell::new", args: [] } });
  const bindings: { name: string; value: RustExpr }[] = [];
  for (const capture of environment.captures) {
    const binding = context.input.program.records.sourceBinding.get(capture.reference);
    const path = binding === undefined ? undefined : rustSourceBindingPath(context, binding);
    if (path === undefined) failRustPlannerInvariant("An admitted class environment capture requires its exact native binding path.", capture.reference);
    const name = allocateRustSyntheticName(context.syntheticNames, "class_capture");
    const value = planRustCaptureValue(declaration, capture, path, capture.storage, context);
    bindings.push({ name, value });
    fields.push({ name: capture.fieldName, value: { kind: "path", path: name } });
  }
  for (const selected of emission.fields) {
    const { field } = selected;
    const value = planExpression(selected.initializer, context);
    if (value === undefined) failRustPlannerInvariant("An admitted class static initializer requires its native value.", field.declaration);
    const name = allocateRustSyntheticName(context.syntheticNames, "class_static");
    bindings.push({ name, value });
    const reference: RustExpr = { kind: "path", path: name };
    fields.push({ name: field.fieldName, value: field.readonly ? reference
      : { kind: "call", path: "core::cell::RefCell::new", args: [reference] } });
  }
  const marker = rustProjectStateMarker(definition, context, environment.genericParameterIndexes);
  if (marker !== undefined) fields.push({ name: marker.name, value: marker.value });
  const value: RustExpr = { kind: "struct-literal", path: type.path, fields };
  return rustValueBlock(bindings, environment.storage === "value" ? value
    : { kind: "call", path: "alloc::rc::Rc::new", args: [value] });
}

export function rustClassEnvironmentParameter(
  environment: Environment,
  context: RustPlanContext,
  mode: "owned" | "borrowed",
): RustFunctionParam | undefined {
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
        referent: { kind: "field" as const, receiver: value, name: capture.fieldName },
        storage: capture.storage,
        valueCarrier: capture.carrier,
        borrowed: "shared" as const,
      })),
    ],
  };
}

export function rustClassEnvironmentForCall(declaration: Node, context: RustPlanContext): RustExpr | undefined {
  const environment = context.input.program.records.classEnvironment.get(declaration)?.environment;
  if (environment === undefined) return undefined;
  const active = context.classEnvironment;
  const ast = context.input.program.source.ast;
  if (context.input.program.records.classEnvironment.get(declaration)?.module === true) {
    const path = sourceModuleItemPath(context, ast.getFileName(ast.getSourceFile(declaration)), environment.bindingName);
    return path === undefined ? undefined : rustModuleCellAccess({ kind: "path", path }, "load", []);
  }
  return active?.declaration === declaration ? active.expression : { kind: "path", path: environment.bindingName };
}

export function rustOwnedClassEnvironmentForCall(declaration: Node, context: RustPlanContext, retained?: RustExpr): RustExpr | undefined {
  const environment = context.input.program.records.classEnvironment.get(declaration)?.environment;
  if (environment !== undefined && !environment.instancesUseEnvironment && !environment.initializationUsesEnvironment) return undefined;
  const value = retained ?? rustClassEnvironmentForCall(declaration, context);
  if (environment === undefined || value === undefined) return undefined;
  if (retained !== undefined || context.input.program.records.classEnvironment.get(declaration)?.module === true) return value;
  if (!environment.copy) return { kind: "method-call", receiver: value, method: "clone", args: [] };
  return context.classEnvironment?.declaration === declaration && context.classEnvironment.borrowed
    ? { kind: "dereference", pointer: value } : value;
}

export function rustClassMemberEnvironmentContext(member: Node, context: RustPlanContext): RustPlanContext {
  const selected = context.input.program.records.classMemberEnvironment.get(member);
  if (selected === undefined) return context;
  const { environment } = selected;
  const value: RustExpr = selected.source === "parameter"
    ? { kind: "path", path: environment.parameterName }
    : selected.source === "field"
      ? { kind: "field", receiver: context.projectDispatchRoot ?? { kind: "path", path: "self" }, name: environment.instanceFieldName }
      : { kind: "method-call", receiver: { kind: "field", receiver: { kind: "path", path: "self" }, name: "state" }, method: "context", args: [] };
  const input = rustClassEnvironmentContext(environment, value, context);
  return { ...input, classEnvironment: { declaration: environment.declaration, expression: value, borrowed: selected.borrowed } };
}

export function rustClassStaticEnvironmentForCall(member: Node | undefined, context: RustPlanContext, retained?: RustExpr): RustExpr | undefined {
  if (member === undefined) return undefined;
  const environment = context.input.program.records.classStaticEnvironment.get(member);
  return environment === undefined ? undefined : retained ?? rustClassEnvironmentForCall(environment.declaration, context);
}

export function rustClassStaticCallGenericArguments(
  member: Node | undefined,
  arguments_: readonly RustCallGenericArgument[] | undefined,
  context: RustPlanContext,
): readonly RustCallGenericArgument[] | undefined {
  if (member === undefined || arguments_ === undefined) return arguments_;
  const count = context.input.program.records.classCallGenericArguments.get(member);
  return count === undefined ? arguments_ : [...arguments_, ...Array.from({ length: count }, (): RustCallGenericArgument => ({ kind: "type", type: { kind: "infer" } }))];
}
