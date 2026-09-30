import { stringListsEqual, type RequirementUse, type RequirementContractState } from "./generic-requirement-contract.js";
import { substituteElidedLifetime } from "../../target-model/types/carriers/lifetime-elision.js";
import { rustStaticLifetime } from "../../target-model/lifetimes/index.js";
import { rustObjectReferenceViewKey } from "../facts/object-reference-views.js";
import type { RustTypeDefinitions } from "../../target-model/types/source-union-definitions.js";
import { rustGenericCallableValue } from "../../target-model/types/carriers/generic-callables.js";
import { rustTypeParameterFromSourceContract } from "../../target-model/names/type-parameters.js";
import type { AstReader, Node } from "@tsonic/tsts";
import { rustGenericNumericOperandsKey } from "../facts/generic-numeric.js";
import { classifyCarrierRequirements } from "./generic-carrier-requirements.js";
import { createRustOptionalStorageCollector } from "./type-projections.js";
import { isRustDeclarationPathUse, isRustReturnedValue, isRustIndependentCallable, isRustGenericTypeDeclaration } from "./generic-reference-uses.js";
import { createRustAssociatedRequirementCollector } from "./associated-requirements.js";
import type { RustSourceTypeFamilyRegistry } from "../../target-model/types/type-families.js";
import type { RustProjectTypePolicy } from "../project-types/type-policy.js";
import { substituteRustTargetTypeParameters } from "../../target-model/types/carriers/substitution.js";
import { rustTargetTypeChildren } from "../../target-model/types/carriers/children.js";
import { rustJsArrayEntriesElementTargetType } from "../../target-model/types/carriers/array-entries.js";
import { rustTargetTypeParameterIdentities } from "../../target-model/types/carriers/generic-references.js";
import type { RustObjectRepresentationPlan } from "../project-types/object-representation.js";
import { createRustProjectProjectionRequirementCollector } from "./project-projection-requirements.js";
import type { RustValueLifetimePlan } from "../program/value-lifetimes.js";
import { KindBinaryExpression, KindExpressionStatement, Node_Expression } from "@tsonic/target-api/source";
import { rustValueCarrierBeforeOptionProjection } from "../facts/value-carrier-queries.js";
import { isRustAssignmentOperator } from "../../target-model/syntax/tokens.js";
import type { RustNamePlan } from "../../target-model/names/model.js";
import type { RustPlanQueries } from "../../target-model/facts/selections.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import {
  getRustGeneratorProtocol,
  rustAwaitCarrier,
  isRustCopyCarrier,
  isRustJsValueCarrier,
  rustOptionElementCarrier,
  rustClosureProtocol,
  rustJsPromiseTargetId,
  rustSourceTypeCarrierValue,
  rustTargetGenericTypeArguments,
} from "../../target-model/types/index.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { rustBindingProjectionCloneCarriers } from "../../policy/types/binding-normalization.js";
import type { RustLifetimeIndex } from "../../target-model/lifetimes/index.js";
import {
  rustAsyncFunctionFactKey,
  rustClosureCaptureFactKey,
  rustGeneratorFactKey,
  rustFutureValueFactKey,
  rustFlowReadProjectionFactKey,
  rustProjectDowncastFactKey,
  rustBindingStorageFactKey,
  rustBindingProjectionFactKey,
  rustSourceParameterAbiFactKey,
  rustSourceCallableReturnFactKey,
  rustTargetOperationFactKey,
  rustTypedLocationPlanKey,
  rustYieldFactKey,
} from "../facts/keys.js";

import type { RustGenericRequirement } from "./generic-requirements.js";
import { normalizeRustGenericRequirements } from "./generic-requirement-contract.js";

interface ClassifyCallableInput {
  readonly valueLifetimes: RustValueLifetimePlan;
  readonly isStoredValue: (node: Node) => boolean;
  readonly typeDefinitions: RustTypeDefinitions;
  readonly ast: AstReader;
  readonly declaration: Node;
  readonly facts: RustPlanQueries;
  readonly names: RustNamePlan;
  readonly sourceLifetimes: RustLifetimeIndex;
  readonly typeFamilies: RustSourceTypeFamilyRegistry;
  readonly projectTypes: RustProjectTypePolicy;
  readonly objectRepresentations: RustObjectRepresentationPlan;
  readonly idByDeclaration: WeakMap<Node, string>;
  readonly implementationDeclaration: (declaration: Node) => Node;
  readonly contractFor: (declaration: Node) => RequirementContractState | undefined;
}


export function classifyRustCallableRequirements(input: ClassifyCallableInput):
  | {
      readonly kind: "resolved";
      readonly contract: RequirementContractState;
      readonly dependencies: readonly string[];
    }
  | { readonly kind: "rejected"; readonly reason: string } {
  const { ast, declaration, facts } = input;
  const definition = input.projectTypes.definitionForDeclaration(declaration);
  const typeParameterNodes = (definition === undefined ? ast.typeParameters(declaration)
    : definition.genericParameters.map(parameter => parameter.declaration)).filter(
    (candidate): candidate is Node => candidate !== undefined &&
      input.sourceLifetimes.parameterFor(candidate)?.kind !== "lifetime",
  );
  const typeParameters = typeParameterNodes.map(parameter => input.sourceLifetimes.parameterFor(parameter));
  if (typeParameters.some(parameter => parameter?.kind !== "type")) {
    return {
      kind: "rejected",
      reason: "A Rust callable type parameter has no exact target identity.",
    };
  }
  const ownParameters = typeParameters.flatMap(parameter => parameter?.kind === "type" ? [rustTypeParameterFromSourceContract(parameter)] : []);
  const exactNames = ownParameters.map(parameter => parameter.identity);
  const capturedParameters = new Map<string, Extract<TargetTypeRef, { readonly kind: "type-parameter" }>>();
  for (let ancestor = ast.parent(declaration); ancestor !== undefined; ancestor = ast.parent(ancestor)) {
    if (!isRustIndependentCallable(ast, ancestor) && !isRustGenericTypeDeclaration(ast, ancestor)) continue;
    for (const parameter of ast.typeParameters(ancestor)) {
      if (parameter === undefined || input.sourceLifetimes.parameterFor(parameter)?.kind === "lifetime") continue;
      const selected = input.sourceLifetimes.parameterFor(parameter);
      if (selected?.kind !== "type") return { kind: "rejected", reason: "A captured Rust type parameter has no exact target identity." };
      if (!exactNames.includes(selected.identity)) capturedParameters.set(selected.identity, rustTypeParameterFromSourceContract(selected));
    }
  }
  const declared = new Set([...exactNames, ...capturedParameters.keys()]);
  const projections = createRustProjectProjectionRequirementCollector(declared, input.projectTypes);
  const byParameter = new Map([...declared].map((name) =>
    [name, new Set<RustGenericRequirement>()] as const));
  const optionalStorage = createRustOptionalStorageCollector(new Set(exactNames), declared, byParameter);
  if (definition !== undefined) {
    const dispatchLifetime = input.objectRepresentations.representationFor(definition)?.dispatchObjectLifetime;
    for (const name of exactNames) {
      byParameter.get(name)!.add("clone");
      if (dispatchLifetime?.kind === "static") byParameter.get(name)!.add("static");
    }
  }
  const uses: RequirementUse[] = [];
  const dependencies = new Set<string>();
  const associated = createRustAssociatedRequirementCollector(declared, input.typeFamilies,
    (carrier, requirements) => classifyCarrierRequirements(carrier, requirements, declared, byParameter, associated.require, input.typeDefinitions));
  const addUse = (
    node: Node,
    carrier: TargetTypeRef | undefined,
    requirements: readonly RustGenericRequirement[],
    nativeStorage = false,
  ): string | undefined => {
    if (carrier === undefined) {
      return "A Rust generic requirement has no exact target carrier.";
    }
    if (!optionalStorage.collect(carrier)) return "A native optional storage projection has no exact generic owner.";
    const normalized = normalizeRustGenericRequirements(requirements);
    const requiredCarrier = nativeStorage && normalized.includes("static")
      ? substituteElidedLifetime(carrier, rustStaticLifetime) : carrier;
    const classified = classifyCarrierRequirements(
      requiredCarrier,
      normalized,
      declared,
      byParameter,
      associated.require,
      input.typeDefinitions,
    );
    if (!classified) {
      return `A generated Rust operation requires ${rustRequirementDescription(normalized)} that its exact target carrier does not provide.`;
    }
    if (!uses.some((use) => use.node === node &&
      rustTargetTypeRefEquals(use.carrier, carrier) &&
      stringListsEqual(use.requirements, normalized))) {
      uses.push(Object.freeze({ node, carrier, requirements: normalized,
        ...(rustTargetTypeRefEquals(carrier, requiredCarrier) ? {} : { nativeStorageCarrier: requiredCarrier }),
      }));
    }
    return undefined;
  };
  const generator = facts.getFact(declaration, rustGeneratorFactKey);
  if (generator !== undefined) {
    if (generator.storage.kind === "static" && generator.ownedReceiver !== undefined) {
      const receiverError = addUse(declaration, generator.ownedReceiver.carrier, ["static"]);
      if (receiverError !== undefined) return { kind: "rejected", reason: receiverError };
    }
    if (generator.storage.kind !== "lifetime") {
      for (const parameter of generator.capturedParameters) {
        const error = addUse(
          parameter,
          facts.getFact(parameter, rustSourceParameterAbiFactKey)?.parameterCarrier,
          ["static"],
        );
        if (error !== undefined) {
          return { kind: "rejected", reason: error };
        }
      }
      for (const carrier of [generator.yieldType, generator.returnType, generator.nextType]) {
        const error = addUse(declaration, carrier, ["static"]);
        if (error !== undefined) {
          return { kind: "rejected", reason: error };
        }
      }
    }
  }
  const asynchronous = facts.getFact(declaration, rustAsyncFunctionFactKey);
  if (asynchronous?.kind === "js-promise") {
    const error = addUse(
      declaration,
      asynchronous.outputCarrier,
      asynchronous.storage.kind === "static" ? ["clone", "static"] : ["clone"],
    );
    if (error !== undefined) {
      return { kind: "rejected", reason: error };
    }
    if (asynchronous.storage.kind === "static") {
      if (asynchronous.ownedReceiver !== undefined) {
        const receiverError = addUse(declaration, asynchronous.ownedReceiver.carrier, ["static"]);
        if (receiverError !== undefined) return { kind: "rejected", reason: receiverError };
      }
      for (const parameter of asynchronous.capturedParameters) {
        const parameterError = addUse(
          parameter,
          facts.getFact(parameter, rustSourceParameterAbiFactKey)?.parameterCarrier,
          ["static"],
        );
        if (parameterError !== undefined) {
          return { kind: "rejected", reason: parameterError };
        }
      }
    }
  }
  const visit = (node: Node): string | undefined => {
    if (node !== declaration && (isRustIndependentCallable(ast, node) || isRustGenericTypeDeclaration(ast, node))) {
      const nestedId = input.idByDeclaration.get(node);
      if (nestedId !== undefined) {
        dependencies.add(nestedId);
        for (const parameter of input.contractFor(node)?.capturedTypeParameters ?? []) {
          if (parameter.requirements.length === 0) continue;
          const error = addUse(node, { kind: "type-parameter", identity: parameter.identity, name: parameter.name }, parameter.requirements);
          if (error !== undefined) return error;
        }
        const nestedClass = input.projectTypes.definitionForDeclaration(node);
        for (const parameter of nestedClass?.genericParameters ?? []) {
          if (parameter.kind !== "type" || ast.parent(parameter.declaration) === node) continue;
          const requirements = input.contractFor(node)?.typeParameters.find(candidate => candidate.identity === parameter.identity)?.requirements ?? [];
          const error = addUse(node, { kind: "type-parameter", identity: parameter.identity, name: parameter.targetName }, requirements);
          if (error !== undefined) return error;
        }
        for (const requirement of input.contractFor(node)?.associatedTypes ?? []) {
          if (!rustTargetTypeParameterIdentities(requirement.carrier).every(name => declared.has(name))) continue;
          if (!associated.collect(requirement.carrier)) return "A captured associated output has no enclosing generic contract.";
          if (requirement.fieldAccess !== undefined && !associated.requireField(requirement.carrier, requirement.fieldAccess)) {
            return "A captured field operation has no enclosing native field contract.";
          }
          const error = addUse(node, requirement.carrier, requirement.requirements);
          if (error !== undefined) return error;
        }
        for (const requirement of input.contractFor(node)?.projectProjections ?? []) {
          if (![requirement.sourceCarrier, requirement.targetCarrier].flatMap(rustTargetTypeParameterIdentities).every(name => declared.has(name))) continue;
          if (!projections.require(requirement)) return "A captured projection has no exact enclosing native conversion contract.";
        }
        for (const requirement of input.contractFor(node)?.optionalStorage ?? []) {
          if (!rustTargetTypeParameterIdentities(requirement.carrier).every(name => declared.has(name))) continue;
          const error = addUse(node, requirement.carrier, requirement.requirements);
          if (error !== undefined) return error;
        }
      }
      return undefined;
    }
    const collectType = (carrier: TargetTypeRef): string | undefined => {
      if (!optionalStorage.collect(carrier)) return "A native optional storage projection has no exact generic owner.";
      if (!associated.collect(carrier)) return "A dependent Rust type has no exact family implementation or generic obligation.";
      const sourceType = rustSourceTypeCarrierValue(carrier);
      const definition = sourceType === undefined ? undefined : input.projectTypes.definitionForCarrier(carrier);
      if (definition !== undefined && definition.declaration !== declaration) {
        const dependency = input.idByDeclaration.get(definition.declaration);
        if (dependency !== undefined) {
          dependencies.add(dependency);
          const parameters = definition.genericParameters;
          const arguments_ = sourceType!.genericArguments;
          if (parameters.length !== arguments_.length) return "A source type family use has inconsistent generic class arity.";
          const substitutions = new Map<string, TargetTypeRef>();
          for (const [index, parameter] of parameters.entries()) {
            const argument = arguments_[index];
            if (argument?.kind !== parameter.kind) return "A source type family use lost a class generic parameter kind.";
            if (parameter.kind === "type" && argument.kind === "type") substitutions.set(parameter.identity, argument.type);
          }
          const contract = input.contractFor(definition.declaration);
          for (const requirement of contract?.projectProjections ?? []) {
            if (!projections.require({
              sourceCarrier: substituteRustTargetTypeParameters(requirement.sourceCarrier, substitutions),
              targetCarrier: substituteRustTargetTypeParameters(requirement.targetCarrier, substitutions),
            })) return "A generic class argument does not satisfy its exact native projection contract.";
          }
          for (const parameter of contract?.typeParameters ?? []) {
            if (parameter.requirements.length === 0) continue;
            const argument = substitutions.get(parameter.identity);
            if (argument === undefined) return "A generic class use lost its required type argument.";
            const error = addUse(node, argument, parameter.requirements);
            if (error !== undefined) return error;
          }
          for (const requirement of contract?.associatedTypes ?? []) {
            const instantiated = substituteRustTargetTypeParameters(requirement.carrier, substitutions);
            if (!associated.collect(instantiated)) return "A generic class argument does not satisfy its dependent type contract.";
            if (requirement.fieldAccess !== undefined && (instantiated.kind !== "associated-type" ||
              !associated.requireField(instantiated, requirement.fieldAccess))) return "A generic class argument does not satisfy its field access contract.";
            const error = addUse(node, instantiated, requirement.requirements);
            if (error !== undefined) return error;
          }
          for (const requirement of contract?.optionalStorage ?? []) {
            const instantiated = substituteRustTargetTypeParameters(requirement.carrier, substitutions);
            const error = addUse(node, instantiated, requirement.requirements);
            if (error !== undefined) return error;
          }
        }
      }
      for (const child of rustTargetTypeChildren(carrier)) {
        const error = collectType(child);
        if (error !== undefined) return error;
      }
      return undefined;
    };
    const carrier = facts.getRuntimeCarrierFact(node)?.carrier;
    const bindingProjection = facts.getFact(node, rustBindingProjectionFactKey);
    for (const copied of bindingProjection === undefined ? [] : rustBindingProjectionCloneCarriers(bindingProjection)) {
      const error = addUse(node, copied, ["clone"]);
      if (error !== undefined) return error;
    }
    for (const signatureCarrier of [
      facts.getFact(node, rustSourceCallableReturnFactKey)?.returnCarrier,
      facts.getFact(node, rustSourceParameterAbiFactKey)?.parameterCarrier,
      facts.getFact(node, rustBindingProjectionFactKey)?.storageCarrier,
    ]) {
      if (signatureCarrier === undefined) continue;
      const error = collectType(signatureCarrier);
      if (error !== undefined) return error;
    }
    if (carrier !== undefined && ast.is.IsIdentifier(node) &&
      !input.valueLifetimes.canMove(node) &&
      (isRustReturnedValue(node, declaration, ast) || input.isStoredValue(node))) {
      const error = addUse(node, carrier, ["clone"]);
      if (error !== undefined) return error;
    }
    const sourceCall = facts.getFact(node, rustTargetOperationFactKey);
    const resultProjection = sourceCall?.kind === "source-call" ? sourceCall.resultProjection : undefined;
    if (resultProjection !== undefined && !projections.require({
      sourceCarrier: resultProjection.sourceCarrier, targetCarrier: resultProjection.targetCarrier,
    })) return "A selected call result has no closed native projection or generic obligation.";
    const downcast = facts.getFact(node, rustProjectDowncastFactKey);
    const flowProjection = facts.getFact(node, rustFlowReadProjectionFactKey);
    const projectProjection = downcast === undefined ? flowProjection?.kind === "project-downcast"
      ? { sourceCarrier: flowProjection.dispatchCarrier, targetCarrier: flowProjection.selectedCarrier } : undefined
      : { sourceCarrier: downcast.dispatchCarrier, targetCarrier: downcast.targetCarrier };
    if (projectProjection !== undefined) {
      if (!projections.require(projectProjection)) return "A checked project projection has no closed native conversion or generic obligation.";
      if (flowProjection?.kind === "project-downcast" && flowProjection.projection?.kind === "structural") {
        const error = addUse(node, projectProjection.targetCarrier, ["static"]);
        if (error !== undefined) return error;
      }
      for (const projectionCarrier of [projectProjection.sourceCarrier, projectProjection.targetCarrier]) {
        const error = collectType(projectionCarrier);
        if (error !== undefined) return error;
      }
    }
    if (carrier !== undefined && !isRustDeclarationPathUse(node, ast, facts)) {
      const error = collectType(carrier);
      if (error !== undefined) return error;
      if (ast.kindName(node) === "KindPropertyDeclaration" && (carrier.kind === "associated-type" ||
        carrier.kind === "type-parameter" && carrier.optionalStorageValue !== undefined)) {
        const fieldError = addUse(node, carrier, ["clone"]);
        if (fieldError !== undefined) return fieldError;
      }
    }
    const indexedField = facts.getFact(node, rustTargetOperationFactKey);
    if (indexedField?.kind === "source-indexed-field" && !associated.requireField(indexedField.resultCarrier,
      indexedField.accessMode === "read-write" ? ["read", "write"] : [indexedField.accessMode])) {
      return "A dependent field operation has no exact read/write trait obligation.";
    }
    const location = facts.getFact(node, rustBindingStorageFactKey);
    const objectView = facts.getFact(node, rustObjectReferenceViewKey);
    if (objectView !== undefined) {
      const error = addUse(node, objectView.sourceCarrier, ["clone", "static"]);
      if (error !== undefined) return error;
      for (const field of objectView.kind === "structural" ? objectView.fields : []) {
        const fieldError = addUse(node, field.source.resultCarrier, ["clone", "static"]);
        if (fieldError !== undefined) return fieldError;
      }
    }
    if (location?.storage === "location") {
      const error = addUse(node, location.valueCarrier, ["clone", "static"], true);
      if (error !== undefined) return error;
    }
    const typedLocation = facts.getFact(node, rustTypedLocationPlanKey);
    if (typedLocation?.operation === "allocate" || typedLocation?.operation === "address-of") {
      const error = addUse(node, typedLocation.pointeeCarrier, ["clone", "static"]);
      if (error !== undefined) return error;
    }
    if (typedLocation?.operation === "bind-pointer" || typedLocation?.operation === "project-pointer" ||
      typedLocation?.operation === "view-pointer") {
      const error = addUse(node, typedLocation.pointeeCarrier, ["static"]);
      if (error !== undefined) return error;
      if (typedLocation.operation === "project-pointer" || typedLocation.operation === "view-pointer") {
        const sourceError = addUse(node, typedLocation.sourcePointeeCarrier, ["static"]);
        if (sourceError !== undefined) return sourceError;
      } else {
        const identity = facts.getRuntimeCarrierFact(typedLocation.identityExpression)?.carrier;
        if (identity !== undefined) {
          const identityError = addUse(node, identity, ["static"]);
          if (identityError !== undefined) return identityError;
        }
      }
      const callbacks = typedLocation.operation === "project-pointer"
        ? [typedLocation.fromSourceExpression, typedLocation.toSourceExpression]
        : [typedLocation.readExpression, typedLocation.writeExpression];
      for (const callback of callbacks) {
        const captures = facts.getFact(callback, rustClosureCaptureFactKey);
        for (const capture of captures?.captures ?? []) {
          const captureError = addUse(capture.reference, capture.carrier, ["static"]);
          if (captureError !== undefined) return captureError;
        }
      }
    }
    const operation = facts.getFact(node, rustTargetOperationFactKey);
    if (operation?.kind === "array-literal" && operation.contributions.some(contribution => contribution.kind === "spread")) {
      const error = addUse(node, operation.elementCarrier, ["clone"]);
      if (error !== undefined) return error;
    }
    if (operation?.kind === "source-index-signature" &&
      (operation.accessMode === "read" || operation.accessMode === "read-write")) {
      const requirements: readonly RustGenericRequirement[] = operation.storage.kind === "record" &&
        (rustOptionElementCarrier(operation.resultCarrier) !== undefined || isRustJsValueCarrier(operation.resultCarrier))
        ? ["clone", "default"] : ["clone"];
      const error = addUse(node, operation.resultCarrier, requirements);
      if (error !== undefined) return error;
    }
    if (operation?.kind === "record-index-literal" && operation.contributions.some(contribution => contribution.kind === "spread")) {
      const error = addUse(node, operation.valueCarrier, ["clone"]);
      if (error !== undefined) return error;
    }
    if ((operation?.kind === "source-field" || operation?.kind === "source-union-field") &&
      operation.accessMode !== "write") {
      const fields = operation.kind === "source-field" ? [operation]
        : operation.selectedVariantIndexes.map(index => operation.variants[index]?.field);
      if (fields.some(field => field?.storage === "structural-object" && field.valueSemantics.kind === "stored")) {
        const error = addUse(node, operation.resultCarrier, ["clone"]);
        if (error !== undefined) return error;
      }
    }
    if (operation?.kind === "nullish-assignment") {
      const parent = ast.parent(node);
      if (parent === undefined || ast.kindName(parent) !== KindExpressionStatement) {
        const error = addUse(node, operation.rightCarrier, ["clone"]);
        if (error !== undefined) return error;
      }
    }
    if (operation?.kind === "iteration" && operation.iterationKind !== "for-in") {
      const iterable = Node_Expression(ast, node);
      const iterableCarrier = iterable === undefined ? undefined : facts.getRuntimeCarrierFact(iterable)?.carrier;
      if (operation.lowering.kind === "js-array" ||
        operation.lowering.kind === "borrowed" && operation.lowering.style === "cloned" ||
        operation.lowering.kind === "receiver-method" && rustJsArrayEntriesElementTargetType(iterableCarrier) !== undefined) {
        const error = addUse(node, operation.elementCarrier, ["clone"]);
        if (error !== undefined) return error;
      }
    }
    for (const operand of facts.getFact(node, rustGenericNumericOperandsKey) ?? []) {
      const error = addUse(node, operand, ["source-numeric"]);
      if (error !== undefined) return error;
    }
    if (ast.kindName(node) === KindBinaryExpression) {
      const parent = ast.parent(node);
      const assignment = operation?.kind === "runtime-set" ||
        (operation?.kind === "operator-token" || operation?.kind === "operator-call") &&
        isRustAssignmentOperator(operation.operator);
      if (assignment &&
          (parent === undefined || ast.kindName(parent) !== KindExpressionStatement)) {
        const carrier = rustValueCarrierBeforeOptionProjection(facts, node);
        if (carrier !== undefined) {
          const error = addUse(node, carrier, ["clone"]);
          if (error !== undefined) return error;
        }
      }
    }
    const projection = facts.getFact(node, rustFlowReadProjectionFactKey);
    if (projection?.kind === "option-value" || projection?.kind === "source-union") {
      const error = addUse(node, projection.selectedCarrier, ["clone"]);
      if (error !== undefined) return error;
    }
    if (operation?.kind === "provider-operation") {
      for (const argument of operation.abi.sourceArguments) {
        if (argument.disposition !== "runtime" || argument.mode !== "value" ||
          argument.form !== "value" || isRustCopyCarrier(argument.carrier)) continue;
        const expression = ast.arguments(node)[argument.sourceIndex];
        if (expression === undefined || !ast.is.IsIdentifier(expression) ||
          input.valueLifetimes.canMove(expression)) continue;
        const error = addUse(expression, argument.carrier, ["clone"]);
        if (error !== undefined) return error;
      }
      for (const requirement of operation.carrierRequirements ?? []) {
        const error = addUse(node, requirement.carrier, [requirement.requirement]);
        if (error !== undefined) return error;
      }
    }
    if (ast.kindName(node) === "KindAwaitExpression") {
      const operand = Node_Expression(ast, node);
      const operandCarrier = operand === undefined
        ? undefined
        : facts.getRuntimeCarrierFact(operand)?.carrier;
      const future = operand === undefined
        ? undefined
        : facts.getFact(operand, rustFutureValueFactKey);
      const futureCarrier = rustAwaitCarrier(operandCarrier)?.futureCarrier;
      if (futureCarrier?.kind === "target-named" &&
        futureCarrier.id === rustJsPromiseTargetId && future !== undefined) {
        const error = addUse(node, future.outputCarrier, ["clone"]);
        if (error !== undefined) return error;
      }
    }
    if (operation?.kind === "default-value") {
      const error = addUse(node, operation.resultCarrier, ["default"]);
      if (error !== undefined) return error;
    }
    if (operation?.kind === "closure") {
      const captures = facts.getFact(node, rustClosureCaptureFactKey);
      if (captures === undefined) {
        return "A Rust closure has no exact capture classification.";
      }
      const required: readonly RustGenericRequirement[] =
        rustClosureProtocol(operation.resultCarrier) === undefined && rustGenericCallableValue(operation.resultCarrier) === undefined
          ? ["clone", "static"]
          : ["clone"];
      for (const capture of captures.captures) {
        const error = addUse(capture.reference, capture.carrier,
          capture.storage === "cell" || capture.storage === "borrow-cell" ||
            input.valueLifetimes.canMoveCapture(node, capture.declaration)
            ? required.filter(requirement => requirement !== "clone") : required, true);
        if (error !== undefined) return error;
      }
    }
    if (ast.kindName(node) === "KindClassDeclaration" || ast.kindName(node) === "KindClassExpression") {
      for (const capture of facts.getFact(node, rustClosureCaptureFactKey)?.captures ?? []) {
        if (input.valueLifetimes.canMoveCapture(node, capture.declaration)) continue;
        const error = addUse(node, capture.carrier, ["clone"]);
        if (error !== undefined) return error;
      }
    }
    const yieldFact = facts.getFact(node, rustYieldFactKey);
    if (yieldFact?.kind === "delegate") {
      const delegated = getRustGeneratorProtocol(yieldFact.delegatedCarrier);
      if (delegated === undefined) {
        return "A delegated Rust generator yield has no exact generator protocol.";
      }
      const nextError = addUse(node, delegated.nextType, ["default"]);
      if (nextError !== undefined) return nextError;
      const returnError = addUse(node, delegated.returnType, ["clone"]);
      if (returnError !== undefined) return returnError;
    }
    if (operation?.kind === "source-call") {
      for (const parameter of operation.parameters) {
        if (parameter.mode !== "value") continue;
        for (const argument of parameter.inputs) {
          if (argument.sourceForm !== "value") continue;
          const expression = ast.arguments(node)[argument.sourceArgumentIndex];
          if (expression === undefined || !ast.is.IsIdentifier(expression) ||
            input.valueLifetimes.canMove(expression)) continue;
          const argumentCarrier = facts.getRuntimeCarrierFact(expression)?.carrier;
          if (argumentCarrier === undefined || isRustCopyCarrier(argumentCarrier)) continue;
          const error = addUse(expression, argumentCarrier, ["clone"]);
          if (error !== undefined) return error;
        }
      }
      const selected = facts.getSelectedTargetCall(node);
      if (selected?.sourceDeclaration !== undefined) {
        const selectedDeclaration = input.implementationDeclaration(
          selected.sourceDeclaration,
        );
        const calleeId = input.idByDeclaration.get(selectedDeclaration);
        const selectedClass = input.projectTypes.definitionForDeclaration(selectedDeclaration);
        const targetTypeArguments = rustTargetGenericTypeArguments(
          selectedClass !== undefined && operation.target.form === "constructor"
            ? rustSourceTypeCarrierValue(operation.target.typeCarrier)?.genericArguments
            : operation.targetGenericArguments,
        );
        if (calleeId !== undefined) {
          dependencies.add(calleeId);
          const callee = input.contractFor(selectedDeclaration);
          if (callee !== undefined && callee.typeParameters.length > 0) {
            if (callee.typeParameters.length !== targetTypeArguments.length) {
              return "A selected Rust source call has inconsistent generic contract arity.";
            }
            for (let index = 0; index < callee.typeParameters.length; index += 1) {
              const requirements = callee.typeParameters[index]!.requirements;
              if (requirements.length === 0) continue;
              const error = addUse(node, targetTypeArguments[index], requirements);
              if (error !== undefined) return error;
            }
            const substitutions = new Map(callee.typeParameters.map((parameter, index) =>
              [parameter.identity, targetTypeArguments[index]!] as const));
            for (const requirement of callee.optionalStorage) {
              const error = addUse(node, substituteRustTargetTypeParameters(requirement.carrier, substitutions), requirement.requirements);
              if (error !== undefined) return error;
            }
            for (const requirement of callee.projectProjections) {
              if (!projections.require({ sourceCarrier: substituteRustTargetTypeParameters(requirement.sourceCarrier, substitutions),
                targetCarrier: substituteRustTargetTypeParameters(requirement.targetCarrier, substitutions) })) {
                return "A generic call does not satisfy its exact native projection contract.";
              }
            }
            for (const requirement of callee.associatedTypes) {
              const carrier = substituteRustTargetTypeParameters(requirement.carrier, substitutions);
              const collected = collectType(carrier);
              if (collected !== undefined) return collected;
              if (requirement.fieldAccess !== undefined && (carrier.kind !== "associated-type" ||
                !associated.requireField(carrier, requirement.fieldAccess))) return "A generic call does not satisfy its selected field access contract.";
              const error = addUse(node, carrier, requirement.requirements);
              if (error !== undefined) return error;
            }
          }
        }
      }
    }
    let childError: string | undefined;
    ast.forEachChild(node, (child) => {
      if (child !== undefined && childError === undefined) {
        childError = visit(child);
      }
    });
    return childError;
  };
  const error = visit(declaration);
  if (error !== undefined) {
    return { kind: "rejected", reason: error };
  }
  return {
    kind: "resolved",
    dependencies: Object.freeze([...dependencies]),
    contract: Object.freeze({
      declaration,
      associatedTypes: associated.seal(),
      projectProjections: projections.seal(),
      optionalStorage: optionalStorage.seal(),
      typeParameters: Object.freeze(ownParameters.map((parameter) => Object.freeze({
        identity: parameter.identity, name: parameter.name,
        requirements: normalizeRustGenericRequirements([...(byParameter.get(parameter.identity) ?? [])]),
      }))),
      capturedTypeParameters: Object.freeze([...capturedParameters.values()].map((parameter) => Object.freeze({
        identity: parameter.identity, name: parameter.name,
        requirements: normalizeRustGenericRequirements([...(byParameter.get(parameter.identity) ?? [])]),
      }))),
      uses: Object.freeze(uses),
    }),
  };
}


function rustRequirementDescription(
  requirements: readonly RustGenericRequirement[],
): string {
  const descriptions = requirements.map((requirement) =>
    requirement === "clone"
      ? "an exact Rust Clone implementation"
      : requirement === "default"
        ? "an exact Rust Default implementation"
        : requirement === "source-numeric" ? "an exact source numeric comparison contract"
        : "an exact Rust 'static lifetime");
  if (descriptions.length <= 1) return descriptions[0] ?? "an exact Rust carrier contract";
  return `${descriptions.slice(0, -1).join(", ")} and ${descriptions[descriptions.length - 1]}`;
}
