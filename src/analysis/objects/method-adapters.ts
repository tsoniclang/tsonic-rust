import type { AstReader, Node } from "@tsonic/tsts";
import { closedMetadataKey, isDenseDataArray } from "../../target-model/metadata/closed-data.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import type { RustPlanBuilder } from "../facts/plan-store.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
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
import { rustValueConversionIsFallible } from "../../target-model/conversions/contracts.js";
import {
  emptyRustGenericSubstitutions,
  inferRustTargetGenericSubstitutions,
  isRustVecCarrier,
  rustCallableProtocol,
  rustClosureProtocol,
  mergeRustGenericSubstitutions,
  rustGenericSubstitutionEntries,
  rustGenericSubstitutionsForOpenArguments,
  rustGenericsDeclaredParameterIdentities,
  rustOptionElementCarrier,
  rustSourceTypeCarrierValue,
  substituteRustTargetGenerics,
} from "../../target-model/types/index.js";
import type { RustGenericSubstitutions } from "../../target-model/types/index.js";
import type { RustTraitSupportQueries } from "../../target-model/types/index.js";
import { rustGenericParameterIdentityKey } from "../../target-model/types/index.js";
import type { RustSourceGenericIndex } from "../../policy/types/source-generics.js";
import type { RustGenericArgument, RustGenerics } from "../../target-model/semantics/index.js";
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
  readonly sourceGenerics: RustSourceGenericIndex;
  readonly traits: RustTraitSupportQueries;
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
    readonly sourceGenerics: RustSourceGenericIndex;
    readonly traits: RustTraitSupportQueries;
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
    const sourceGenericContract = input.sourceGenerics.contractFor(sourceCallable);
    const sourceParameters = sourceCallableParameterAbis(
      input,
      sourceCallable,
      emptyRustGenericSubstitutions,
    );
    const sourceReturnCarrier = sourceCallableReturnCarrier(
      input,
      sourceCallable,
      emptyRustGenericSubstitutions,
    );
    if (sourceGenericContract === undefined) {
      return reject(
        "The authored object-literal method has no exact mixed-generic contract.",
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
        const ownerSubstitutions = projectOwnerGenericSubstitutions(
          owner,
          relationship.targetType,
        );
        const contractSubstitutions = ownerSubstitutions === undefined
          ? undefined
          : mergeRustGenericSubstitutions(ownerSubstitutions, variant.specialization);
        if (contractSubstitutions === undefined) {
          return reject(
            "The selected object-literal method owner and specialization facts conflict.",
            contractMethod,
          );
        }
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
          sourceGenericContract.generics,
          sourceParameters,
          sourceReturnCarrier,
          contractParameters,
          contractReturnCarrier,
          variant.sourceGenerics,
          variant.targetGenericArguments,
        );
        if (sourceSubstitutions === undefined) {
          return reject(
            "The authored generic object-literal method cannot be closed from the exact selected contract specialization.",
            sourceCallable,
          );
        }
        const implementationParameters = sourceParameters.map((parameter) =>
          substituteObjectLiteralParameterAbi(parameter, sourceSubstitutions));
        const implementationReturnCarrier = substituteRustTargetGenerics(
          sourceReturnCarrier,
          sourceSubstitutions,
        );
        const parameterAdapters = selectObjectLiteralParameterAdapters(
          contractParameters,
          implementationParameters,
          input.projectTypes,
          input.sourceGenerics,
          input.traits,
        );
        const resultAdapter = selectObjectLiteralValueAdapter(
          implementationReturnCarrier,
          contractReturnCarrier,
          input.projectTypes,
          input.sourceGenerics,
          input.traits,
        );
        if (parameterAdapters === undefined || resultAdapter === undefined) {
          return reject(
            "The selected object-literal method contract cannot be adapted exactly to the authored implementation ABI.",
            contractMethod,
          );
        }
        const substitutions = rustGenericSubstitutionEntries(sourceSubstitutions);
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
            genericSubstitutions: substitutions,
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

function sourceCallableParameterAbis(
  input: { readonly ast: AstReader; readonly facts: RustPlanBuilder },
  callable: Node,
  substitutions: RustGenericSubstitutions,
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
  substitutions: RustGenericSubstitutions,
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
    : substituteRustTargetGenerics(returnCarrier, substitutions);
}

function substituteObjectLiteralParameterAbi(
  abi: RustObjectLiteralMethodParameterAbi,
  substitutions: RustGenericSubstitutions,
): RustObjectLiteralMethodParameterAbi {
  return Object.freeze({
    form: abi.form,
    sourceContract: abi.sourceContract,
    valueCarrier: substituteRustTargetGenerics(abi.valueCarrier, substitutions),
    parameterCarrier: substituteRustTargetGenerics(abi.parameterCarrier, substitutions),
    mode: abi.mode,
  });
}

function projectOwnerGenericSubstitutions(
  owner: RustProjectTypeDefinition,
  carrier: TargetTypeRef,
): RustGenericSubstitutions | undefined {
  const value = rustSourceTypeCarrierValue(carrier);
  return value === undefined
    ? undefined
    : rustGenericSubstitutionsForOpenArguments(
        owner.genericArguments,
        value.genericArguments,
      );
}

function inferObjectLiteralImplementationSubstitutions(
  sourceGenerics: RustGenerics,
  sourceParameters: readonly RustObjectLiteralMethodParameterAbi[],
  sourceReturnCarrier: TargetTypeRef,
  contractParameters: readonly RustObjectLiteralMethodParameterAbi[],
  contractReturnCarrier: TargetTypeRef,
  contractGenerics: RustGenerics,
  contractArguments: readonly RustGenericArgument[],
): RustGenericSubstitutions | undefined {
  let inferred = initialGenericSubstitutions(
    sourceGenerics,
    contractGenerics,
    contractArguments,
  );
  if (inferred === undefined) return undefined;
  const parameters = rustGenericsDeclaredParameterIdentities(sourceGenerics);
  const merge = (pattern: TargetTypeRef, actual: TargetTypeRef): boolean => {
    const candidate = inferRustTargetGenericSubstitutions(
      pattern,
      actual,
      parameters,
      inferred,
    );
    if (candidate === undefined) return false;
    inferred = candidate;
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
  if (!merge(sourceReturnCarrier, contractReturnCarrier)) return undefined;
  const complete = inferred;
  if (complete === undefined ||
    [...parameters.lifetimes].some((identity) => !complete.lifetimes.has(identity)) ||
    [...parameters.types].some((identity) => !complete.types.has(identity)) ||
    [...parameters.consts].some((identity) => !complete.consts.has(identity)) ||
    [...parameters.associatedTypes].some((identity) => !complete.associatedTypes.has(identity))) {
    return undefined;
  }
  return complete;
}

function initialGenericSubstitutions(
  source: RustGenerics,
  contract: RustGenerics,
  contractArguments: readonly RustGenericArgument[],
): RustGenericSubstitutions | undefined {
  if (source.parameters.length !== contract.parameters.length ||
    contract.parameters.length !== contractArguments.length ||
    source.parameters.some((parameter, index) =>
      parameter.kind !== contract.parameters[index]?.kind ||
      parameter.kind !== contractArguments[index]?.kind)) return undefined;
  const lifetimes = new Map<string, Extract<RustGenericArgument, { readonly kind: "lifetime" }>["value"]>();
  const types = new Map<string, TargetTypeRef>();
  const consts = new Map<string, Extract<RustGenericArgument, { readonly kind: "const" }>["value"]>();
  const associatedTypes = new Map<string, TargetTypeRef>();
  for (let index = 0; index < source.parameters.length; index += 1) {
    const parameter = source.parameters[index]!;
    const argument = contractArguments[index]!;
    const identity = rustGenericParameterIdentityKey(parameter);
    if (identity === undefined || parameter.kind !== argument.kind) return undefined;
    if (argument.kind === "lifetime") lifetimes.set(identity, argument.value);
    else if (argument.kind === "type") types.set(identity, argument.value);
    else consts.set(identity, argument.value);
  }
  return Object.freeze({ lifetimes, types, consts, associatedTypes });
}

function selectObjectLiteralParameterAdapters(
  contractParameters: readonly RustObjectLiteralMethodParameterAbi[],
  implementationParameters: readonly RustObjectLiteralMethodParameterAbi[],
  projectTypes: RustProjectTypePolicy,
  sourceGenerics: RustSourceGenericIndex,
  traits: RustTraitSupportQueries,
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
          sourceGenerics,
          traits,
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
        selectObjectLiteralValueAdapter(
          source.valueCarrier,
          targetElementCarrier,
          projectTypes,
          sourceGenerics,
          traits,
        ));
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
      sourceGenerics,
      traits,
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
      source.mode !== "value" && !traits.isCopy(source.valueCarrier) &&
        !traits.supportsClone(source.valueCarrier)) {
      return undefined;
    }
    const targetLogicalCarrier = target.form === "optional"
      ? rustOptionElementCarrier(target.parameterCarrier)
      : target.valueCarrier;
    const logicalAdapter = targetLogicalCarrier === undefined
      ? undefined
      : selectObjectLiteralValueAdapter(
          source.valueCarrier,
          targetLogicalCarrier,
          projectTypes,
          sourceGenerics,
          traits,
        );
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
  sourceGenerics: RustSourceGenericIndex,
  traits: RustTraitSupportQueries,
): RustObjectLiteralValueAdapter | undefined {
  if (rustTargetTypeRefEquals(sourceCarrier, targetCarrier)) {
    return Object.freeze({ kind: "identity", sourceCarrier, targetCarrier });
  }
  const sourceOption = rustOptionElementCarrier(sourceCarrier);
  const targetOption = rustOptionElementCarrier(targetCarrier);
  if (targetOption !== undefined && sourceOption === undefined) {
    const element = selectObjectLiteralValueAdapter(
      sourceCarrier,
      targetOption,
      projectTypes,
      sourceGenerics,
      traits,
    );
    return element === undefined
      ? undefined
      : Object.freeze({ kind: "option-some", sourceCarrier, targetCarrier, element });
  }
  if (sourceOption !== undefined && targetOption !== undefined) {
    const element = selectObjectLiteralValueAdapter(
      sourceOption,
      targetOption,
      projectTypes,
      sourceGenerics,
      traits,
    );
    return element === undefined
      ? undefined
      : Object.freeze({ kind: "option-map", sourceCarrier, targetCarrier, element });
  }
  const selected = selectRustValueCarrierReconciliation(
    sourceCarrier,
    targetCarrier,
    projectTypes,
    sourceGenerics,
  );
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
