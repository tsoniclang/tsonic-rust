import type { Node } from "@tsonic/tsts";
import { rustTargetTypeRefEquals } from "../../policy/equality.js";
import type { TargetTypeRef } from "../../policy/types.js";
import type {
  RustProjectDowncastRoute,
  RustProjectTypeDefinition,
} from "../../source/rust-target-semantics/project-type-policy.js";
import type { RustProjectMethodDispatchVariant } from "../../source/rust-target-semantics/project-method-dispatch.js";
import { rustSourceTypeCarrierValue } from "../../source/rust-target-types.js";
import type {
  RustExpr,
  RustImplFunction,
  RustItem,
  RustTraitFunction,
  RustType,
} from "../rust-ast/nodes.js";
import { rustLintAttributes } from "../rust-ast/lint-policy.js";
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
  readRustProjectMethodOverride,
  rustProjectObjectDispatchField,
  rustProjectObjectIdentityField,
  writeRustProjectMethodOverride,
  writeRustProjectObjectField,
} from "./project-objects.js";
import {
  cloneExpression,
  cloneField,
  type ProjectCallableShape,
  type ProjectClassStateLayer,
  projectCallableShape,
  projectFieldStoragePath,
  projectMemberImplementation,
  projectMethodPropertyStoragePath,
  projectOwnAccessors,
  projectOwnMethodProperties,
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
import { rustCallableSpecialization } from "./callable-generics.js";

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
    const dispatch = context.input.projectFieldDispatch.planFor(field.declaration);
    const read = context.input.projectTypes.memberSlotName(field.declaration, "read");
    const write = dispatch?.write === undefined
      ? undefined
      : context.input.projectTypes.memberSlotName(field.declaration, "write");
    if (dispatch === undefined || read === undefined ||
      dispatch.write !== undefined && write === undefined) {
      return undefined;
    }
    functions.push({
      name: read,
      selfParam: dispatch.read.selfMode,
      params: [],
      returnType: field.type,
      ...(dispatch.read.fallible ? { fallible: true } : {}),
    });
    if (dispatch.write !== undefined) {
      functions.push({
        name: write!,
        selfParam: dispatch.write.selfMode,
        params: [{ name: "value", type: field.type }],
        ...(dispatch.write.fallible ? { fallible: true } : {}),
      });
    }
  }
  for (const accessor of projectOwnAccessors(definition, context)) {
    const shape = projectAccessorCallableShape(
      definition,
      carrier,
      accessor.declaration,
      accessor.role,
      context,
    );
    const slot = context.input.projectTypes.memberSlotName(
      accessor.declaration,
      accessor.role,
    );
    if (shape === undefined || slot === undefined) {
      return undefined;
    }
    functions.push({
      name: slot,
      selfParam: "rc",
      params: shape.params.map((parameter) => ({ ...parameter, mutable: false })),
      ...(shape.returnType === undefined ? {} : { returnType: shape.returnType }),
      ...(shape.fallible ? { fallible: true } : {}),
      ...(shape.isUnsafe ? { isUnsafe: true } : {}),
    });
  }
  for (const member of projectOwnMethods(definition, context)) {
    if (context.input.ast.hasModifierKind(member, "static")) {
      continue;
    }
    for (const variant of context.input.projectMethodDispatch.variantsForMember(member)) {
      const specialization = rustCallableSpecialization(
        variant.sourceTypeParameterNames,
        variant.targetTypeArguments,
      );
      const shape = specialization === undefined
        ? undefined
        : projectCallableShape(member, context, specialization);
      if (shape === undefined) {
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
      functions.push(signature(variant.virtualSlot));
      if (definition.kind === "class") {
        functions.push(signature(variant.exactSlot));
      }
    }
  }
  const methodProperties = projectOwnMethodProperties(definition, carrier, context);
  if (methodProperties === undefined) {
    return undefined;
  }
  for (const property of methodProperties) {
    const write = context.input.projectTypes.memberSlotName(
      property.declaration,
      "method-write",
    );
    if (write === undefined || functions.some((candidate) => candidate.name === write)) {
      if (write === undefined) {
        return undefined;
      }
      continue;
    }
    functions.push({
      name: write,
      selfParam: "ref",
      params: [{ name: "value", type: property.callableType }],
    });
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
    attrs: [rustLintAttributes.deadCode],
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
  const methodImplementations = new Map<Node, RustImplFunction[]>();
  const accessorImplementations = new Map<Node, RustImplFunction>();
  const implementationFor = (
    implementation: Node,
    targetTypeArguments: readonly TargetTypeRef[],
  ): RustImplFunction | undefined => {
    const variant = context.input.projectMethodDispatch.variantForMember(
      implementation,
      targetTypeArguments,
    );
    if (variant === undefined) {
      return undefined;
    }
    const existing = (methodImplementations.get(implementation) ?? []).find((candidate) =>
      candidate.name === variant.exactSlot);
    if (existing !== undefined) {
      return existing;
    }
    const planned = planRootMethodImplementation(
      concreteCarrier,
      implementation,
      variant,
      context,
    );
    if (planned !== undefined) {
      const implementations = methodImplementations.get(implementation) ?? [];
      implementations.push(planned);
      methodImplementations.set(implementation, implementations);
    }
    return planned;
  };
  const accessorImplementationFor = (
    accessor: Node,
    role: "read" | "write",
  ): RustImplFunction | undefined => {
    const existing = accessorImplementations.get(accessor);
    if (existing !== undefined) {
      return existing;
    }
    const planned = planRootAccessorImplementation(
      concreteCarrier,
      accessor,
      role,
      context,
    );
    if (planned !== undefined) {
      accessorImplementations.set(accessor, planned);
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
      accessorImplementationFor,
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
  const helpers = [
    ...methodImplementations.values(),
    ...[...accessorImplementations.values()].map((implementation) => [implementation]),
  ].flat().sort((left, right) =>
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
  implementationFor: (
    implementation: Node,
    targetTypeArguments: readonly TargetTypeRef[],
  ) => RustImplFunction | undefined,
  accessorImplementationFor: (
    accessor: Node,
    role: "read" | "write",
  ) => RustImplFunction | undefined,
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
    const dispatch = context.input.projectFieldDispatch.planFor(field.declaration);
    const implementation = field.origin === "external"
      ? { kind: "stored" as const, declaration: field.declaration }
      : context.input.projectFieldDispatch.implementationFor(
          concrete,
          field.declaration,
        );
    const storagePath = implementation?.kind === "stored"
      ? projectFieldStoragePath(implementation.declaration, layers, context)
      : undefined;
    const readHelper = implementation?.kind === "accessor"
      ? accessorImplementationFor(implementation.getter, "read")
      : undefined;
    const read = context.input.projectTypes.memberSlotName(field.declaration, "read");
    const write = dispatch?.write === undefined
      ? undefined
      : context.input.projectTypes.memberSlotName(field.declaration, "write");
    const readValue = implementation?.kind === "stored"
      ? storagePath === undefined
        ? undefined
        : {
            expression: readRustProjectObjectField(
              { kind: "path", path: "self" },
              storagePath,
              field.carrier,
            ),
            fallible: false,
          }
      : implementation?.kind === "accessor"
        ? planProjectFieldAccessorCall(
            rootType,
            readHelper,
            undefined,
            field.type,
          )
        : undefined;
    if (dispatch === undefined || implementation === undefined || read === undefined ||
      readValue === undefined ||
      dispatch.write !== undefined && write === undefined) {
      return undefined;
    }
    const readResult = dispatch.read.fallible
      ? readValue.fallible
        ? readValue.expression
        : { kind: "call" as const, path: "Ok", args: [readValue.expression] }
      : readValue.fallible
        ? undefined
        : readValue.expression;
    if (readResult === undefined) {
      return undefined;
    }
    functions.push({
      name: read,
      visibility: "private",
      selfParam: dispatch.read.selfMode,
      params: [],
      returnType: field.type,
      ...(dispatch.read.fallible ? { fallible: true } : {}),
      body: {
        statements: [{
          kind: "tail",
          expr: readResult,
        }],
      },
    });
    if (dispatch.write !== undefined) {
      const writeValue = implementation.kind === "stored"
        ? storagePath === undefined
          ? undefined
          : {
              expression: writeRustProjectObjectField(
                { kind: "path", path: "self" },
                storagePath,
                "=",
                { kind: "path", path: "value" },
              ),
              fallible: false,
            }
        : implementation.setter === undefined
          ? undefined
          : (() => {
              const helper = accessorImplementationFor(implementation.setter!, "write");
              return planProjectFieldAccessorCall(
                rootType,
                helper,
                { kind: "path", path: "value" },
                field.type,
              );
            })();
      if (writeValue === undefined || !dispatch.write.fallible && writeValue.fallible) {
        return undefined;
      }
      functions.push({
        name: write!,
        visibility: "private",
        selfParam: dispatch.write.selfMode,
        params: [{ name: "value", type: field.type }],
        ...(dispatch.write.fallible ? { fallible: true } : {}),
        body: dispatch.write.fallible
          ? {
              statements: [{
                kind: "tail",
                expr: writeValue.fallible
                  ? writeValue.expression
                  : {
                      kind: "evaluate-then",
                      effect: writeValue.expression,
                      discard: "unit",
                      value: { kind: "call", path: "Ok", args: [{ kind: "path", path: "()" }] },
                    },
              }],
            }
          : {
              statements: [{
                kind: "expr",
                expr: writeValue.expression,
              }],
            },
      });
    }
  }
  for (const accessor of projectOwnAccessors(contract, context)) {
    const implementation = projectMemberImplementation(
      concrete,
      accessor.declaration,
      context,
    );
    const helper = implementation === undefined
      ? undefined
      : accessorImplementationFor(implementation, accessor.role);
    const slot = context.input.projectTypes.memberSlotName(
      accessor.declaration,
      accessor.role,
    );
    const contractShape = projectAccessorCallableShape(
      contract,
      contractCarrier,
      accessor.declaration,
      accessor.role,
      context,
    );
    const forwarder = implementation === undefined || helper === undefined ||
        slot === undefined || contractShape === undefined
      ? undefined
      : planRootCallableForwarder(
          implementation,
          slot,
          rootType,
          helper,
          contractShape,
          undefined,
          context,
        );
    if (forwarder === undefined) {
      return undefined;
    }
    functions.push(forwarder);
  }
  for (const member of projectOwnMethods(contract, context)) {
    if (context.input.ast.hasModifierKind(member, "static")) {
      continue;
    }
    for (const variant of context.input.projectMethodDispatch.variantsForMember(member)) {
      const virtualImplementation = projectMemberImplementation(concrete, member, context);
      if (virtualImplementation === undefined) {
        return undefined;
      }
      const virtualImplementationMethod = implementationFor(
        virtualImplementation,
        variant.targetTypeArguments,
      );
      const virtualMethod = virtualImplementationMethod === undefined
        ? undefined
        : planRootMethodForwarder(
            concreteCarrier,
            member,
            virtualImplementation,
            variant,
            variant.virtualSlot,
            rootType,
            virtualImplementationMethod,
            (context.input.projectMethodProperties.usageFor(member)?.writable === true ||
                context.input.projectMethodProperties.usageFor(virtualImplementation)?.writable === true)
              ? projectMethodPropertyStoragePath(
                  virtualImplementation,
                  layers,
                  context,
                )
              : undefined,
            context,
          );
      if (virtualMethod === undefined) {
        return undefined;
      }
      functions.push(virtualMethod);
      if (contract.kind === "class") {
        const exactImplementationMethod = implementationFor(
          member,
          variant.targetTypeArguments,
        );
        const exactMethod = exactImplementationMethod === undefined
          ? undefined
          : planRootMethodForwarder(
              concreteCarrier,
              member,
              member,
              variant,
              variant.exactSlot,
              rootType,
              exactImplementationMethod,
              undefined,
              context,
            );
        if (exactMethod === undefined) {
          return undefined;
        }
        functions.push(exactMethod);
      }
      const usage = context.input.projectMethodProperties.usageFor(member);
      if (usage?.writable === true) {
        const write = context.input.projectTypes.memberSlotName(member, "method-write");
        const storagePath = projectMethodPropertyStoragePath(
          virtualImplementation,
          layers,
          context,
        );
        const implementationOwner = context.input.projectTypes
          .definitionContainingDeclaration(virtualImplementation);
        const implementationCarrier = implementationOwner === undefined
          ? undefined
          : context.input.projectTypes.relationship(
              concreteCarrier,
              implementationOwner,
            );
        const properties = implementationCarrier?.kind === "related"
          ? projectOwnMethodProperties(
              implementationOwner!,
              implementationCarrier.targetType,
              context,
            )
          : undefined;
        const property = properties?.find((candidate) =>
          candidate.declaration === virtualImplementation);
        if (write === undefined || storagePath === undefined || property === undefined) {
          return undefined;
        }
        if (!functions.some((candidate) => candidate.name === write)) {
          functions.push({
            name: write,
            visibility: "private",
            selfParam: "ref",
            params: [{ name: "value", type: property.callableType }],
            body: {
              statements: [{
                kind: "expr",
                expr: writeRustProjectMethodOverride(
                  { kind: "path", path: "self" },
                  storagePath,
                  { kind: "path", path: "value" },
                ),
              }],
            },
          });
        }
      }
    }
  }
  return functions;
}

function planProjectFieldAccessorCall(
  rootType: RustType,
  helper: RustImplFunction | undefined,
  value: RustExpr | undefined,
  valueType: RustType,
): { readonly expression: RustExpr; readonly fallible: boolean } | undefined {
  const read = value === undefined;
  const expectedParameters = read ? [] : [{ name: "value", type: valueType }];
  if (helper === undefined || helper.selfParam !== "rc" || helper.isAsync === true ||
    helper.isUnsafe === true || !rustFunctionTypesMatch(
      helper.params,
      helper.returnType,
      expectedParameters,
      read ? valueType : undefined,
    )) {
    return undefined;
  }
  return {
    expression: {
      kind: "associated-call",
      owner: rootType,
      method: helper.name,
      args: [{ kind: "path", path: "self" }, ...(read ? [] : [value])],
    },
    fallible: helper.fallible === true,
  };
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
  variant: RustProjectMethodDispatchVariant,
  context: RustPlanContext,
): RustImplFunction | undefined {
  const specialization = rustCallableSpecialization(
    variant.sourceTypeParameterNames,
    variant.targetTypeArguments,
  );
  return specialization === undefined
    ? undefined
    : planRootCallableImplementation(
        concreteCarrier,
        implementation,
        context,
        {
          targetName: variant.exactSlot,
          typeArgumentSubstitutions: specialization,
        },
      );
}

function planRootAccessorImplementation(
  concreteCarrier: TargetTypeRef,
  accessor: Node,
  role: "read" | "write",
  context: RustPlanContext,
): RustImplFunction | undefined {
  const targetName = context.input.projectTypes.memberSlotName(accessor, role);
  return targetName === undefined
    ? undefined
    : planRootCallableImplementation(
        concreteCarrier,
        accessor,
        context,
        {
          targetName,
          safetyPlacement: role === "read" ? "getter" : "setter",
        },
      );
}

function planRootCallableImplementation(
  concreteCarrier: TargetTypeRef,
  implementation: Node,
  context: RustPlanContext,
  options: {
    readonly targetName: string;
    readonly safetyPlacement?: "getter" | "setter";
    readonly typeArgumentSubstitutions?: ReadonlyMap<string, TargetTypeRef>;
  },
): RustImplFunction | undefined {
  const owner = context.input.projectTypes.definitionContainingDeclaration(implementation);
  if (owner === undefined) {
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
  }, {
    targetName: options.targetName,
    ...(options.safetyPlacement === undefined
      ? {}
      : { safetyPlacement: options.safetyPlacement }),
    ...(options.typeArgumentSubstitutions === undefined
      ? {}
      : { typeArgumentSubstitutions: options.typeArgumentSubstitutions }),
  });
  if (planned === undefined) {
    return undefined;
  }
  return {
    ...planned,
    name: options.targetName,
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
  variant: RustProjectMethodDispatchVariant,
  slot: string,
  rootType: RustType,
  helper: RustImplFunction,
  overrideStoragePath: readonly string[] | undefined,
  context: RustPlanContext,
): RustImplFunction | undefined {
  const contractOwner = context.input.projectTypes.definitionContainingDeclaration(contractMember);
  if (contractOwner === undefined) {
    return undefined;
  }
  const contractRelation = context.input.projectTypes.relationship(concreteCarrier, contractOwner);
  const specialization = rustCallableSpecialization(
    variant.sourceTypeParameterNames,
    variant.targetTypeArguments,
  );
  const contractShape = contractRelation.kind === "related" && specialization !== undefined
    ? projectCallableShape(contractMember, {
        ...context,
        typeParameterSubstitutions: projectTypeSubstitutions(
          contractOwner,
          contractRelation.targetType,
        ),
      }, specialization)
    : undefined;
  return contractShape === undefined
    ? undefined
    : planRootCallableForwarder(
        implementation,
        slot,
        rootType,
        helper,
        contractShape,
        overrideStoragePath,
        context,
      );
}

function planRootCallableForwarder(
  implementation: Node,
  slot: string,
  rootType: RustType,
  helper: RustImplFunction,
  contractShape: ProjectCallableShape,
  overrideStoragePath: readonly string[] | undefined,
  context: RustPlanContext,
): RustImplFunction | undefined {
  if (
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
  const overrideName = allocateRustLocalName(
    new Set(helper.params.map((parameter) => parameter.name)),
    "method_override",
  );
  return {
    name: slot,
    visibility: "private",
    selfParam: "rc",
    params: helper.params,
    ...(helper.returnType === undefined ? {} : { returnType: helper.returnType }),
    ...(helper.fallible === true ? { fallible: true } : {}),
    ...(helper.isUnsafe === true ? { isUnsafe: true } : {}),
    body: {
      statements: [
        ...(overrideStoragePath === undefined
          ? []
          : [{
              kind: "if-let-some" as const,
              binding: overrideName,
              expression: readRustProjectMethodOverride(
                { kind: "path", path: "self" },
                overrideStoragePath,
              ),
              body: {
                statements: [{
                  kind: "return" as const,
                  expr: {
                    kind: "method-call" as const,
                    receiver: { kind: "path" as const, path: overrideName },
                    method: "call",
                    args: [{
                      kind: "tuple-literal" as const,
                      elements: helper.params.map((parameter) => ({
                        kind: "path" as const,
                        path: parameter.name,
                      })),
                    }],
                  },
                }],
              },
            }]),
        {
        kind: "tail",
        expr: helper.isUnsafe === true
          ? { kind: "unsafe", expression: call }
          : call,
        },
      ],
    },
  };
}

function projectAccessorCallableShape(
  definition: RustProjectTypeDefinition,
  carrier: TargetTypeRef,
  declaration: Node,
  role: "read" | "write",
  context: RustPlanContext,
): ProjectCallableShape | undefined {
  const shape = projectCallableShape(declaration, {
    ...context,
    typeParameterSubstitutions: projectTypeSubstitutions(definition, carrier),
  });
  if (shape === undefined || shape.params.length !== (role === "read" ? 0 : 1)) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, declaration),
      "rust.backend.project-accessor-signature",
      "Project accessor does not preserve one exact getter or setter Rust ABI.",
    ));
    return undefined;
  }
  return shape;
}

function allocateRustLocalName(used: ReadonlySet<string>, preferred: string): string {
  let suffix = 1;
  for (;;) {
    const candidate = suffix === 1 ? preferred : `${preferred}_${suffix}`;
    if (!used.has(candidate)) {
      return candidate;
    }
    suffix += 1;
  }
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
