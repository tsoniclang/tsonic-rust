import type { Node } from "@tsonic/tsts";
import { rustTargetTypeRefEquals } from "../../policy/equality.js";
import type { TargetTypeRef } from "../../policy/types.js";
import type {
  RustProjectDowncastRoute,
  RustProjectTypeDefinition,
} from "../../source/rust-target-semantics/project-type-policy.js";
import { rustSourceTypeCarrierValue } from "../../source/rust-target-types.js";
import type {
  RustExpr,
  RustImplFunction,
  RustItem,
  RustTraitFunction,
  RustType,
} from "../rust-ast/nodes.js";
import { missingFactDiagnostic } from "./diagnostics.js";
import { planProjectMethod } from "./declarations-nominal.js";
import {
  diagnosticInput,
  sourceTypePath,
} from "./plan-context.js";
import type {
  RustEffectiveExpressionOverride,
  RustPlanContext,
} from "./plan-context.js";
import {
  readRustProjectObjectField,
  rustProjectObjectDispatchField,
  rustProjectObjectIdentityField,
  writeRustProjectObjectField,
} from "./project-objects.js";
import {
  cloneExpression,
  cloneField,
  type ProjectClassStateLayer,
  projectCallableShape,
  projectFieldStoragePath,
  projectMemberImplementation,
  projectOwnFields,
  projectOwnMethods,
  projectTypeSubstitutions,
  rustFunctionTypesMatch,
} from "./project-polymorphism-model.js";
import {
  rustProjectDispatchTraitName,
  rustProjectDispatchTraitType,
  rustProjectTypeParameters,
} from "./project-polymorphism-names.js";
import {
  allocateRustSyntheticName,
  createRustSyntheticNameState,
} from "./synthetic-names.js";

export function projectIdentityImplementations(
  definition: RustProjectTypeDefinition,
  wrapperType: RustType,
): readonly RustItem[] {
  const typeParams = rustProjectTypeParameters(definition);
  return [
    {
      kind: "impl",
      ...(typeParams.length === 0 ? {} : { typeParams }),
      trait: { kind: "named", path: "PartialEq" },
      target: wrapperType,
      functions: [{
        name: "eq",
        visibility: "private",
        selfParam: "ref",
        params: [{
          name: "other",
          type: {
            kind: "reference",
            referent: { kind: "named", path: "Self" },
            mutable: false,
          },
        }],
        returnType: { kind: "primitive", name: "bool" },
        body: {
          statements: [{
            kind: "tail",
            expr: {
              kind: "binary",
              operator: "==",
              left: {
                kind: "field",
                receiver: { kind: "path", path: "self" },
                name: rustProjectObjectIdentityField,
              },
              right: {
                kind: "field",
                receiver: { kind: "path", path: "other" },
                name: rustProjectObjectIdentityField,
              },
            },
          }],
        },
      }],
    },
    {
      kind: "impl",
      ...(typeParams.length === 0 ? {} : { typeParams }),
      trait: { kind: "named", path: "Eq" },
      target: wrapperType,
      functions: [],
    },
  ];
}

export function planProjectDispatchTrait(
  definition: RustProjectTypeDefinition,
  carrier: TargetTypeRef,
  context: RustPlanContext,
): RustItem | undefined {
  const fields = projectOwnFields(definition, carrier, context);
  if (fields === undefined) {
    return undefined;
  }
  const functions: RustTraitFunction[] = [];
  for (const route of context.input.projectTypes.downcastRoutesFor(definition)) {
    const returnType = projectDowncastReturnType(route, context);
    if (returnType === undefined) {
      return undefined;
    }
    functions.push({
      name: route.slot,
      selfParam: "rc",
      params: [],
      returnType,
    });
  }
  for (const field of fields) {
    const read = context.input.projectTypes.memberSlotName(field.declaration, "read");
    const write = context.input.projectTypes.memberSlotName(field.declaration, "write");
    if (read === undefined || write === undefined) {
      return undefined;
    }
    functions.push({ name: read, selfParam: "rc", params: [], returnType: field.type });
    functions.push({
      name: write,
      selfParam: "rc",
      params: [{ name: "value", type: field.type }],
    });
  }
  for (const member of projectOwnMethods(definition, context)) {
    if (context.input.ast.hasModifierKind(member, "static")) {
      continue;
    }
    const shape = projectCallableShape(member, context);
    if (shape === undefined) {
      return undefined;
    }
    const virtual = context.input.projectTypes.memberSlotName(member, "virtual");
    const exact = definition.kind === "class"
      ? context.input.projectTypes.memberSlotName(member, "exact")
      : undefined;
    if (virtual === undefined || (definition.kind === "class" && exact === undefined)) {
      return undefined;
    }
    const signature = (name: string): RustTraitFunction => ({
      name,
      selfParam: "rc",
      params: shape.params.map((parameter) => ({ ...parameter, mutable: false })),
      ...(shape.returnType === undefined ? {} : { returnType: shape.returnType }),
      ...(shape.fallible ? { fallible: true } : {}),
      ...(shape.isUnsafe ? { isUnsafe: true } : {}),
    });
    functions.push(signature(virtual));
    if (exact !== undefined) {
      functions.push(signature(exact));
    }
  }
  const superTraits = context.input.projectTypes.heritageForDefinition(definition).map((edge) =>
    rustProjectDispatchTraitType(edge.targetType, context));
  if (superTraits.some((type) => type === undefined)) {
    return undefined;
  }
  const typeParams = rustProjectTypeParameters(definition);
  return {
    kind: "trait",
    name: rustProjectDispatchTraitName(definition),
    visibility: "crate",
    attrs: ["#[allow(dead_code)]"],
    ...(typeParams.length === 0 ? {} : { typeParams }),
    ...(superTraits.length === 0 ? {} : { superTraits: superTraits as readonly RustType[] }),
    functions,
  };
}

export function planProjectRootImplementations(
  concrete: RustProjectTypeDefinition,
  concreteCarrier: TargetTypeRef,
  rootType: RustType,
  layers: readonly ProjectClassStateLayer[],
  context: RustPlanContext,
): readonly RustItem[] | undefined {
  const lineage = context.input.projectTypes.classLineage(concrete);
  const interfaces = context.input.projectTypes.interfacesForClass(concrete);
  if (lineage === undefined || interfaces === undefined) {
    return undefined;
  }
  const items: RustItem[] = [];
  const typeParams = rustProjectTypeParameters(concrete);
  const methodImplementations = new Map<Node, RustImplFunction>();
  const implementationFor = (implementation: Node): RustImplFunction | undefined => {
    const existing = methodImplementations.get(implementation);
    if (existing !== undefined) {
      return existing;
    }
    const planned = planRootMethodImplementation(
      concreteCarrier,
      implementation,
      context,
    );
    if (planned !== undefined) {
      methodImplementations.set(implementation, planned);
    }
    return planned;
  };
  for (const contract of [...lineage, ...interfaces]) {
    const relation = context.input.projectTypes.relationship(concreteCarrier, contract);
    if (relation.kind !== "related") {
      return undefined;
    }
    const traitType = rustProjectDispatchTraitType(relation.targetType, context);
    const functions = planRootContractFunctions(
      concrete,
      concreteCarrier,
      contract,
      relation.targetType,
      rootType,
      layers,
      implementationFor,
      context,
    );
    if (traitType === undefined || functions === undefined) {
      return undefined;
    }
    items.push({
      kind: "impl",
      ...(typeParams.length === 0 ? {} : { typeParams }),
      trait: traitType,
      target: rootType,
      functions,
    });
  }
  const helpers = [...methodImplementations.values()].sort((left, right) =>
    left.name.localeCompare(right.name, "en"));
  return helpers.length === 0
    ? items
    : [{
        kind: "impl",
        ...(typeParams.length === 0 ? {} : { typeParams }),
        target: rootType,
        functions: helpers,
      }, ...items];
}

function planRootContractFunctions(
  concrete: RustProjectTypeDefinition,
  concreteCarrier: TargetTypeRef,
  contract: RustProjectTypeDefinition,
  contractCarrier: TargetTypeRef,
  rootType: RustType,
  layers: readonly ProjectClassStateLayer[],
  implementationFor: (implementation: Node) => RustImplFunction | undefined,
  context: RustPlanContext,
): readonly RustImplFunction[] | undefined {
  const functions: RustImplFunction[] = [];
  for (const route of context.input.projectTypes.downcastRoutesFor(contract)) {
    const returnType = projectDowncastReturnType(route, context);
    if (returnType === undefined) {
      return undefined;
    }
    const relation = context.input.projectTypes.relationship(concreteCarrier, route.target);
    const matches = relation.kind === "related" &&
      rustTargetTypeRefEquals(relation.targetType, route.targetCarrier);
    functions.push({
      name: route.slot,
      visibility: "private",
      selfParam: "rc",
      params: [],
      returnType,
      body: {
        statements: [{
          kind: "tail",
          expr: matches
            ? { kind: "call", path: "Some", args: [{ kind: "path", path: "self" }] }
            : { kind: "none" },
        }],
      },
    });
  }
  const fields = projectOwnFields(contract, contractCarrier, context);
  if (fields === undefined) {
    return undefined;
  }
  for (const field of fields) {
    const implementation = field.origin === "external"
      ? field.declaration
      : projectMemberImplementation(concrete, field.declaration, context);
    const storagePath = implementation === undefined
      ? undefined
      : projectFieldStoragePath(implementation, layers, context);
    const read = context.input.projectTypes.memberSlotName(field.declaration, "read");
    const write = context.input.projectTypes.memberSlotName(field.declaration, "write");
    if (implementation === undefined || storagePath === undefined || read === undefined || write === undefined) {
      return undefined;
    }
    functions.push({
      name: read,
      visibility: "private",
      selfParam: "rc",
      params: [],
      returnType: field.type,
      body: {
        statements: [{
          kind: "tail",
          expr: readRustProjectObjectField({ kind: "path", path: "self" }, storagePath, field.carrier),
        }],
      },
    });
    functions.push({
      name: write,
      visibility: "private",
      selfParam: "rc",
      params: [{ name: "value", type: field.type }],
      body: {
        statements: [{
          kind: "expr",
          expr: writeRustProjectObjectField(
            { kind: "path", path: "self" },
            storagePath,
            "=",
            { kind: "path", path: "value" },
          ),
        }],
      },
    });
  }
  for (const member of projectOwnMethods(contract, context)) {
    if (context.input.ast.hasModifierKind(member, "static")) {
      continue;
    }
    const virtualImplementation = projectMemberImplementation(concrete, member, context);
    const virtualSlot = context.input.projectTypes.memberSlotName(member, "virtual");
    if (virtualImplementation === undefined || virtualSlot === undefined) {
      return undefined;
    }
    const virtualImplementationMethod = implementationFor(virtualImplementation);
    const virtualMethod = virtualImplementationMethod === undefined
      ? undefined
      : planRootMethodForwarder(
      concreteCarrier,
      member,
      virtualImplementation,
      virtualSlot,
      rootType,
      virtualImplementationMethod,
      context,
    );
    if (virtualMethod === undefined) {
      return undefined;
    }
    functions.push(virtualMethod);
    if (contract.kind === "class") {
      const exactSlot = context.input.projectTypes.memberSlotName(member, "exact");
      const exactImplementationMethod = implementationFor(member);
      const exactMethod = exactSlot === undefined || exactImplementationMethod === undefined
        ? undefined
        : planRootMethodForwarder(
            concreteCarrier,
            member,
            member,
            exactSlot,
            rootType,
            exactImplementationMethod,
            context,
          );
      if (exactMethod === undefined) {
        return undefined;
      }
      functions.push(exactMethod);
    }
  }
  return functions;
}

function projectDowncastReturnType(
  route: RustProjectDowncastRoute,
  context: RustPlanContext,
): RustType | undefined {
  const dispatch = rustProjectDispatchTraitType(route.targetCarrier, context);
  return dispatch === undefined
    ? undefined
    : {
        kind: "named",
        path: "Option",
        typeArguments: [{
          kind: "named",
          path: "std::rc::Rc",
          typeArguments: [{ kind: "trait-object", trait: dispatch }],
        }],
      };
}

function planRootMethodImplementation(
  concreteCarrier: TargetTypeRef,
  implementation: Node,
  context: RustPlanContext,
): RustImplFunction | undefined {
  const owner = context.input.projectTypes.definitionContainingDeclaration(implementation);
  const helperName = context.input.projectTypes.memberSlotName(implementation, "exact");
  if (owner === undefined || helperName === undefined) {
    return undefined;
  }
  const ownerRelation = context.input.projectTypes.relationship(concreteCarrier, owner);
  if (ownerRelation.kind !== "related") {
    return undefined;
  }
  const syntheticNames = createRustSyntheticNameState(context.input.ast, implementation, []);
  const thisBindingName = allocateRustSyntheticName(syntheticNames, "project_this");
  const thisPlan = projectThisOverrides(
    implementation,
    ownerRelation.targetType,
    thisBindingName,
    context,
  );
  const planned = planProjectMethod(implementation, {
    ...context,
    syntheticNames,
    typeParameterSubstitutions: projectTypeSubstitutions(owner, ownerRelation.targetType),
    expressionOverrides: thisPlan.overrides,
    projectDispatchRoot: { kind: "path", path: "self" },
  });
  if (planned === undefined) {
    return undefined;
  }
  return {
    ...planned,
    name: helperName,
    visibility: "private",
    selfParam: "rc",
    body: thisPlan.binding === undefined
      ? planned.body
      : {
          ...planned.body,
          statements: [{
            kind: "let",
            name: thisBindingName,
            mutable: false,
            init: thisPlan.binding,
          }, ...planned.body.statements],
        },
  };
}

function planRootMethodForwarder(
  concreteCarrier: TargetTypeRef,
  contractMember: Node,
  implementation: Node,
  slot: string,
  rootType: RustType,
  helper: RustImplFunction,
  context: RustPlanContext,
): RustImplFunction | undefined {
  const contractOwner = context.input.projectTypes.definitionContainingDeclaration(contractMember);
  if (contractOwner === undefined) {
    return undefined;
  }
  const contractRelation = context.input.projectTypes.relationship(concreteCarrier, contractOwner);
  const contractShape = contractRelation.kind === "related"
    ? projectCallableShape(contractMember, {
        ...context,
        typeParameterSubstitutions: projectTypeSubstitutions(
          contractOwner,
          contractRelation.targetType,
        ),
      })
    : undefined;
  if (contractShape === undefined ||
    (helper.fallible === true) !== contractShape.fallible ||
    (helper.isUnsafe === true) !== contractShape.isUnsafe ||
    !rustFunctionTypesMatch(
      helper.params,
      helper.returnType,
      contractShape.params,
      contractShape.returnType,
    )) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, implementation),
      "rust.backend.project-dispatch-signature",
      "Selected project member implementation does not preserve the exact contract Rust ABI.",
    ));
    return undefined;
  }
  const call: RustExpr = {
    kind: "associated-call",
    owner: rootType,
    method: helper.name,
    args: [
      { kind: "path", path: "self" },
      ...helper.params.map((parameter) => ({
        kind: "path" as const,
        path: parameter.name,
      })),
    ],
  };
  return {
    name: slot,
    visibility: "private",
    selfParam: "rc",
    params: helper.params,
    ...(helper.returnType === undefined ? {} : { returnType: helper.returnType }),
    ...(helper.fallible === true ? { fallible: true } : {}),
    ...(helper.isUnsafe === true ? { isUnsafe: true } : {}),
    body: {
      statements: [{
        kind: "tail",
        expr: helper.isUnsafe === true
          ? { kind: "unsafe", expression: call }
          : call,
      }],
    },
  };
}

function projectThisOverrides(
  method: Node,
  ownerCarrier: TargetTypeRef,
  bindingName: string,
  context: RustPlanContext,
): {
  readonly overrides: ReadonlyMap<Node, RustEffectiveExpressionOverride>;
  readonly binding?: RustExpr;
} {
  const overrides = new Map<Node, RustEffectiveExpressionOverride>();
  const ownerValue = rustSourceTypeCarrierValue(ownerCarrier);
  const wrapperPath = ownerValue === undefined ? undefined : sourceTypePath(context, ownerValue);
  const dispatchType = rustProjectDispatchTraitType(ownerCarrier, context);
  if (wrapperPath === undefined || dispatchType === undefined) {
    return { overrides };
  }
  const visit = (node: Node): void => {
    const kind = context.input.ast.kindName(node);
    if (kind === "KindThisExpression" || kind === "KindThisKeyword") {
      const selected = context.input.facts.getRuntimeCarrierFact(node)?.carrier;
      const selectedDefinition = context.input.projectTypes.definitionForCarrier(selected);
      const ownerDefinition = context.input.projectTypes.definitionForCarrier(ownerCarrier);
      if (selectedDefinition === ownerDefinition) {
        overrides.set(node, {
          carrier: ownerCarrier,
          valueForm: "value",
          expression: cloneExpression({ kind: "path", path: bindingName }),
        });
      }
      return;
    }
    context.input.ast.forEachChild(node, (child) => {
      if (child !== undefined) {
        visit(child);
      }
    });
  };
  visit(method);
  return overrides.size === 0
    ? { overrides }
    : {
        overrides,
        binding: {
          kind: "struct-literal",
          path: wrapperPath,
          fields: [
            {
              name: rustProjectObjectIdentityField,
              value: cloneField({ kind: "path", path: "self" }, rustProjectObjectIdentityField),
            },
            {
              name: rustProjectObjectDispatchField,
              value: cloneExpression({ kind: "path", path: "self" }),
            },
          ],
        },
      };
}
