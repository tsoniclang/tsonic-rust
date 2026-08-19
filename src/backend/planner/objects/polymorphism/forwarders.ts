import {
  cloneExpression,
  cloneField,
  projectCallableShape,
  projectTypeSubstitutions,
  rustFunctionTypesMatch,
} from "./model.js";
import { allocateRustSyntheticName, createRustSyntheticNameState } from "../../names/synthetic.js";
import { diagnosticInput, sourceTypePath } from "../../program/plan-context.js";
import { missingFactDiagnostic } from "../../diagnostics.js";
import { planProjectMethod } from "../../declarations/nominal.js";
import { readRustProjectMethodOverride, rustProjectObjectDispatchField, rustProjectObjectIdentityField } from "../project-objects.js";
import { rustCallableSpecialization } from "../../declarations/callable-generics.js";
import { rustProjectDispatchTraitType } from "./names.js";
import { rustSourceTypeCarrierValue } from "../../../../policy/types/target-types.js";
import type { Node } from "@tsonic/tsts";
import type { RustEffectiveExpressionOverride, RustPlanContext } from "../../program/plan-context.js";
import type { RustExpr, RustImplFunction, RustType } from "../../../rust-ast/nodes.js";
import type { RustProjectDowncastRoute, RustProjectTypeDefinition } from "../../../../analysis/project-types/type-policy.js";
import type { RustProjectMethodDispatchVariant } from "../../../../analysis/project-types/method-dispatch.js";
import type { TargetTypeRef } from "../../../../policy/types/model.js";
import type { ProjectCallableShape } from "./model.js";

export function planProjectFieldAccessorCall(
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
        typeArguments: [{
          kind: "named",
          path: "std::rc::Rc",
          typeArguments: [{ kind: "trait-object", trait: dispatch }],
        }],
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

export function planRootCallableForwarder(
  implementation: Node,
  slot: string,
  rootType: RustType,
  helper: RustImplFunction,
  contractShape: ProjectCallableShape,
  overrideStoragePath: readonly string[] | undefined,
  context: RustPlanContext,
): RustImplFunction | undefined {
  const representation = context.input.objectRepresentations.representationFor(
    context.input.projectTypes.definitionContainingDeclaration(implementation),
  );
  if (
    representation === undefined ||
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
                representation,
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

export function projectAccessorCallableShape(
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
