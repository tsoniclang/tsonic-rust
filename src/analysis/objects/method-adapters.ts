import type { AstReader, Node } from "@tsonic/tsts";
import { closedMetadataKey, isDenseDataArray } from "../../target-model/metadata/closed-data.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import type { RustPlanBuilder } from "../facts/plan-store.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { rustObjectLiteralMethodAdapterFactKey, rustTargetOperationFactKey } from "../facts/keys.js";
import type { RustObjectLiteralMethodAdapterFact, RustTargetOperationFact } from "../facts/keys.js";
import type { RustCallableParameterAbi } from "../facts/callable-adapters.js";
import { inferRustTargetTypeParameterBindings, rustTargetTypeContainsTypeParameter, substituteRustTargetTypeParameters } from "../../target-model/types/index.js";
import type { RustProjectMethodDispatchPlan } from "../project-types/method-dispatch.js";
import type { RustProjectTypePolicy } from "../project-types/type-policy.js";
import type { RustTypeDefinitions } from "../../target-model/types/source-union-definitions.js";
import { sourceCallableParameterAbis, sourceCallableReturnCarrier, substituteRustCallableParameterAbi, projectOwnerTypeSubstitutions, selectRustCallableParameterAdapters, selectRustCallableValueAdapter, rustCallableParameterAdapterIsFallible, rustCallableValueAdapterIsFallible } from "../callables/adapters.js";

export interface RustObjectLiteralMethodAdapterIssue {
  readonly expression: Node;
  readonly subject: Node;
  readonly message: string;
}

export function recordRustObjectLiteralMethodAdapterFacts(input: {
  readonly ast: AstReader;
  readonly facts: RustPlanBuilder;
  readonly projectTypes: RustProjectTypePolicy;
  readonly typeDefinitions: RustTypeDefinitions;
  readonly projectMethodDispatch: RustProjectMethodDispatchPlan;
  readonly expressions: readonly Node[];
}): readonly RustObjectLiteralMethodAdapterIssue[] {
  const issues: RustObjectLiteralMethodAdapterIssue[] = [];
  for (const expression of input.expressions) {
    const operation = input.facts.get(expression, rustTargetOperationFactKey) ??
      input.facts.resolve(expression, rustTargetOperationFactKey);
    if (operation?.kind !== "record-literal") {
      issues.push({
        expression,
        subject: expression,
        message: "Object literal method implementations require one finalized record-literal operation.",
      });
      continue;
    }
    const fact = createObjectLiteralMethodAdapterFact(input, expression, operation, issues);
    if (fact === undefined) {
      continue;
    }
    input.facts.set(expression, rustObjectLiteralMethodAdapterFactKey, fact, [
      { message: "rust exact object-literal method implementation and dispatch adapters" },
    ]);
  }
  return Object.freeze(issues);
}

function createObjectLiteralMethodAdapterFact(
  input: {
    readonly ast: AstReader;
    readonly facts: RustPlanBuilder;
    readonly projectTypes: RustProjectTypePolicy;
    readonly typeDefinitions: RustTypeDefinitions;
    readonly projectMethodDispatch: RustProjectMethodDispatchPlan;
  },
  expression: Node,
  operation: Extract<RustTargetOperationFact, { readonly kind: "record-literal" }>,
  issues: RustObjectLiteralMethodAdapterIssue[],
): RustObjectLiteralMethodAdapterFact | undefined {
  const reject = (message: string, subject: Node = expression): undefined => {
    issues.push({ expression, subject, message });
    return undefined;
  };
  const implementations: RustObjectLiteralMethodAdapterFact["implementations"][number][] = [];
  const dispatches: RustObjectLiteralMethodAdapterFact["dispatches"][number][] = [];
  const implementationIndexes = new Map<Node, Map<string, number>>();
  for (const contribution of operation.contributions) {
    if (contribution.kind !== "method") {
      continue;
    }
    const sourceCallable = contribution.expression;
    const sourceTypeParameterNames = sourceCallableTypeParameterNames(input, sourceCallable);
    const sourceParameters = sourceCallableParameterAbis(input, sourceCallable, new Map());
    const sourceReturnCarrier = sourceCallableReturnCarrier(input, sourceCallable, new Map());
    if (sourceTypeParameterNames === undefined) {
      return reject(
        "The authored object-literal method has no dense, named type-parameter contract.",
        sourceCallable,
      );
    }
    if (sourceParameters === undefined) {
      return reject(
        "The authored object-literal method has no complete finalized parameter ABI.",
        sourceCallable,
      );
    }
    if (sourceReturnCarrier === undefined) {
      return reject(
        "The authored object-literal method has no complete finalized return ABI.",
        sourceCallable,
      );
    }
    for (const contractMethod of contribution.contractDeclarations) {
      const owner = input.projectTypes.definitionContainingDeclaration(contractMethod);
      const relationship = owner === undefined
        ? undefined
        : input.projectTypes.relationship(operation.resultCarrier, owner);
      if (owner === undefined || relationship?.kind !== "related") {
        return reject(
          "The selected object-literal method contract has no exact related project-interface owner.",
          contractMethod,
        );
      }
      for (const variant of input.projectMethodDispatch.variantsForMember(contractMethod)) {
        const contractSubstitutions = projectOwnerTypeSubstitutions(owner, relationship.targetType);
        variant.sourceTypeParameterNames.forEach((name, index) => {
          const target = variant.targetTypeArguments[index];
          if (target !== undefined) {
            contractSubstitutions.set(name, target);
          }
        });
        const contractParameters = sourceCallableParameterAbis(
          input,
          contractMethod,
          contractSubstitutions,
        );
        const contractReturnCarrier = sourceCallableReturnCarrier(
          input,
          contractMethod,
          contractSubstitutions,
        );
        if (contractParameters === undefined || contractReturnCarrier === undefined) {
          return reject(
            "The selected object-literal method contract has no complete finalized parameter and return ABI.",
            contractMethod,
          );
        }
        const sourceSubstitutions = inferObjectLiteralImplementationSubstitutions(
          sourceTypeParameterNames,
          sourceParameters,
          sourceReturnCarrier,
          contractParameters,
          contractReturnCarrier,
          variant.sourceTypeParameterNames,
          variant.targetTypeArguments,
        );
        if (sourceSubstitutions === undefined) {
          return reject(
            "The authored generic object-literal method cannot be closed from the exact selected contract specialization.",
            sourceCallable,
          );
        }
        const implementationParameters = sourceParameters.map((parameter) =>
          substituteRustCallableParameterAbi(parameter, sourceSubstitutions));
        const implementationReturnCarrier = substituteRustTargetTypeParameters(
          sourceReturnCarrier,
          sourceSubstitutions,
        );
        const parameterAdapters = selectRustCallableParameterAdapters(
          contractParameters,
          implementationParameters,
          input.projectTypes, input.typeDefinitions,
        );
        const resultAdapter = selectRustCallableValueAdapter(
          implementationReturnCarrier,
          contractReturnCarrier,
          input.projectTypes, input.typeDefinitions,
        );
        if (parameterAdapters === undefined || resultAdapter === undefined) {
          return reject(
            "The selected object-literal method contract cannot be adapted exactly to the authored implementation ABI.",
            contractMethod,
          );
        }
        const substitutions = Object.freeze(sourceTypeParameterNames.map((name) =>
          Object.freeze([name, sourceSubstitutions.get(name)!] as const)));
        const implementationKey = closedMetadataKey({
          substitutions,
          parameters: implementationParameters,
          returnCarrier: implementationReturnCarrier,
        });
        const byKey = implementationIndexes.get(sourceCallable) ?? new Map<string, number>();
        let implementationIndex = byKey.get(implementationKey);
        if (implementationIndex === undefined) {
          implementationIndex = implementations.length;
          implementations.push(Object.freeze({
            sourceCallable,
            typeParameterSubstitutions: substitutions,
            parameters: Object.freeze(implementationParameters),
            returnCarrier: implementationReturnCarrier,
          }));
          byKey.set(implementationKey, implementationIndex);
          implementationIndexes.set(sourceCallable, byKey);
        }
        dispatches.push(Object.freeze({
          contractMethod,
          virtualSlot: variant.virtualSlot,
          implementationIndex,
          parameters: Object.freeze(contractParameters),
          returnCarrier: contractReturnCarrier,
          parameterAdapters: Object.freeze(parameterAdapters),
          resultAdapter,
          adapterFallible: parameterAdapters.some(adapter => rustCallableParameterAdapterIsFallible(adapter, input.typeDefinitions)) ||
            rustCallableValueAdapterIsFallible(resultAdapter, input.typeDefinitions),
        }));
      }
    }
  }
  return implementations.length === 0 || dispatches.length === 0
    ? reject("The object literal has no exact selected method implementation and dispatch pair.")
    : Object.freeze({
        implementations: Object.freeze(implementations),
        dispatches: Object.freeze(dispatches),
      });
}

function sourceCallableTypeParameterNames(
  input: { readonly ast: AstReader },
  callable: Node,
): readonly string[] | undefined {
  const parameters = input.ast.typeParameters(callable);
  if (!isDenseDataArray(parameters) || parameters.some((parameter) => parameter === undefined)) {
    return undefined;
  }
  const names = (parameters as readonly Node[]).map((parameter) => {
    const name = input.ast.name(parameter);
    return name === undefined ? "" : input.ast.text(name);
  });
  return names.some((name) => name.length === 0) ? undefined : Object.freeze(names);
}


function inferObjectLiteralImplementationSubstitutions(
  sourceTypeParameterNames: readonly string[],
  sourceParameters: readonly RustCallableParameterAbi[],
  sourceReturnCarrier: TargetTypeRef,
  contractParameters: readonly RustCallableParameterAbi[],
  contractReturnCarrier: TargetTypeRef,
  contractTypeParameterNames: readonly string[],
  contractTypeArguments: readonly TargetTypeRef[],
): ReadonlyMap<string, TargetTypeRef> | undefined {
  if (sourceTypeParameterNames.length === 0) {
    return new Map();
  }
  const selectedNames = new Set(sourceTypeParameterNames);
  const inferred = new Map<string, TargetTypeRef>();
  if (sourceTypeParameterNames.length === contractTypeParameterNames.length &&
    contractTypeParameterNames.length === contractTypeArguments.length) {
    sourceTypeParameterNames.forEach((name, index) => {
      const target = contractTypeArguments[index];
      if (target !== undefined) {
        inferred.set(name, target);
      }
    });
  }
  const merge = (pattern: TargetTypeRef, actual: TargetTypeRef): boolean => {
    if (!rustTargetTypeContainsTypeParameter(pattern, selectedNames)) {
      return true;
    }
    const candidate = inferRustTargetTypeParameterBindings(pattern, actual, selectedNames);
    if (candidate === undefined) {
      return false;
    }
    for (const [name, carrier] of candidate) {
      const existing = inferred.get(name);
      if (existing !== undefined && !rustTargetTypeRefEquals(existing, carrier)) {
        return false;
      }
      inferred.set(name, carrier);
    }
    return true;
  };
  for (const [index, source] of sourceParameters.entries()) {
    const contract = contractParameters[index];
    if (contract === undefined) {
      break;
    }
    if (!merge(source.parameterCarrier, contract.parameterCarrier) ||
      !merge(source.valueCarrier, contract.valueCarrier)) {
      return undefined;
    }
  }
  if (!merge(sourceReturnCarrier, contractReturnCarrier) ||
    sourceTypeParameterNames.some((name) => !inferred.has(name))) {
    return undefined;
  }
  return inferred;
}
