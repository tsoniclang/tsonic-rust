import { createImplementationPlan } from "./registry.js";
import { rustTargetOperationFactKey } from "../../../../analysis/facts/keys.js";
import type { Node, SourceFile } from "@tsonic/tsts";
import type { RustFunctionParam, RustItem, RustType } from "../../../target-ast/nodes.js";
import type { RustObjectLiteralMethodParameterAbi, RustObjectLiteralMethodParameterAdapter, RustObjectLiteralValueAdapter } from "../../../../analysis/facts/keys.js";
import type { RustPlanContext } from "../../program/plan-context.js";
import type { RustSyntheticNameState } from "../../names/synthetic.js";
import type { RustProjectMethodDispatchVariant } from "../../../../analysis/project-types/method-dispatch.js";
import type { TargetTypeRef } from "../../../../target-model/types/model.js";

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
    readonly parameterAbis: readonly RustObjectLiteralMethodParameterAbi[];
    readonly parameterAdapters: readonly RustObjectLiteralMethodParameterAdapter[];
    readonly resultAdapter: RustObjectLiteralValueAdapter;
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
  forExpression(expression: Node): RustObjectLiteralImplementationPlan | undefined;
}

export type RustRecordLiteralFact = Extract<
  import("../../../../analysis/facts/keys.js").RustTargetOperationFact,
  { readonly kind: "record-literal" }
>;

export function rustObjectLiteralRequiresDispatchImplementation(
  fact: RustRecordLiteralFact,
  context: RustPlanContext,
): boolean {
  if (fact.storage !== "project-object") {
    return false;
  }
  if (fact.contributions.some((contribution) =>
    contribution.kind === "method" || contribution.kind === "accessor" ||
    contribution.kind === "spread" && contribution.methods.length > 0)) {
    return true;
  }
  return fact.fields.some((field) => field.contractDeclarations.some((declaration) => {
    const dispatch = context.input.program.projectFieldDispatch.planFor(declaration);
    return dispatch === undefined ||
      dispatch.read.selfMode !== "ref" || dispatch.read.fallible ||
      dispatch.write !== undefined &&
        (dispatch.write.selfMode !== "ref" || dispatch.write.fallible);
  }));
}

export function createRustObjectLiteralImplementationRegistry(
  sourceFile: SourceFile,
  context: RustPlanContext,
  names: RustSyntheticNameState,
): RustObjectLiteralImplementationRegistry {
  const plans = new Map<Node, RustObjectLiteralImplementationPlan>();
  const items: RustItem[] = [];
  const visit = (node: Node): void => {
    const fact = context.input.program.facts.getFact(node, rustTargetOperationFactKey);
    if (fact?.kind === "record-literal" &&
      rustObjectLiteralRequiresDispatchImplementation(fact, context)) {
      const plan = createImplementationPlan(node, fact, context, names);
      if (plan !== undefined) {
        plans.set(node, plan);
        items.push(...plan.items);
      }
    }
    context.input.program.source.ast.forEachChild(node, (child) => {
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
