import {
  cloneField,
  projectCallableShape,
  rustFunctionTypesMatch,
  projectLifetimeSubstitutions,
  projectTypeSubstitutions,
} from "./model.js";
import { cloneRustExpression as cloneExpression } from "../../../target-ast/syntax/expressions.js";
import { allocateRustSyntheticName, createRustSyntheticNameState } from "../../names/synthetic.js";
import { rustErrorBoundaryForProjectMember } from "../../program/plan-context.js";
import { rustErrorType } from "../../program/fallible-boundaries.js";
import { failRustPlannerInvariant } from "../../diagnostics.js";
import { rustTypeFromCarrierInContext } from "../../types/render.js";
import { rustTypeEquals } from "../../../target-ast/syntax/type-equality.js";
import { planProjectMethod } from "../../declarations/index.js";
import { readRustProjectMethodOverride, rustProjectObjectDispatchField, rustProjectObjectIdentityField } from "../project-objects.js";
import { rustCallableSpecialization } from "../../declarations/callables/generics.js";
import { rustProjectDispatchObjectType, rustProjectDispatchTraitType } from "./names.js";
import { emptyRustGenerics } from "../../../target-ast/syntax/nodes.js";
import { rustSelfParameter } from "../../declarations/callables/self-parameter.js";
import { planRootCallableForwarder } from "./callable-adapters.js";
import type { Node } from "@tsonic/tsts";
import type { RustEffectiveExpressionOverride, RustPlanContext } from "../../program/plan-context.js";
import type { RustExpr, RustImplFunction, RustType } from "../../../target-ast/syntax/nodes.js";
import type { RustProjectTypeDefinition, RustProjectDowncastRoute } from "../../../../target-model/types/project-types.js";
import type { RustProjectMethodDispatchVariant } from "../../../../target-model/records/operations/method-dispatch.js";
import type { TargetTypeRef } from "../../../../target-model/types/model.js";
import type { ProjectCallableShape } from "./model.js";

export function planProjectFieldAccessorCall(
  rootType: RustType,
  helper: RustImplFunction | undefined,
  value: RustExpr | undefined,
): { readonly expression: RustExpr; readonly errorType?: RustType } | undefined {
  const read = value === undefined;
  if (helper === undefined) failRustPlannerInvariant("An admitted native field accessor requires its exact helper.");
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
  const dispatchObject = rustProjectDispatchObjectType(route.targetCarrier, context);
  return dispatchObject === undefined
    ? failRustPlannerInvariant("An admitted project downcast requires its exact native dispatch type.", route.target.declaration)
    : {
        kind: "named",
        path: "Option",
        genericArguments: [{
          kind: "type",
          type: {
            kind: "named",
            path: "alloc::rc::Rc",
            genericArguments: [{
              kind: "type",
              type: dispatchObject,
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
    ? failRustPlannerInvariant("An admitted project downcast requires its finalized native result type.", route.target.declaration)
    : {
        kind: "function",
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
  return planRootCallableImplementation(
    concreteCarrier,
    implementation,
    context,
    { targetName: variant.exactSlot, headerVariant: variant },
  );
}

export function planRootAccessorImplementation(
  concreteCarrier: TargetTypeRef,
  accessor: Node,
  role: "read" | "write",
  context: RustPlanContext,
): RustImplFunction | undefined {
  const targetName = context.input.program.records.projectMemberSlot.get(accessor, role);
  return targetName === undefined
    ? failRustPlannerInvariant("An admitted root accessor requires its exact native slot.", accessor)
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
  const forwarding = context.input.program.records.projectForwarder.get(contractAccessor, implementation);
  if (forwarding === undefined) failRustPlannerInvariant("An admitted native accessor requires its sealed error-forwarding mode.", implementation);
  if (forwarding === "adapter") {
    return planRootCallableForwarder(
      concreteCarrier,
      contractAccessor,
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
    return rejectRootContractErrorAbi(implementation);
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
  if (planned === undefined || !rootCallableMatchesShape(planned, contractShape)) return rejectRootContractErrorAbi(implementation);
  return planned;
}

function planRootCallableImplementation(
  concreteCarrier: TargetTypeRef,
  implementation: Node,
  context: RustPlanContext,
  options: {
    readonly targetName: string;
    readonly safetyPlacement?: "getter" | "setter";
    readonly headerVariant?: RustProjectMethodDispatchVariant;
    readonly fallibleBoundary?: import("../../../../target-model/records/errors/source-package-errors.js").RustSourcePackageErrorBoundary;
  },
): RustImplFunction | undefined {
  const owner = context.input.program.records.projectMemberOwner.get(implementation);
  if (owner === undefined) {
    failRustPlannerInvariant("An admitted native root forwarder requires its sealed owner, specialization and callable plan.", context.sourceFile);
  }
  const ownerCarrier = context.input.program.records.projectRelationship.get(concreteCarrier, owner);
  if (ownerCarrier === undefined) {
    failRustPlannerInvariant("An admitted native root forwarder requires its sealed owner, specialization and callable plan.", context.sourceFile);
  }
  const syntheticNames = createRustSyntheticNameState(context.input.program.source.ast, implementation, []);
  const thisBindingName = allocateRustSyntheticName(syntheticNames, "project_this");
  const thisPlan = projectThisOverrides(
    implementation,
    owner.declaration,
    ownerCarrier,
    thisBindingName,
    context,
  );
  if (thisPlan === undefined) failRustPlannerInvariant("An admitted native root forwarder requires its sealed owner, specialization and callable plan.", context.sourceFile);
  const planned = planProjectMethod(implementation, {
    ...context,
    syntheticNames,
    typeParameterSubstitutions: projectTypeSubstitutions(owner, ownerCarrier, context),
    lifetimeSubstitutions: projectLifetimeSubstitutions(owner, ownerCarrier, context),
    expressionOverrides: thisPlan.overrides,
    projectDispatchRoot: { kind: "path", path: "self" },
  }, {
    targetName: options.targetName,
    ...(options.safetyPlacement === undefined
      ? {}
      : { safetyPlacement: options.safetyPlacement }),
    ...(options.headerVariant === undefined
      ? {}
      : { headerVariant: options.headerVariant }),
    ...(options.fallibleBoundary === undefined
      ? {}
      : { fallibleBoundary: options.fallibleBoundary }),
  });
  if (planned === undefined) {
    failRustPlannerInvariant("An admitted native root forwarder requires its sealed owner, specialization and callable plan.", context.sourceFile);
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
  const contractOwner = context.input.program.records.projectMemberOwner.get(contractMember);
  if (contractOwner === undefined) {
    failRustPlannerInvariant("An admitted native root forwarder requires its sealed owner, specialization and callable plan.", context.sourceFile);
  }
  const contractCarrier = context.input.program.records.projectRelationship.get(concreteCarrier, contractOwner);
  const targetTypeArguments = context.input.program.records.projectMethodArguments.get(contractMember, variant.targetTypeArguments, concreteCarrier);
  if (targetTypeArguments === undefined) failRustPlannerInvariant("An admitted native root forwarder requires its sealed owner, specialization and callable plan.", context.sourceFile);
  const specialization = rustCallableSpecialization(
    variant.sourceTypeParameterIdentities,
    targetTypeArguments,
  );
  const contractShape = contractCarrier !== undefined && specialization !== undefined
    ? projectCallableShape(contractMember, {
        ...context,
        typeParameterSubstitutions: projectTypeSubstitutions(contractOwner, contractCarrier, context),
        lifetimeSubstitutions: projectLifetimeSubstitutions(contractOwner, contractCarrier, context),
      }, { methodTypeArgumentSubstitutions: specialization })
    : undefined;
  if (contractShape === undefined) {
    failRustPlannerInvariant("An admitted native root forwarder requires its sealed owner, specialization and callable plan.", context.sourceFile);
  }
  const forwarding = context.input.program.records.projectForwarder.get(contractMember, implementation);
  if (forwarding === undefined) failRustPlannerInvariant("An admitted native method requires its sealed error-forwarding mode.", implementation);
  if (forwarding === "adapter") {
    return planRootCallableForwarder(
        concreteCarrier,
        contractMember,
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
    return rejectRootContractErrorAbi(implementation);
  }
  const direct = planRootCallableImplementation(
    concreteCarrier,
    implementation,
    context,
    {
      targetName: slot,
      headerVariant: variant,
      fallibleBoundary,
    },
  );
  if (direct === undefined || !rootCallableMatchesShape(direct, contractShape)) {
    return rejectRootContractErrorAbi(implementation);
  }
  return applyRootMethodOverride(
    implementation,
    direct,
    overrideStoragePath,
    context,
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
  const representation = context.input.program.records.objectRepresentation.get(context.input.program.records.projectMemberOwner.get(implementation));
  if (representation === undefined) {
    failRustPlannerInvariant("An admitted native root forwarder requires its sealed owner, specialization and callable plan.", context.sourceFile);
  }
  const overrideName = allocateRustLocalName(
    new Set(callable.params.map((parameter) => parameter.name)),
    "method_override",
  );
  return {
    ...callable,
    body: {
      ...callable.body,
      statements: [{ kind: "expr", expr: { kind: "if-let", pattern: { kind: "tuple-variant", path: "Some", elements: [{ kind: "binding", name: overrideName }] }, expression: readRustProjectMethodOverride(
          { kind: "path", path: "self" },
          overrideStoragePath,
          representation,
        ), whenTrue: { kind: "block", body: {
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
        } } } }, ...callable.body.statements],
    },
  };
}

// A directly emitted root implementation must have the contract's exact native ABI: error type, safety, parameter
// and return types. A mismatch would print a trait implementation that does not match its trait.
function rootCallableMatchesShape(callable: RustImplFunction, shape: ProjectCallableShape): boolean {
  return rustTypeEquals(callable.errorType, shape.errorType) && (callable.isUnsafe === true) === shape.isUnsafe &&
    rustFunctionTypesMatch(callable.params, callable.returnType, shape.params, shape.returnType);
}

function rejectRootContractErrorAbi(implementation: Node): never {
  return failRustPlannerInvariant("An admitted project member requires its exact contract-owned native error ABI.", implementation);
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
      typeParameterSubstitutions: projectTypeSubstitutions(definition, carrier, context),
      lifetimeSubstitutions: projectLifetimeSubstitutions(definition, carrier, context),
    },
    { safetyPlacement: role === "read" ? "getter" : "setter" },
  );
  if (shape === undefined || shape.params.length !== (role === "read" ? 0 : 1)) {
    failRustPlannerInvariant("An admitted project accessor requires its exact getter or setter native ABI.", declaration);
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
  ownerDeclaration: Node,
  ownerCarrier: TargetTypeRef,
  bindingName: string,
  context: RustPlanContext,
): {
  readonly overrides: ReadonlyMap<Node, RustEffectiveExpressionOverride>;
  readonly binding?: RustExpr;
} | undefined {
  const overrides = new Map<Node, RustEffectiveExpressionOverride>();
  const wrapper = rustTypeFromCarrierInContext(ownerCarrier, context);
  const wrapperPath = wrapper?.kind === "named" ? wrapper.path : undefined;
  const dispatchType = rustProjectDispatchTraitType(ownerCarrier, context);
  if (wrapperPath === undefined || dispatchType === undefined) {
    failRustPlannerInvariant("An admitted native receiver requires its exact wrapper and dispatch types.", method);
  }
  const references = context.input.program.records.projectThisReferences.get(method);
  if (references === undefined) failRustPlannerInvariant("An admitted native root forwarder requires its sealed owner, specialization and callable plan.", context.sourceFile);
  for (const node of references.get(ownerDeclaration) ?? []) {
    overrides.set(node, {
      carrier: ownerCarrier,
      valueForm: "storage",
      storageForm: "plain",
      expression: { kind: "path", path: bindingName },
    });
  }
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
