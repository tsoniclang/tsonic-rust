import {
  cloneExpression,
  cloneField,
  projectCallableShape,
  projectLifetimeSubstitutions,
  projectTypeSubstitutions,
  rustFunctionTypesMatch,
} from "./model.js";
import { allocateRustSyntheticName, createRustSyntheticNameState } from "../../names/synthetic.js";
import {
  diagnosticInput,
  rustErrorBoundaryForProjectMember,
  rustErrorType,
  sourceTypePath,
} from "../../program/plan-context.js";
import { missingFactDiagnostic } from "../../diagnostics.js";
import { rustTypeEquals } from "../../../target-ast/inspection/type-equality.js";
import { planProjectMethod } from "../../declarations/nominal.js";
import { readRustProjectMethodOverride, rustProjectObjectDispatchField, rustProjectObjectIdentityField } from "../project-objects.js";
import { rustCallableSpecialization } from "../../declarations/callable-generics.js";
import { rustProjectDispatchTraitType } from "./names.js";
import { rustSourceTypeCarrierValue } from "../../../../target-model/types/index.js";
import { emptyRustGenerics } from "../../../target-ast/nodes.js";
import { rustSelfParameter } from "../../declarations/self-parameter.js";
import type { Node } from "@tsonic/tsts";
import type { RustEffectiveExpressionOverride, RustPlanContext } from "../../program/plan-context.js";
import type { RustExpr, RustImplFunction, RustType } from "../../../target-ast/nodes.js";
import type { RustProjectTypeDefinition } from "../../../../analysis/project-types/type-policy.js";
import type { RustProjectDowncastRoute } from "../../../../analysis/project-types/type-policy.js";
import type { RustProjectMethodDispatchVariant } from "../../../../analysis/project-types/method-dispatch.js";
import type { TargetTypeRef } from "../../../../target-model/types/model.js";
import type { ProjectCallableShape } from "./model.js";

export function planProjectFieldAccessorCall(
  rootType: RustType,
  helper: RustImplFunction | undefined,
  value: RustExpr | undefined,
  valueType: RustType,
): { readonly expression: RustExpr; readonly errorType?: RustType } | undefined {
  const read = value === undefined;
  const expectedParameters = read ? [] : [{ name: "value", type: valueType }];
  if (helper === undefined || helper.selfParam?.kind !== "rc" || helper.isAsync === true ||
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
    ...(helper.errorType === undefined ? {} : { errorType: helper.errorType }),
  };
}

export function projectDowncastReturnType(
  route: RustProjectDowncastRoute,
  context: RustPlanContext,
): RustType | undefined {
  const dispatch = rustProjectDispatchTraitType(route.targetCarrier, context);
  return dispatch === undefined
    ? undefined
    : {
        kind: "named",
        path: "Option",
        genericArguments: [{
          kind: "type",
          type: {
            kind: "named",
            path: "std::rc::Rc",
            genericArguments: [{
              kind: "type",
              type: {
                kind: "trait-object",
                principal: { trait: dispatch },
                autoTraits: [],
              },
            }],
          },
        }],
      };
}

export function planProjectDowncastRouteImplementation(
  route: RustProjectDowncastRoute,
  matches: boolean,
  context: RustPlanContext,
): RustImplFunction | undefined {
  const returnType = projectDowncastReturnType(route, context);
  return returnType === undefined
    ? undefined
    : {
        name: route.slot,
        visibility: "private",
        generics: emptyRustGenerics,
        selfParam: rustSelfParameter("rc"),
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
      };
}

export function planRootMethodImplementation(
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

export function planRootAccessorImplementation(
  concreteCarrier: TargetTypeRef,
  accessor: Node,
  role: "read" | "write",
  context: RustPlanContext,
): RustImplFunction | undefined {
  const targetName = context.input.program.projectTypes.memberSlotName(accessor, role);
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

export function planRootAccessorForwarder(
  concreteCarrier: TargetTypeRef,
  contractAccessor: Node,
  implementation: Node,
  role: "read" | "write",
  slot: string,
  rootType: RustType,
  helper: RustImplFunction,
  contractShape: ProjectCallableShape,
  context: RustPlanContext,
): RustImplFunction | undefined {
  if (rustTypeEquals(helper.errorType, contractShape.errorType)) {
    return planRootCallableForwarder(
      implementation,
      slot,
      rootType,
      helper,
      contractShape,
      undefined,
      context,
    );
  }
  const fallibleBoundary = contractShape.errorType === undefined
    ? undefined
    : rustErrorBoundaryForProjectMember(contractAccessor, context);
  if (fallibleBoundary === undefined ||
    !rustTypeEquals(rustErrorType(fallibleBoundary), contractShape.errorType)) {
    return rejectRootContractErrorAbi(implementation, context);
  }
  const planned = planRootCallableImplementation(
    concreteCarrier,
    implementation,
    context,
    {
      targetName: slot,
      safetyPlacement: role === "read" ? "getter" : "setter",
      fallibleBoundary,
    },
  );
  return planned !== undefined && rootCallableMatchesShape(planned, contractShape)
    ? planned
    : rejectRootContractErrorAbi(implementation, context);
}

function planRootCallableImplementation(
  concreteCarrier: TargetTypeRef,
  implementation: Node,
  context: RustPlanContext,
  options: {
    readonly targetName: string;
    readonly safetyPlacement?: "getter" | "setter";
    readonly typeArgumentSubstitutions?: ReadonlyMap<string, TargetTypeRef>;
    readonly fallibleBoundary?: import("../../program/source-package-errors.js").RustSourcePackageErrorBoundary;
  },
): RustImplFunction | undefined {
  const owner = context.input.program.projectTypes.definitionContainingDeclaration(implementation);
  if (owner === undefined) {
    return undefined;
  }
  const ownerRelation = context.input.program.projectTypes.relationship(concreteCarrier, owner);
  if (ownerRelation.kind !== "related") {
    return undefined;
  }
  const syntheticNames = createRustSyntheticNameState(context.input.program.source.ast, implementation, []);
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
    lifetimeSubstitutions: projectLifetimeSubstitutions(owner, ownerRelation.targetType),
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
    ...(options.fallibleBoundary === undefined
      ? {}
      : { fallibleBoundary: options.fallibleBoundary }),
  });
  if (planned === undefined) {
    return undefined;
  }
  return {
    ...planned,
    name: options.targetName,
    visibility: "private",
    selfParam: rustSelfParameter("rc"),
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

export function planRootMethodForwarder(
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
  const contractOwner = context.input.program.projectTypes.definitionContainingDeclaration(contractMember);
  if (contractOwner === undefined) {
    return undefined;
  }
  const contractRelation = context.input.program.projectTypes.relationship(concreteCarrier, contractOwner);
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
        lifetimeSubstitutions: projectLifetimeSubstitutions(
          contractOwner,
          contractRelation.targetType,
        ),
      }, { methodTypeArgumentSubstitutions: specialization })
    : undefined;
  if (contractShape === undefined) {
    return undefined;
  }
  if (rustTypeEquals(helper.errorType, contractShape.errorType)) {
    return planRootCallableForwarder(
        implementation,
        slot,
        rootType,
        helper,
        contractShape,
        overrideStoragePath,
        context,
      );
  }
  const fallibleBoundary = contractShape.errorType === undefined
    ? undefined
    : rustErrorBoundaryForProjectMember(contractMember, context);
  if (fallibleBoundary === undefined ||
    !rustTypeEquals(rustErrorType(fallibleBoundary), contractShape.errorType)) {
    return rejectRootContractErrorAbi(implementation, context);
  }
  const direct = planRootCallableImplementation(
    concreteCarrier,
    implementation,
    context,
    {
      targetName: slot,
      typeArgumentSubstitutions: specialization!,
      fallibleBoundary,
    },
  );
  if (direct === undefined || !rootCallableMatchesShape(direct, contractShape)) {
    return rejectRootContractErrorAbi(implementation, context);
  }
  return applyRootMethodOverride(
    implementation,
    direct,
    overrideStoragePath,
    context,
  );
}

export function planRootCallableForwarder(
  implementation: Node,
  slot: string,
  rootType: RustType,
  helper: RustImplFunction,
  contractShape: ProjectCallableShape,
  overrideStoragePath: readonly string[] | undefined,
  context: RustPlanContext,
): RustImplFunction | undefined {
  const representation = context.input.program.objectRepresentations.representationFor(
    context.input.program.projectTypes.definitionContainingDeclaration(implementation),
  );
  if (representation === undefined || !rootCallableMatchesShape(helper, contractShape)) {
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
  return applyRootMethodOverride(
    implementation,
    {
    name: slot,
    visibility: "private",
    generics: helper.generics,
    selfParam: rustSelfParameter("rc"),
    params: helper.params,
    ...(helper.returnType === undefined ? {} : { returnType: helper.returnType }),
    ...(helper.errorType === undefined ? {} : { errorType: helper.errorType }),
    ...(helper.isUnsafe === true ? { isUnsafe: true } : {}),
    body: {
      statements: [{
        kind: "tail",
        expr: helper.isUnsafe === true
          ? { kind: "unsafe", expression: call }
          : call,
      }],
    },
    },
    overrideStoragePath,
    context,
  );
}

function rootCallableMatchesShape(
  callable: RustImplFunction,
  shape: ProjectCallableShape,
): boolean {
  return rustTypeEquals(callable.errorType, shape.errorType) &&
    (callable.isUnsafe === true) === shape.isUnsafe &&
    rustFunctionTypesMatch(
      callable.params,
      callable.returnType,
      shape.params,
      shape.returnType,
    );
}

function applyRootMethodOverride(
  implementation: Node,
  callable: RustImplFunction,
  overrideStoragePath: readonly string[] | undefined,
  context: RustPlanContext,
): RustImplFunction | undefined {
  if (overrideStoragePath === undefined) {
    return callable;
  }
  const representation = context.input.program.objectRepresentations.representationFor(
    context.input.program.projectTypes.definitionContainingDeclaration(implementation),
  );
  if (representation === undefined) {
    return undefined;
  }
  const overrideName = allocateRustLocalName(
    new Set(callable.params.map((parameter) => parameter.name)),
    "method_override",
  );
  return {
    ...callable,
    body: {
      ...callable.body,
      statements: [{
        kind: "if-let-some",
        binding: overrideName,
        expression: readRustProjectMethodOverride(
          { kind: "path", path: "self" },
          overrideStoragePath,
          representation,
        ),
        body: {
          statements: [{
            kind: "return",
            expr: {
              kind: "method-call",
              receiver: { kind: "path", path: overrideName },
              method: "call",
              args: [{
                kind: "tuple-literal",
                elements: callable.params.map((parameter) => ({
                  kind: "path" as const,
                  path: parameter.name,
                })),
              }],
            },
          }],
        },
      }, ...callable.body.statements],
    },
  };
}

function rejectRootContractErrorAbi(
  implementation: Node,
  context: RustPlanContext,
): undefined {
  context.diagnostics.push(missingFactDiagnostic(
    diagnosticInput(context, implementation),
    "rust.backend.project-dispatch-error-abi",
    "Selected project member implementation cannot be planned under the exact contract-owned Rust error ABI.",
  ));
  return undefined;
}

export function projectAccessorCallableShape(
  definition: RustProjectTypeDefinition,
  carrier: TargetTypeRef,
  declaration: Node,
  role: "read" | "write",
  context: RustPlanContext,
): ProjectCallableShape | undefined {
  const shape = projectCallableShape(
    declaration,
    {
      ...context,
      typeParameterSubstitutions: projectTypeSubstitutions(definition, carrier),
      lifetimeSubstitutions: projectLifetimeSubstitutions(definition, carrier),
    },
    { safetyPlacement: role === "read" ? "getter" : "setter" },
  );
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
    const kind = context.input.program.source.ast.kindName(node);
    if (kind === "KindThisExpression" || kind === "KindThisKeyword") {
      const selected = context.input.program.facts.getRuntimeCarrierFact(node)?.carrier;
      const selectedDefinition = context.input.program.projectTypes.definitionForCarrier(selected);
      const ownerDefinition = context.input.program.projectTypes.definitionForCarrier(ownerCarrier);
      if (selectedDefinition === ownerDefinition) {
        overrides.set(node, {
          carrier: ownerCarrier,
          valueForm: "value",
          expression: cloneExpression({ kind: "path", path: bindingName }),
        });
      }
      return;
    }
    context.input.program.source.ast.forEachChild(node, (child) => {
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
