import { createImplementationPlan } from "./registry.js";

import type { Node, SourceFile } from "@tsonic/tsts";
import type { RustFunctionParam, RustItem, RustType } from "../../../target-ast/syntax/nodes.js";
import type { RustCallableParameterAbi, RustCallableParameterAdapter, RustCallableValueAdapter } from "../../../../target-model/records/callables/callable-adapters.js";
import type { RustPlanContext } from "../../program/plan-context.js";
import type { RustSyntheticNameState } from "../../names/synthetic.js";
import type { RustProjectMethodDispatchVariant } from "../../../../target-model/records/operations/method-dispatch.js";
import { failRustPlannerInvariant } from "../../diagnostics.js";
import type { TargetTypeRef } from "../../../../target-model/types/model.js";
import { createStructuralLiteralImplementation, type RustStructuralLiteralImplementation } from "./structural.js";

export type RustObjectLiteralMethodImplementationPlan = {
  readonly kind: "authored";
  readonly propertyIdentity: Node;
  readonly sourceCallable: Node;
  readonly fieldName: string;
  readonly callableType: RustType;
  readonly parameterCount: number;
  readonly typeParameterSubstitutions: readonly (readonly [string, TargetTypeRef])[];
  readonly errorType?: RustType;
} | {
  readonly kind: "spread";
  readonly propertyIdentity: Node;
  readonly contractMethod: Node;
  readonly fieldName: string;
  readonly callableType: RustType;
  readonly parameterCount: number;
  readonly errorType: RustType;
};

export interface RustObjectLiteralMethodOverridePlan {
  readonly propertyIdentity: Node;
  readonly fieldName: string;
  readonly callableType: RustType;
  readonly parameters: readonly RustFunctionParam[];
  readonly returnType?: RustType;
  readonly errorType?: RustType;
}

export interface RustObjectLiteralMethodDispatchPlan {
  readonly contractMethod: Node;
  readonly variant: RustProjectMethodDispatchVariant;
  readonly implementation: RustObjectLiteralMethodImplementationPlan;
  readonly parameters: readonly RustFunctionParam[];
  readonly adapter?: {
    readonly parameterAbis: readonly RustCallableParameterAbi[];
    readonly parameterAdapters: readonly RustCallableParameterAdapter[];
    readonly resultAdapter: RustCallableValueAdapter;
  };
  readonly override?: RustObjectLiteralMethodOverridePlan;
  readonly returnType?: RustType;
  readonly errorType?: RustType;
  readonly isUnsafe: boolean;
}

export interface RustObjectLiteralAccessorImplementationPlan {
  readonly storageIndex: number;
  readonly contractDeclarations: readonly Node[];
  readonly getter: {
    readonly fieldName: string;
    readonly callableType: RustType;
  };
  readonly setter?: {
    readonly fieldName: string;
    readonly callableType: RustType;
  };
}

export interface RustObjectLiteralImplementationPlan {
  readonly kind: "project";
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
  readonly accessors: readonly RustObjectLiteralAccessorImplementationPlan[];
  readonly implementations: readonly RustObjectLiteralMethodImplementationPlan[];
  readonly methodOverrides: readonly RustObjectLiteralMethodOverridePlan[];
  readonly methods: readonly RustObjectLiteralMethodDispatchPlan[];
  readonly items: readonly RustItem[];
}

export interface RustObjectLiteralImplementationRegistry {
  readonly items: readonly RustItem[];
  forExpression(expression: Node): RustObjectLiteralImplementationPlan | RustStructuralLiteralImplementation | undefined;
  forReferenceView(expression: Node): RustStructuralLiteralImplementation | undefined;
}

export function rustObjectLiteralRequiresDispatchImplementation(node: Node, context: RustPlanContext): boolean {
  return context.input.program.records.objectLiteralEmission.get(node)?.implementation !== undefined;
}

export function createRustObjectLiteralImplementationRegistry(
  sourceFile: SourceFile, context: RustPlanContext, names: RustSyntheticNameState,
): RustObjectLiteralImplementationRegistry {
  const plans = new Map<Node, RustObjectLiteralImplementationPlan | RustStructuralLiteralImplementation>();
  const referenceViews = new Map<Node, RustStructuralLiteralImplementation>();
  const items: RustItem[] = [];
  for (const request of context.input.program.records.objectLiteralEmissions.get(sourceFile) ?? []) {
    const plan = request.kind === "project" ? createImplementationPlan(request.node, request.selection, context, names)
      : createStructuralLiteralImplementation(request.node, request.selection, context, names);
    if (plan === undefined) failRustPlannerInvariant("An admitted object literal requires its exact native implementation.", request.node);
    if (request.kind === "reference") {
      if (plan.kind !== "structural") failRustPlannerInvariant("An admitted structural reference requires its native structural implementation.", request.node);
      referenceViews.set(request.node, plan);
    } else plans.set(request.node, plan);
    items.push(...plan.items);
  }
  return Object.freeze({ items: Object.freeze(items),
    forExpression: (expression: Node) => plans.get(expression),
    forReferenceView: (expression: Node) => referenceViews.get(expression) });
}
