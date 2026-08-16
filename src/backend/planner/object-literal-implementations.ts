import type { Node, SourceFile } from "@tsonic/tsts";
import type { TargetTypeRef } from "../../policy/types.js";
import { rustTargetOperationFactKey } from "../../source/rust-facts/keys.js";
import { rustTargetTypeRefEquals } from "../../policy/equality.js";
import type {
  RustProjectMethodDispatchVariant,
} from "../../source/rust-target-semantics/project-method-dispatch.js";
import {
  rustProjectInterfaceContracts,
} from "../../source/rust-target-semantics/project-type-policy.js";
import { rustSourceTypeCarrierValue } from "../../source/rust-target-types.js";
import type {
  RustExpr,
  RustFunctionParam,
  RustImplFunction,
  RustItem,
  RustStructField,
  RustType,
} from "../rust-ast/nodes.js";
import { rustLintAttributes } from "../rust-ast/lint-policy.js";
import {
  readRustProjectObjectField,
  rustProjectObjectDispatchField,
  rustProjectObjectIdentityField,
  rustProjectObjectStateField,
  writeRustProjectObjectField,
} from "./project-objects.js";
import {
  projectCallableShape,
  projectOwnFields,
  projectOwnMethods,
  projectTypeSubstitutions,
} from "./project-polymorphism-model.js";
import {
  rustProjectDispatchTraitType,
} from "./project-polymorphism-names.js";
import { rustTypeFromCarrierInContext } from "./render-types.js";
import type { RustPlanContext } from "./plan-context.js";
import {
  allocateRustSyntheticTypeName,
  type RustSyntheticNameState,
} from "./synthetic-names.js";

export interface RustObjectLiteralMethodImplementationPlan {
  readonly sourceMethod: Node;
  readonly contractMethod: Node;
  readonly variant: RustProjectMethodDispatchVariant;
  readonly fieldName: string;
  readonly callableType: RustType;
  readonly parameters: readonly RustFunctionParam[];
  readonly typeParameterSubstitutions: readonly (readonly [string, TargetTypeRef])[];
  readonly returnType?: RustType;
  readonly fallible: boolean;
  readonly isUnsafe: boolean;
}

export interface RustObjectLiteralImplementationPlan {
  readonly expression: Node;
  readonly resultCarrier: TargetTypeRef;
  readonly wrapperType: RustType;
  readonly rootName: string;
  readonly stateName: string;
  readonly stateFields: readonly {
    readonly declaration: Node;
    readonly storageIndex: number;
    readonly targetName: string;
    readonly type: RustType;
  }[];
  readonly methods: readonly RustObjectLiteralMethodImplementationPlan[];
  readonly items: readonly RustItem[];
}

export interface RustObjectLiteralImplementationRegistry {
  readonly items: readonly RustItem[];
  forExpression(expression: Node): RustObjectLiteralImplementationPlan | undefined;
}

export function createRustObjectLiteralImplementationRegistry(
  sourceFile: SourceFile,
  context: RustPlanContext,
  names: RustSyntheticNameState,
): RustObjectLiteralImplementationRegistry {
  const plans = new Map<Node, RustObjectLiteralImplementationPlan>();
  const items: RustItem[] = [];
  const visit = (node: Node): void => {
    const fact = context.input.facts.getFact(node, rustTargetOperationFactKey);
    if (fact?.kind === "record-literal" &&
      fact.contributions.some((contribution) => contribution.kind === "method")) {
      const plan = createImplementationPlan(node, fact, context, names);
      if (plan !== undefined) {
        plans.set(node, plan);
        items.push(...plan.items);
      }
    }
    context.input.ast.forEachChild(node, (child) => {
      if (child !== undefined) {
        visit(child);
      }
    });
  };
  visit(sourceFile);
  return Object.freeze({
    items: Object.freeze(items),
    forExpression(expression: Node) {
      return plans.get(expression);
    },
  });
}

function createImplementationPlan(
  expression: Node,
  fact: Extract<
    import("../../source/rust-facts/keys.js").RustTargetOperationFact,
    { readonly kind: "record-literal" }
  >,
  context: RustPlanContext,
  names: RustSyntheticNameState,
): RustObjectLiteralImplementationPlan | undefined {
  const definition = context.input.projectTypes.definitionForCarrier(fact.resultCarrier);
  const sourceValue = rustSourceTypeCarrierValue(fact.resultCarrier);
  const wrapperType = rustTypeFromCarrierInContext(fact.resultCarrier, context);
  if (definition?.kind !== "interface" || sourceValue === undefined || wrapperType === undefined) {
    return undefined;
  }
  const contracts = rustProjectInterfaceContracts(
    context.input.projectTypes,
    definition,
    fact.resultCarrier,
  );
  if (contracts === undefined) {
    return undefined;
  }
  const rootName = allocateRustSyntheticTypeName(names, `${definition.targetName}ObjectLiteralRoot`);
  const stateName = allocateRustSyntheticTypeName(names, `${definition.targetName}ObjectLiteralState`);
  const stateFieldNames = new Set<string>();
  const stateFields = fact.fields.map((field) => {
    const declaration = field.declaration;
    const type = rustTypeFromCarrierInContext(field.carrier, context);
    const owner = context.input.projectTypes.definitionContainingDeclaration(declaration);
    const preferred = declaration === undefined || owner === undefined
      ? undefined
      : context.input.projectTypes.fieldStorageName(owner, declaration);
    const targetName = preferred === undefined
      ? undefined
      : allocateMemberFieldName(stateFieldNames, preferred);
    return declaration === undefined || type === undefined || targetName === undefined
      ? undefined
      : {
          declaration,
          storageIndex: field.storageIndex,
          targetName,
          type,
        };
  });
  if (stateFields.some((field) => field === undefined)) {
    return undefined;
  }
  const methodFieldNames = new Set<string>();
  const methods: RustObjectLiteralMethodImplementationPlan[] = [];
  for (const contribution of fact.contributions) {
    if (contribution.kind !== "method") {
      continue;
    }
    for (const contractMethod of contribution.sourceSelectedDeclarations) {
      const owner = context.input.projectTypes.definitionContainingDeclaration(contractMethod);
      const ownerRelation = owner === undefined
        ? undefined
        : context.input.projectTypes.relationship(fact.resultCarrier, owner);
      if (owner === undefined || ownerRelation?.kind !== "related") {
        return undefined;
      }
      for (const variant of context.input.projectMethodDispatch.variantsForMember(contractMethod)) {
        const substitutions = new Map(projectTypeSubstitutions(owner, ownerRelation.targetType));
        variant.sourceTypeParameterNames.forEach((name, index) => {
          const target = variant.targetTypeArguments[index];
          if (target !== undefined) {
            substitutions.set(name, target);
          }
        });
        const shape = projectCallableShape(
          contractMethod,
          { ...context, typeParameterSubstitutions: substitutions },
          new Map(variant.sourceTypeParameterNames.map((name, index) =>
            [name, variant.targetTypeArguments[index]!] as const)),
        );
        const resultType = shape?.returnType ?? { kind: "unit" as const };
        const callableResultType = shape?.fallible === true
          ? {
              kind: "named" as const,
              path: "rt::TsonicResult",
              typeArguments: [resultType],
            }
          : resultType;
        const fieldName = shape === undefined
          ? undefined
          : allocateMemberFieldName(methodFieldNames, `${variant.virtualSlot}_implementation`);
        if (shape === undefined || fieldName === undefined) {
          return undefined;
        }
        methods.push({
          sourceMethod: contribution.property,
          contractMethod,
          variant,
          fieldName,
          callableType: {
            kind: "named",
            path: "rt::Callable",
            typeArguments: [{
              kind: "tuple",
              elements: [wrapperType, ...shape.params.map((parameter) => parameter.type)],
            }, callableResultType],
          },
          parameters: shape.params,
          typeParameterSubstitutions: Object.freeze(
            [...substitutions].map(([name, target]) =>
              Object.freeze([name, target] as const)),
          ),
          ...(shape.returnType === undefined ? {} : { returnType: shape.returnType }),
          fallible: shape.fallible,
          isUnsafe: shape.isUnsafe,
        });
      }
    }
  }
  const requiredMethods = contracts.flatMap((contract) =>
    projectOwnMethods(contract.definition, context)
      .filter((method) => !context.input.ast.hasModifierKind(method, "static"))
      .flatMap((method) => context.input.projectMethodDispatch.variantsForMember(method)
        .map((variant) => ({ method, variant }))));
  if (requiredMethods.some((required) => !methods.some((method) =>
    method.contractMethod === required.method &&
    method.variant.virtualSlot === required.variant.virtualSlot))) {
    return undefined;
  }
  const finalizedStateFields = stateFields as NonNullable<(typeof stateFields)[number]>[];
  const rootType: RustType = { kind: "named", path: rootName };
  const stateType: RustType = { kind: "named", path: stateName };
  const traitItems = contracts.map((contract) =>
    planContractImplementation(
      contract,
      fact.resultCarrier,
      rootType,
      wrapperType,
      finalizedStateFields,
      methods,
      context,
    ));
  if (traitItems.some((item) => item === undefined)) {
    return undefined;
  }
  context.usedAliases?.add("rt");
  const stateItem: RustItem = {
    kind: "struct",
    name: stateName,
    visibility: "private",
    attrs: [rustLintAttributes.deadCode],
    derives: [],
    fields: finalizedStateFields.map((field): RustStructField => ({
      name: field.targetName,
      type: field.type,
      visibility: "private",
    })),
  };
  const rootItem: RustItem = {
    kind: "struct",
    name: rootName,
    visibility: "private",
    attrs: [rustLintAttributes.deadCode],
    derives: [],
    fields: [{
      name: rustProjectObjectIdentityField,
      type: { kind: "named", path: "rt::ObjectIdentity" },
      visibility: "private",
    }, {
      name: rustProjectObjectStateField,
      type: {
        kind: "named",
        path: "rt::ObjectHandle",
        typeArguments: [stateType],
      },
      visibility: "private",
    }, ...methods.map((method): RustStructField => ({
      name: method.fieldName,
      type: method.callableType,
      visibility: "private",
    }))],
  };
  return Object.freeze({
    expression,
    resultCarrier: fact.resultCarrier,
    wrapperType,
    rootName,
    stateName,
    stateFields: Object.freeze(finalizedStateFields),
    methods: Object.freeze(methods),
    items: Object.freeze([stateItem, rootItem, ...(traitItems as RustItem[])]),
  });
}

function planContractImplementation(
  contract: import("../../source/rust-target-semantics/project-type-policy.js").RustProjectInterfaceContract,
  resultCarrier: TargetTypeRef,
  rootType: RustType,
  wrapperType: RustType,
  stateFields: readonly RustObjectLiteralImplementationPlan["stateFields"][number][],
  methods: readonly RustObjectLiteralMethodImplementationPlan[],
  context: RustPlanContext,
): RustItem | undefined {
  const trait = rustProjectDispatchTraitType(contract.carrier, context);
  const fields = projectOwnFields(contract.definition, contract.carrier, context);
  if (trait === undefined || fields === undefined) {
    return undefined;
  }
  const functions: RustImplFunction[] = [];
  for (const route of context.input.projectTypes.downcastRoutesFor(contract.definition)) {
    const routeTrait = rustProjectDispatchTraitType(route.targetCarrier, context);
    if (routeTrait === undefined) {
      return undefined;
    }
    const relation = context.input.projectTypes.relationship(resultCarrier, route.target);
    const matches = relation.kind === "related" &&
      rustTargetTypeRefEquals(relation.targetType, route.targetCarrier);
    functions.push({
      name: route.slot,
      visibility: "private",
      selfParam: "rc",
      params: [],
      returnType: {
        kind: "named",
        path: "Option",
        typeArguments: [{
          kind: "named",
          path: "std::rc::Rc",
          typeArguments: [{ kind: "trait-object", trait: routeTrait }],
        }],
      },
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
  for (const field of fields) {
    const stateField = stateFields.find((candidate) => candidate.declaration === field.declaration);
    const read = context.input.projectTypes.memberSlotName(field.declaration, "read");
    const write = context.input.projectTypes.memberSlotName(field.declaration, "write");
    if (stateField === undefined || read === undefined || write === undefined) {
      return undefined;
    }
    functions.push({
      name: read,
      visibility: "private",
      selfParam: "ref",
      params: [],
      returnType: field.type,
      body: {
        statements: [{
          kind: "tail",
          expr: readRustProjectObjectField(
            { kind: "path", path: "self" },
            stateField.targetName,
            field.carrier,
          ),
        }],
      },
    }, {
      name: write,
      visibility: "private",
      selfParam: "ref",
      params: [{ name: "value", type: field.type }],
      body: {
        statements: [{
          kind: "expr",
          expr: writeRustProjectObjectField(
            { kind: "path", path: "self" },
            stateField.targetName,
            "=",
            { kind: "path", path: "value" },
          ),
        }],
      },
    });
  }
  for (const contractMethod of projectOwnMethods(contract.definition, context)) {
    if (context.input.ast.hasModifierKind(contractMethod, "static")) {
      continue;
    }
    for (const variant of context.input.projectMethodDispatch.variantsForMember(contractMethod)) {
      const method = methods.find((candidate) =>
        candidate.contractMethod === contractMethod &&
        candidate.variant.virtualSlot === variant.virtualSlot);
      if (method === undefined) {
        return undefined;
      }
      if (wrapperType.kind !== "named") {
        return undefined;
      }
      const receiver: RustExpr = {
        kind: "struct-literal",
        path: wrapperType.path,
        fields: [{
          name: rustProjectObjectIdentityField,
          value: {
            kind: "method-call",
            receiver: {
              kind: "field",
              receiver: { kind: "path", path: "self" },
              name: rustProjectObjectIdentityField,
            },
            method: "clone",
            args: [],
          },
        }, {
          name: rustProjectObjectDispatchField,
          value: {
            kind: "method-call",
            receiver: { kind: "path", path: "self" },
            method: "clone",
            args: [],
          },
        }],
      };
      const implementationName = allocateMemberFieldName(
        new Set(method.parameters.map((parameter) => parameter.name)),
        "implementation",
      );
      functions.push({
        name: variant.virtualSlot,
        visibility: "private",
        selfParam: "rc",
        params: method.parameters,
        ...(method.returnType === undefined ? {} : { returnType: method.returnType }),
        ...(method.fallible ? { fallible: true } : {}),
        ...(method.isUnsafe ? { isUnsafe: true } : {}),
        body: {
          statements: [{
            kind: "let",
            name: implementationName,
            mutable: false,
            init: {
              kind: "method-call",
              receiver: {
                kind: "field",
                receiver: { kind: "path", path: "self" },
                name: method.fieldName,
              },
              method: "clone",
              args: [],
            },
          }, {
            kind: "tail",
            expr: {
              kind: "method-call",
              receiver: { kind: "path", path: implementationName },
              method: "call",
              args: [{
                kind: "tuple-literal",
                elements: [
                  receiver,
                  ...method.parameters.map((parameter) => ({
                    kind: "path" as const,
                    path: parameter.name,
                  })),
                ],
              }],
            },
          }],
        },
      });
    }
  }
  return {
    kind: "impl",
    trait,
    target: rootType,
    functions,
  };
}

function allocateMemberFieldName(used: Set<string>, preferred: string): string {
  let suffix = 1;
  for (;;) {
    const candidate = suffix === 1 ? preferred : `${preferred}_${suffix}`;
    suffix += 1;
    if (!used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
  }
}
