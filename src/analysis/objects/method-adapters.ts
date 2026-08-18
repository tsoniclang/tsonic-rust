import type { AstReader, Node } from "@tsonic/tsts";
import { closedMetadataKey, isDenseDataArray } from "../../policy/model/closed-data.js";
import { rustTargetTypeRefEquals } from "../../policy/types/equality.js";
import type { RustPlanBuilder } from "../facts/plan-store.js";
import type { TargetTypeRef } from "../../policy/types/model.js";
import {
  rustObjectLiteralMethodAdapterFactKey,
  rustSourceCallableReturnFactKey,
  rustSourceParameterAbiFactKey,
  rustTargetOperationFactKey,
} from "../facts/keys.js";
import type {
  RustObjectLiteralMethodAdapterFact,
  RustObjectLiteralMethodParameterAbi,
  RustObjectLiteralMethodParameterAdapter,
  RustObjectLiteralValueAdapter,
  RustTargetOperationFact,
} from "../facts/keys.js";
import { rustValueConversionIsFallible } from "../../policy/conversions/contracts.js";
import {
  inferRustTargetTypeParameterBindings,
  isRustCopyCarrier,
  isRustVecCarrier,
  rustCallableProtocol,
  rustCarrierSupportsClone,
  rustClosureProtocol,
  rustOptionElementCarrier,
  rustSourceTypeCarrierValue,
  rustTargetTypeContainsTypeParameter,
  substituteRustTargetTypeParameters,
} from "../../policy/types/target-types.js";
import type { RustProjectMethodDispatchPlan } from "../project-types/method-dispatch.js";
import type {
  RustProjectTypeDefinition,
  RustProjectTypePolicy,
} from "../project-types/type-policy.js";
import { selectRustValueCarrierReconciliation } from "../../policy/types/value-carrier-reconciliation.js";

export interface RustObjectLiteralMethodAdapterIssue {
  readonly expression: Node;
  readonly subject: Node;
  readonly message: string;
}

export function recordRustObjectLiteralMethodAdapterFacts(input: {
  readonly ast: AstReader;
  readonly facts: RustPlanBuilder;
  readonly projectTypes: RustProjectTypePolicy;
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
          substituteObjectLiteralParameterAbi(parameter, sourceSubstitutions));
        const implementationReturnCarrier = substituteRustTargetTypeParameters(
          sourceReturnCarrier,
          sourceSubstitutions,
        );
        const parameterAdapters = selectObjectLiteralParameterAdapters(
          contractParameters,
          implementationParameters,
          input.projectTypes,
        );
        const resultAdapter = selectObjectLiteralValueAdapter(
          implementationReturnCarrier,
          contractReturnCarrier,
          input.projectTypes,
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
          adapterFallible: parameterAdapters.some(objectLiteralParameterAdapterIsFallible) ||
            objectLiteralValueAdapterIsFallible(resultAdapter),
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

function sourceCallableParameterAbis(
  input: { readonly ast: AstReader; readonly facts: RustPlanBuilder },
  callable: Node,
  substitutions: ReadonlyMap<string, TargetTypeRef>,
): RustObjectLiteralMethodParameterAbi[] | undefined {
  const parameters = input.ast.parameters(callable);
  if (!isDenseDataArray(parameters) || parameters.some((parameter) => parameter === undefined)) {
    return undefined;
  }
  const abis = (parameters as readonly Node[]).map((parameter) => {
    const abi = input.facts.get(parameter, rustSourceParameterAbiFactKey) ??
      input.facts.resolve(parameter, rustSourceParameterAbiFactKey);
    return abi === undefined ? undefined : substituteObjectLiteralParameterAbi(abi, substitutions);
  });
  return abis.some((abi) => abi === undefined)
    ? undefined
    : abis as RustObjectLiteralMethodParameterAbi[];
}

function sourceCallableReturnCarrier(
  input: { readonly facts: RustPlanBuilder },
  callable: Node,
  substitutions: ReadonlyMap<string, TargetTypeRef>,
): TargetTypeRef | undefined {
  const fact = input.facts.get(callable, rustSourceCallableReturnFactKey) ??
    input.facts.resolve(callable, rustSourceCallableReturnFactKey);
  const operation = fact === undefined
    ? input.facts.get(callable, rustTargetOperationFactKey) ??
      input.facts.resolve(callable, rustTargetOperationFactKey)
    : undefined;
  const operationReturn = operation?.kind === "closure"
    ? rustClosureProtocol(operation.resultCarrier)?.result ??
      rustCallableProtocol(operation.resultCarrier)?.result ??
      (operation.resultCarrier.kind === "function-pointer" ? operation.resultCarrier.result : undefined)
    : undefined;
  const returnCarrier = fact?.returnCarrier ?? operationReturn;
  return returnCarrier === undefined
    ? undefined
    : substituteRustTargetTypeParameters(returnCarrier, substitutions);
}

function substituteObjectLiteralParameterAbi(
  abi: RustObjectLiteralMethodParameterAbi,
  substitutions: ReadonlyMap<string, TargetTypeRef>,
): RustObjectLiteralMethodParameterAbi {
  return Object.freeze({
    form: abi.form,
    valueCarrier: substituteRustTargetTypeParameters(abi.valueCarrier, substitutions),
    parameterCarrier: substituteRustTargetTypeParameters(abi.parameterCarrier, substitutions),
    mode: abi.mode,
  });
}

function projectOwnerTypeSubstitutions(
  owner: RustProjectTypeDefinition,
  carrier: TargetTypeRef,
): Map<string, TargetTypeRef> {
  const value = rustSourceTypeCarrierValue(carrier);
  return new Map(owner.typeParameterNames.map((name, index) =>
    [name, value?.typeArguments[index] ?? { kind: "type-parameter", name }] as const));
}

function inferObjectLiteralImplementationSubstitutions(
  sourceTypeParameterNames: readonly string[],
  sourceParameters: readonly RustObjectLiteralMethodParameterAbi[],
  sourceReturnCarrier: TargetTypeRef,
  contractParameters: readonly RustObjectLiteralMethodParameterAbi[],
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

function selectObjectLiteralParameterAdapters(
  contractParameters: readonly RustObjectLiteralMethodParameterAbi[],
  implementationParameters: readonly RustObjectLiteralMethodParameterAbi[],
  projectTypes: RustProjectTypePolicy,
): RustObjectLiteralMethodParameterAdapter[] | undefined {
  const adapters: RustObjectLiteralMethodParameterAdapter[] = [];
  for (const [implementationIndex, target] of implementationParameters.entries()) {
    if (target.form === "rest") {
      if (!isRustVecCarrier(target.parameterCarrier)) {
        return undefined;
      }
      const targetElementCarrier = target.parameterCarrier.element;
      const remaining = contractParameters.slice(implementationIndex);
      const sourceRest = remaining.length === 1 && remaining[0]?.form === "rest"
        ? remaining[0]
        : undefined;
      if (sourceRest !== undefined && isRustVecCarrier(sourceRest.parameterCarrier)) {
        const elementAdapter = selectObjectLiteralValueAdapter(
          sourceRest.parameterCarrier.element,
          targetElementCarrier,
          projectTypes,
        );
        if (elementAdapter === undefined) {
          return undefined;
        }
        adapters.push(Object.freeze({
          kind: "sequence-rest",
          contractParameterIndex: implementationIndex,
          source: sourceRest,
          target,
          elementAdapter,
        }));
        continue;
      }
      if (remaining.some((source) => source.form !== "required")) {
        return undefined;
      }
      const elementAdapters = remaining.map((source) =>
        selectObjectLiteralValueAdapter(source.valueCarrier, targetElementCarrier, projectTypes));
      if (elementAdapters.some((adapter) => adapter === undefined)) {
        return undefined;
      }
      adapters.push(Object.freeze({
        kind: "fixed-rest",
        contractParameterIndexes: Object.freeze(remaining.map((_source, index) => implementationIndex + index)),
        sources: Object.freeze(remaining),
        target,
        elementAdapters: Object.freeze(elementAdapters as RustObjectLiteralValueAdapter[]),
      }));
      continue;
    }
    const source = contractParameters[implementationIndex];
    if (source === undefined) {
      if (target.form !== "optional" && target.form !== "default") {
        return undefined;
      }
      adapters.push(Object.freeze({ kind: "omitted", target }));
      continue;
    }
    const runtimeAdapter = selectObjectLiteralValueAdapter(
      source.parameterCarrier,
      target.parameterCarrier,
      projectTypes,
    );
    if (runtimeAdapter !== undefined &&
      (source.mode === target.mode || source.mode === "mut-ref" && target.mode === "ref")) {
      adapters.push(Object.freeze({
        kind: "runtime-value",
        contractParameterIndex: implementationIndex,
        source,
        target,
        adapter: runtimeAdapter,
      }));
      continue;
    }
    if (source.form !== "required" ||
      source.mode !== "value" && !isRustCopyCarrier(source.valueCarrier) &&
        !rustCarrierSupportsClone(source.valueCarrier)) {
      return undefined;
    }
    const targetLogicalCarrier = target.form === "optional"
      ? rustOptionElementCarrier(target.parameterCarrier)
      : target.valueCarrier;
    const logicalAdapter = targetLogicalCarrier === undefined
      ? undefined
      : selectObjectLiteralValueAdapter(source.valueCarrier, targetLogicalCarrier, projectTypes);
    if (logicalAdapter === undefined) {
      return undefined;
    }
    adapters.push(Object.freeze({
      kind: "logical-value",
      contractParameterIndex: implementationIndex,
      source,
      target,
      adapter: logicalAdapter,
    }));
  }
  return adapters;
}

function selectObjectLiteralValueAdapter(
  sourceCarrier: TargetTypeRef,
  targetCarrier: TargetTypeRef,
  projectTypes: RustProjectTypePolicy,
): RustObjectLiteralValueAdapter | undefined {
  if (rustTargetTypeRefEquals(sourceCarrier, targetCarrier)) {
    return Object.freeze({ kind: "identity", sourceCarrier, targetCarrier });
  }
  const sourceOption = rustOptionElementCarrier(sourceCarrier);
  const targetOption = rustOptionElementCarrier(targetCarrier);
  if (targetOption !== undefined && sourceOption === undefined) {
    const element = selectObjectLiteralValueAdapter(sourceCarrier, targetOption, projectTypes);
    return element === undefined
      ? undefined
      : Object.freeze({ kind: "option-some", sourceCarrier, targetCarrier, element });
  }
  if (sourceOption !== undefined && targetOption !== undefined) {
    const element = selectObjectLiteralValueAdapter(sourceOption, targetOption, projectTypes);
    return element === undefined
      ? undefined
      : Object.freeze({ kind: "option-map", sourceCarrier, targetCarrier, element });
  }
  const selected = selectRustValueCarrierReconciliation(sourceCarrier, targetCarrier, projectTypes);
  switch (selected.kind) {
    case "identity":
      return Object.freeze({ kind: "identity", sourceCarrier, targetCarrier });
    case "conversion":
      return Object.freeze({
        kind: "conversion",
        sourceCarrier,
        targetCarrier,
        conversion: selected.fact.conversion,
      });
    case "project-upcast":
      return Object.freeze({ kind: "project-upcast", sourceCarrier, targetCarrier });
    case "incompatible":
      return undefined;
  }
}

function objectLiteralValueAdapterIsFallible(adapter: RustObjectLiteralValueAdapter): boolean {
  switch (adapter.kind) {
    case "conversion":
      return rustValueConversionIsFallible(adapter.conversion);
    case "option-some":
    case "option-map":
      return objectLiteralValueAdapterIsFallible(adapter.element);
    case "identity":
    case "project-upcast":
      return false;
  }
}

function objectLiteralParameterAdapterIsFallible(
  adapter: RustObjectLiteralMethodParameterAdapter,
): boolean {
  switch (adapter.kind) {
    case "runtime-value":
    case "logical-value":
      return objectLiteralValueAdapterIsFallible(adapter.adapter);
    case "fixed-rest":
      return adapter.elementAdapters.some(objectLiteralValueAdapterIsFallible);
    case "sequence-rest":
      return objectLiteralValueAdapterIsFallible(adapter.elementAdapter);
    case "omitted":
      return false;
  }
}
