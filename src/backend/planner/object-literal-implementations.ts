import type { Node, SourceFile } from "@tsonic/tsts";
import type { TargetTypeRef } from "../../policy/types.js";
import {
  rustFallibleFactKey,
  rustObjectLiteralMethodAdapterFactKey,
  rustTargetOperationFactKey,
} from "../../source/rust-facts/keys.js";
import type {
  RustObjectLiteralMethodParameterAbi,
  RustObjectLiteralMethodParameterAdapter,
  RustObjectLiteralValueAdapter,
} from "../../source/rust-facts/keys.js";
import { rustTargetTypeRefEquals } from "../../policy/equality.js";
import type {
  RustProjectMethodDispatchVariant,
} from "../../source/rust-target-semantics/project-method-dispatch.js";
import {
  rustProjectInterfaceContracts,
} from "../../source/rust-target-semantics/project-type-policy.js";
import {
  rustSourceTypeCarrierValue,
} from "../../source/rust-target-types.js";
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
import {
  applyRustObjectLiteralValueAdapter,
  planRustObjectLiteralMethodArguments,
} from "./object-literal-method-adapters.js";

export interface RustObjectLiteralMethodImplementationPlan {
  readonly sourceCallable: Node;
  readonly fieldName: string;
  readonly callableType: RustType;
  readonly parameterCount: number;
  readonly typeParameterSubstitutions: readonly (readonly [string, TargetTypeRef])[];
  readonly fallible: boolean;
}

export interface RustObjectLiteralMethodDispatchPlan {
  readonly contractMethod: Node;
  readonly variant: RustProjectMethodDispatchVariant;
  readonly implementation: RustObjectLiteralMethodImplementationPlan;
  readonly parameters: readonly RustFunctionParam[];
  readonly parameterAbis: readonly RustObjectLiteralMethodParameterAbi[];
  readonly parameterAdapters: readonly RustObjectLiteralMethodParameterAdapter[];
  readonly resultAdapter: RustObjectLiteralValueAdapter;
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
    readonly implementationDeclaration: Node;
    readonly contractDeclarations: readonly Node[];
    readonly storageIndex: number;
    readonly targetName: string;
    readonly type: RustType;
  }[];
  readonly implementations: readonly RustObjectLiteralMethodImplementationPlan[];
  readonly methods: readonly RustObjectLiteralMethodDispatchPlan[];
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
  const adapterFact = context.input.facts.getFact(
    expression,
    rustObjectLiteralMethodAdapterFactKey,
  );
  if (adapterFact === undefined) {
    return undefined;
  }
  const rootName = allocateRustSyntheticTypeName(names, `${definition.targetName}ObjectLiteralRoot`);
  const stateName = allocateRustSyntheticTypeName(names, `${definition.targetName}ObjectLiteralState`);
  const stateFieldNames = new Set<string>();
  const stateFields = fact.fields.map((field) => {
    const declaration = field.implementationDeclaration;
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
          implementationDeclaration: declaration,
          contractDeclarations: field.contractDeclarations,
          storageIndex: field.storageIndex,
          targetName,
          type,
        };
  });
  if (stateFields.some((field) => field === undefined)) {
    return undefined;
  }
  const methodFieldNames = new Set<string>();
  const implementations: RustObjectLiteralMethodImplementationPlan[] = [];
  for (const implementation of adapterFact.implementations) {
    const parameterTypes = implementation.parameters.map((parameter) =>
      rustTypeFromCarrierInContext(parameter.parameterCarrier, context));
    const resultType = rustTypeFromCarrierInContext(implementation.returnCarrier, context);
    if (parameterTypes.some((type) => type === undefined) || resultType === undefined) {
      return undefined;
    }
    const fallible = context.input.facts.getFact(
      implementation.sourceCallable,
      rustFallibleFactKey,
    ) !== undefined;
    const callableResultType: RustType = fallible
      ? {
          kind: "named",
          path: "rt::TsonicResult",
          typeArguments: [resultType],
        }
      : resultType;
    implementations.push({
      sourceCallable: implementation.sourceCallable,
      fieldName: allocateMemberFieldName(methodFieldNames, "method_implementation"),
      callableType: {
        kind: "named",
        path: "rt::Callable",
        typeArguments: [{
          kind: "tuple",
          elements: [wrapperType, ...(parameterTypes as RustType[])],
        }, callableResultType],
      },
      parameterCount: implementation.parameters.length,
      typeParameterSubstitutions: implementation.typeParameterSubstitutions,
      fallible,
    });
  }
  const methods: RustObjectLiteralMethodDispatchPlan[] = [];
  for (const dispatch of adapterFact.dispatches) {
    const owner = context.input.projectTypes.definitionContainingDeclaration(dispatch.contractMethod);
    const ownerRelation = owner === undefined
      ? undefined
      : context.input.projectTypes.relationship(fact.resultCarrier, owner);
    const variant = context.input.projectMethodDispatch
      .variantsForMember(dispatch.contractMethod)
      .find((candidate) => candidate.virtualSlot === dispatch.virtualSlot);
    const implementation = implementations[dispatch.implementationIndex];
    if (owner === undefined || ownerRelation?.kind !== "related" ||
      variant === undefined || implementation === undefined) {
      return undefined;
    }
    const substitutions = new Map(projectTypeSubstitutions(owner, ownerRelation.targetType));
    variant.sourceTypeParameterNames.forEach((name, index) => {
      const target = variant.targetTypeArguments[index];
      if (target !== undefined) {
        substitutions.set(name, target);
      }
    });
    const shape = projectCallableShape(
      dispatch.contractMethod,
      { ...context, typeParameterSubstitutions: substitutions },
      new Map(variant.sourceTypeParameterNames.map((name, index) =>
        [name, variant.targetTypeArguments[index]!] as const)),
    );
    if (shape === undefined || shape.params.length !== dispatch.parameters.length ||
      dispatch.parameterAdapters.length !== implementation.parameterCount ||
      shape.fallible !== (implementation.fallible || dispatch.adapterFallible)) {
      return undefined;
    }
    const usedContractParameters = new Set(dispatch.parameterAdapters.flatMap((adapter) => {
      switch (adapter.kind) {
        case "runtime-value":
        case "logical-value":
        case "sequence-rest":
          return [adapter.contractParameterIndex];
        case "fixed-rest":
          return adapter.contractParameterIndexes;
        case "omitted":
          return [];
      }
    }));
    methods.push({
      contractMethod: dispatch.contractMethod,
      variant,
      implementation,
      parameters: shape.params.map((parameter, index) => usedContractParameters.has(index)
        ? parameter
        : { ...parameter, name: parameter.name.startsWith("_") ? parameter.name : `_${parameter.name}` }),
      parameterAbis: dispatch.parameters,
      parameterAdapters: dispatch.parameterAdapters,
      resultAdapter: dispatch.resultAdapter,
      ...(shape.returnType === undefined ? {} : { returnType: shape.returnType }),
      fallible: shape.fallible,
      isUnsafe: shape.isUnsafe,
    });
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
    }, ...implementations.map((implementation): RustStructField => ({
      name: implementation.fieldName,
      type: implementation.callableType,
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
    implementations: Object.freeze(implementations),
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
  methods: readonly RustObjectLiteralMethodDispatchPlan[],
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
    const stateField = stateFields.find((candidate) =>
      candidate.contractDeclarations.includes(field.declaration));
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
      const adapterContext: RustPlanContext = {
        ...context,
        fallibleContext: method.fallible,
      };
      const adapted = planRustObjectLiteralMethodArguments(
        method,
        adapterContext,
      );
      if (adapted === undefined) {
        return undefined;
      }
      let invocation: RustExpr = {
        kind: "method-call",
        receiver: { kind: "path", path: implementationName },
        method: "call",
        args: [{
          kind: "tuple-literal",
          elements: [receiver, ...adapted.adaptedArguments],
        }],
      };
      if (method.implementation.fallible) {
        invocation = { kind: "try", expr: invocation, errorDomain: "runtime" };
      }
      const adaptedResult = applyRustObjectLiteralValueAdapter(
        invocation,
        method.resultAdapter,
        method.contractMethod,
        adapterContext,
      );
      if (adaptedResult === undefined) {
        return undefined;
      }
      const result = method.fallible
        ? adaptedResult.kind === "try"
          ? adaptedResult.expr
          : { kind: "call" as const, path: "Ok", args: [adaptedResult] }
        : adaptedResult;
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
                name: method.implementation.fieldName,
              },
              method: "clone",
              args: [],
            },
          }, ...adapted.statements, {
            kind: "tail",
            expr: result,
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
