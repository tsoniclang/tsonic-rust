import type { RustCallableRequirementInput } from "./generic-callable-requirements-model.js";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import { collectRustSourceCallRequirements } from "./generic-call-requirement-uses.js";

import { rustGenericCallableValue } from "../../target-model/types/carriers/generic-callables.js";
import { rustFrameCallableValue } from "../../target-model/types/carriers/frame-callables.js";
import { rustOptionElementCarrier } from "../../target-model/types/carriers/optional.js";

import { rustCallableInputProtocol, rustCallableProtocol, rustLocationTargetType } from "../../target-model/types/carriers/callables.js";

import type { Node } from "@tsonic/tsts";

import { createRustOptionalStorageCollector } from "./type-projections.js";
import { isRustBorrowedValueRead, isRustDeclarationPathUse, isRustReturnedValue, isRustIndependentCallable, isRustGenericTypeDeclaration } from "./generic-reference-uses.js";
import { createRustAssociatedRequirementCollector } from "./associated-requirements.js";

import type { RustProjectTypePolicy } from "../project-types/index.js";
import { mapRustTargetTypes, substituteRustTargetTypeParameters } from "../../target-model/types/carriers/substitution.js";
import { rustTypeFamilyNormalizer } from "../project-types/type-family-normalization.js";
import { rustTargetTypeChildren } from "../../target-model/types/carriers/children.js";
import { rustJsArrayEntriesElementTargetType } from "../../target-model/types/carriers/array-entries.js";
import { rustJsArrayLikeElementTargetType } from "../../target-model/types/carriers/js.js";
import { rustTargetTypeParameterIdentities } from "../../target-model/types/carriers/generic-references.js";

import { createRustProjectProjectionRequirementCollector } from "./project-projection-requirements.js";

import { ElementAccessExpression_ArgumentExpression, KindBinaryExpression, KindExpressionStatement, Node_Expression, sourceParameterIsProperty } from "@tsonic/target-api/source";
import { rustEffectiveValueCarrier, rustValueCarrierBeforeOptionProjection } from "../conversions/value-carrier-queries.js";
import { isRustAssignmentOperator } from "../../target-model/syntax/tokens.js";

import { rustValueConversionContract } from "../../policy/conversions/contracts.js";
import { rustContextualRuntimeConversionContract } from "../../policy/conversions/contextual.js";
import { rustPhysicalPayloadFor } from "../../policy/conversions/physical-payloads.js";
import { rustMemberAccessReceiver } from "../../target-model/syntax/expressions.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { isClosedMetadata, isDenseDataArray } from "../../target-model/metadata/closed-data.js";
import { isRustFinalizedArrayInput, isRustFinalizedSliceInput } from "../../target-model/operations/finalized-inputs.js";
import { getRustGeneratorProtocol, rustClosureProtocol, rustSourceTypeCarrierValue } from "../../target-model/types/index.js";
import { isRustCopyCarrier } from "../../policy/constraints/native-traits.js";
import { rustRecordReadAdmitsAbsence } from "../../target-model/types/carriers/records.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { rustBindingProjectionCloneCarriers } from "../../policy/types/storage/binding-normalization.js";

import { rustAwaitValueRequirements } from "../../policy/ownership/await-values.js";
import { rustAwaitSelectionLeaves } from "../../target-model/types/await.js";

import type { RustGenericRequirement } from "../../target-model/records/generic-requirements.js";

import { rustProjectViewBindings } from "../../policy/types/objects/project-view-bindings.js";
import { rustStructuralViewRequirementUses } from "./structural-view-requirements.js";

interface CallableRequirementVisitState {
  readonly declared: ReadonlySet<string>;
  readonly dependencies: Set<string>;
  readonly definition: ReturnType<RustProjectTypePolicy["definitionForDeclaration"]>;
  readonly normalizeFamily: ReturnType<typeof rustTypeFamilyNormalizer>;
  readonly optionalStorage: ReturnType<typeof createRustOptionalStorageCollector>;
  readonly associated: ReturnType<typeof createRustAssociatedRequirementCollector>;
  readonly projections: ReturnType<typeof createRustProjectProjectionRequirementCollector>;
  readonly addUse: (node: Node, carrier: TargetTypeRef | undefined, requirements: readonly RustGenericRequirement[], nativeStorage?: boolean) => string | undefined;
}


export function createRustCallableRequirementVisitor(input: RustCallableRequirementInput, state: CallableRequirementVisitState): (node: Node) => string | undefined {
  const { ast, declaration, records } = input;
  const { declared, dependencies, definition, normalizeFamily, optionalStorage, associated, projections, addUse } = state;
  // A capture whose physical carrier is Copy is read by copy (analysis/ownership/reads.ts), so it needs no Clone bound.
  const copiedCapture = (capture: { readonly storage: string; readonly carrier: TargetTypeRef }): boolean =>
    isRustCopyCarrier(capture.storage === "location" ? rustLocationTargetType(capture.carrier) : capture.carrier,
      selected => input.genericCallables.definitionFor(selected)?.copy === true);
  const addPhysicalCloneUse = (node: Node): string | undefined => {
    const selected = input.nativeStorage.operandFor(node);
    if (selected.kind === "unresolved") return selected.reason;
    return isRustCopyCarrier(selected.carrier, carrier => input.genericCallables.definitionFor(carrier)?.copy === true)
      ? undefined : addUse(node, selected.carrier, ["clone"]);
  };
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
        for (const parameter of input.contractFor(node)?.nativeInputs ?? []) {
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
          if (requirement.fieldAccess !== undefined && !associated.requireField(requirement.carrier, requirement.fieldAccess, requirement.output)) {
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
      carrier = mapRustTargetTypes(carrier, normalizeFamily);
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
              !associated.requireField(instantiated, requirement.fieldAccess, requirement.output === undefined ? undefined :
                substituteRustTargetTypeParameters(requirement.output, substitutions)))) return "A generic class argument does not satisfy its field access contract.";
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
    if (node === declaration && definition !== undefined) {
      for (const inherited of input.projectTypes.directSupertypes(input.projectTypes.openCarrier(definition)) ?? []) {
        const inheritedError = collectType(inherited);
        if (inheritedError !== undefined) return inheritedError;
      }
      for (const view of input.structuralViewsFor(declaration)) {
        const viewError = collectType(view.targetCarrier);
        if (viewError !== undefined) return viewError;
      }
    }
    const carrier = records.runtimeCarrier.get(node)?.carrier;
    const bindingProjection = records.bindingProjection.get(node);
    for (const copied of bindingProjection === undefined ? [] : rustBindingProjectionCloneCarriers(bindingProjection)) {
      const error = addUse(node, copied, ["clone"]);
      if (error !== undefined) return error;
    }
    for (const signatureCarrier of [
      records.sourceCallableReturn.get(node)?.returnCarrier,
      records.sourceParameterAbi.get(node)?.parameterCarrier,
      bindingProjection !== undefined && "storageCarrier" in bindingProjection ? bindingProjection.storageCarrier : undefined,
    ]) {
      if (signatureCarrier === undefined) continue;
      const error = collectType(signatureCarrier);
      if (error !== undefined) return error;
    }
    if (carrier !== undefined && ast.is.IsIdentifier(node) &&
      !input.ownershipFlow.movingReads.has(node) &&
      (isRustReturnedValue(node, declaration, ast) || input.isStoredValue(node))) {
      const error = addUse(node, carrier, ["clone"]);
      if (error !== undefined) return error;
    }
    const sourceCall = records.targetOperation.get(node);
    const resultProjection = sourceCall?.kind === "source-call" ? sourceCall.resultProjection : undefined;
    if (resultProjection?.kind === "project-downcast" && !projections.require({
      sourceCarrier: resultProjection.dispatchCarrier, targetCarrier: resultProjection.selectedCarrier,
    })) return "A selected call result has no closed native projection or generic obligation.";
    const downcast = records.projectDowncast.get(node);
    const flowProjection = records.flowReadProjection.get(node);
    const unionProject = flowProjection?.kind === "source-union" || flowProjection?.kind === "runtime-union"
      ? flowProjection.project : undefined;
    const projectProjection = downcast === undefined ? flowProjection?.kind === "project-downcast"
      ? { sourceCarrier: flowProjection.dispatchCarrier, targetCarrier: flowProjection.selectedCarrier } : unionProject
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
    if (carrier !== undefined && input.readsValue(node) && !isRustDeclarationPathUse(node, ast, records)) {
      const error = collectType(carrier);
      if (error !== undefined) return error;
      const propertyDeclaration = ast.kindName(node) === "KindPropertyDeclaration" || sourceParameterIsProperty(ast, node);
      const owner = propertyDeclaration ? input.projectTypes.definitionContainingDeclaration(node) : undefined;
      const ownedDispatchRead = owner !== undefined && input.projectTypes.isPolymorphic(owner) &&
        input.objectRepresentations.aliasFor(node) === undefined;
      if (propertyDeclaration && (ownedDispatchRead || carrier.kind === "associated-type" ||
        carrier.kind === "type-parameter" && carrier.optionalStorageValue !== undefined)) {
        const fieldError = addUse(node, carrier, ["clone"]);
        if (fieldError !== undefined) return fieldError;
      }
    }
    const indexedField = records.targetOperation.get(node);
    if ((indexedField?.kind === "tuple-index" ||
      indexedField?.kind === "source-field" && indexedField.valueSemantics.kind === "stored") &&
      input.readsValue(node) && !input.ownershipFlow.movingReads.has(node) &&
      !isRustBorrowedValueRead(node, ast, records)) {
      const fieldError = addPhysicalCloneUse(node);
      if (fieldError !== undefined) return fieldError;
    }
    if (indexedField?.kind === "source-indexed-field" && !associated.requireField(indexedField.projection,
      indexedField.accessMode === "read-write" ? ["read", "write"] : [indexedField.accessMode], indexedField.resultCarrier)) {
      return "A dependent field operation has no exact read/write trait obligation.";
    }
    const location = records.bindingStorage.get(node);
    const objectView = records.objectReferenceView.get(node);
    if (objectView !== undefined) {
      const error = addUse(node, objectView.sourceCarrier, ["clone", "static"]);
      if (error !== undefined) return error;
      for (const field of objectView.kind === "structural" ? objectView.fields : []) {
        let storageCarrier = field.source.resultCarrier;
        if (field.source.storage === "structural-object") {
          const selected = input.structuralShapes.field(field.source.receiverCarrier, field.source.storageIndex);
          if (selected === undefined) return "An object reference view requires its exact completed native field storage.";
          const method = selected.methodPlan;
          storageCarrier = method?.kind === "fixed" ? method.context
            : method !== undefined ? method.carrier : selected.boundStorage?.carrier ?? selected.carrier;
        }
        const fieldError = addUse(node, storageCarrier, ["clone", "static"]);
        if (fieldError !== undefined) return fieldError;
      }
      if (objectView.kind === "project") {
        for (const view of input.structuralViewsFor(objectView.declaration)) {
          const bindings = rustProjectViewBindings(view, objectView.sourceCarrier, objectView.targetCarrier);
          if (bindings === undefined) continue;
          for (const use of rustStructuralViewRequirementUses(view, bindings)) {
            const fieldError = addUse(node, use.carrier, use.requirements);
            if (fieldError !== undefined) return fieldError;
          }
          break;
        }
      }
    }
    if (location?.storage === "location") {
      const error = addUse(node, location.valueCarrier, ["clone", "static"], true);
      if (error !== undefined) return error;
    }
    const typedLocation = records.typedLocationPlan.get(node);
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
        const identity = records.runtimeCarrier.get(typedLocation.identityExpression)?.carrier;
        if (identity !== undefined) {
          const identityError = addUse(node, identity, ["static"]);
          if (identityError !== undefined) return identityError;
        }
      }
      const callbacks = typedLocation.operation === "project-pointer"
        ? [typedLocation.fromSourceExpression, typedLocation.toSourceExpression]
        : [typedLocation.readExpression, typedLocation.writeExpression];
      for (const callback of callbacks) {
        const captures = records.closureCapture.get(callback);
        for (const capture of captures?.captures ?? []) {
          const captureError = addUse(capture.reference, capture.carrier, ["static"]);
          if (captureError !== undefined) return captureError;
        }
      }
    }
    const operation = records.targetOperation.get(node);
    if (operation?.kind === "array-literal") {
      for (const contribution of operation.contributions) {
        if (contribution.kind !== "spread") continue;
        for (const selected of contribution.input.inputs) {
          if (selected.kind === "empty") continue;
          const conversion = rustValueConversionContract(selected.conversion, input.typeDefinitions);
          if (conversion?.lowering !== "rest-sequence") return "An array spread has no exact sequence conversion contract.";
          for (const element of conversion.cloneSources) {
            const error = addUse(node, element, ["clone"]);
            if (error !== undefined) return error;
          }
        }
      }
    }
    if (operation?.kind === "source-index-signature" &&
      (operation.accessMode === "read" || operation.accessMode === "read-write")) {
      const requirements: readonly RustGenericRequirement[] = operation.storage.kind === "record" &&
        rustRecordReadAdmitsAbsence(operation.resultCarrier)
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
        const error = addPhysicalCloneUse(node);
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
      const iterableCarrier = iterable === undefined ? undefined : records.runtimeCarrier.get(iterable)?.carrier;
      if (operation.lowering.kind === "js-array" ||
        operation.lowering.kind === "borrowed" && operation.lowering.style === "cloned" ||
        operation.lowering.kind === "receiver-method" && rustJsArrayEntriesElementTargetType(iterableCarrier) !== undefined) {
        const error = addUse(node, operation.elementCarrier, ["clone"]);
        if (error !== undefined) return error;
      }
    }
    for (const operand of records.genericNumericOperands.get(node) ?? []) {
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
        const carrier = rustValueCarrierBeforeOptionProjection(records, node);
        if (carrier !== undefined) {
          const error = addUse(node, carrier, ["clone"]);
          if (error !== undefined) return error;
        }
      }
    }
    const projection = records.flowReadProjection.get(node);
    if ((projection?.kind === "option-value" || projection?.kind === "source-union") &&
      !input.ownershipFlow.movingReads.has(node)) {
      const error = addUse(node, projection.selectedCarrier, ["clone"]);
      if (error !== undefined) return error;
    }
    const providerOperations = operation?.kind === "provider-operation" ? [operation]
      : operation?.kind === "union-property" ? operation.variants.flatMap(variant => variant.operation === undefined ? [] : [variant.operation]) : [];
    for (const providerOperation of providerOperations) {
      for (const argument of providerOperation.abi.targetArguments) {
        if (!isRustFinalizedArrayInput(argument) && !isRustFinalizedSliceInput(argument)) continue;
        for (const element of argument.elements) {
          if (element.conversion.kind !== "semantic") continue;
          const conversion = rustValueConversionContract(element.conversion.conversion, input.typeDefinitions);
          if (conversion?.lowering !== "rest-sequence") continue;
          for (const carrier of conversion.cloneSources) {
            const error = addUse(node, carrier, ["clone"]);
            if (error !== undefined) return error;
          }
        }
      }
      for (const argument of providerOperation.abi.sourceArguments) {
        if (argument.disposition !== "runtime" || argument.mode !== "value" ||
          argument.form !== "value") continue;
        const expression = ast.is.IsCallExpression(node) || ast.is.IsNewExpression(node)
          ? ast.arguments(node)[argument.sourceIndex]
          : ast.is.IsElementAccessExpression(node) && argument.role === "index" && argument.sourceIndex === 0
            ? ElementAccessExpression_ArgumentExpression(ast, node) : undefined;
        if (expression === undefined || !ast.is.IsIdentifier(expression) ||
          input.ownershipFlow.movingReads.has(expression)) continue;
        const conversion = records.contextualValueConversion.get(expression);
        if (conversion !== undefined &&
          rustContextualRuntimeConversionContract(conversion.conversion, input.typeDefinitions)?.sourceMode === "ref") continue;
        const error = addPhysicalCloneUse(expression);
        if (error !== undefined) return error;
      }
      for (const requirement of providerOperation.carrierRequirements ?? []) {
        const source = requirement.source;
        if (source === undefined || source === null || !isClosedMetadata(source) || !isDenseDataArray(source.projection) ||
          source.projection.some(index => index !== "array-element" &&
            (typeof index !== "number" || !Number.isSafeInteger(index) || index < 0)) ||
          source.kind !== "receiver" && (source.kind !== "argument" ||
            !Number.isSafeInteger(source.sourceIndex) || source.sourceIndex < 0))
          return "A provider carrier requirement has no exact source input and component correspondence.";
        const sourceInput = source.kind === "receiver" ? providerOperation.abi.sourceReceiver
          : providerOperation.abi.sourceArguments.find(argument => argument.sourceIndex === source.sourceIndex);
        const expression = source.kind === "receiver"
          ? rustMemberAccessReceiver(ast, ast.is.IsCallExpression(node) || ast.is.IsNewExpression(node)
            ? Node_Expression(ast, node) : node)
          : ast.is.IsCallExpression(node) || ast.is.IsNewExpression(node) ? ast.arguments(node)[source.sourceIndex]
            : ast.is.IsElementAccessExpression(node) && source.sourceIndex === 0
              ? ElementAccessExpression_ArgumentExpression(ast, node) : undefined;
        if (expression === undefined || sourceInput === undefined || !("carrier" in sourceInput) ||
          sourceInput.disposition !== "runtime") return "A provider carrier requirement lost its original runtime source input.";
        const logical = rustEffectiveValueCarrier(records, expression);
        const physical = input.nativeStorage.valueFor(expression);
        if (physical.kind === "unresolved") return physical.reason;
        let logicalComponent: TargetTypeRef | undefined = sourceInput.carrier;
        let physicalComponent = logical === undefined ? undefined
          : rustPhysicalPayloadFor(logical, physical.carrier, sourceInput.carrier, input.typeDefinitions);
        for (const index of source.projection) {
          logicalComponent = logicalComponent === undefined ? undefined : index === "array-element"
            ? rustJsArrayLikeElementTargetType(logicalComponent) : rustTargetTypeChildren(logicalComponent)[index];
          physicalComponent = physicalComponent === undefined ? undefined : index === "array-element"
            ? rustJsArrayLikeElementTargetType(physicalComponent) : rustTargetTypeChildren(physicalComponent)[index];
        }
        if (logicalComponent === undefined || physicalComponent === undefined ||
          !rustTargetTypeRefEquals(logicalComponent, requirement.carrier))
          return "A provider carrier requirement conflicts with its selected source and physical component identity.";
        if (requirement.requirement === "clone" && source.kind === "receiver" &&
          providerOperation.abi.target.form === "index" && providerOperation.abi.result.kind === "sync" &&
          rustTargetTypeRefEquals(requirement.carrier, providerOperation.abi.result.rawCarrier) &&
          input.borrowFor(node) !== undefined) continue;
        const error = addUse(node, physicalComponent, [requirement.requirement]);
        if (error !== undefined) return error;
      }
    }
    if (ast.kindName(node) === "KindAwaitExpression") {
      const awaiting = records.awaitValue.get(node);
      if (awaiting !== undefined) {
        for (const leaf of rustAwaitSelectionLeaves(awaiting.selection)) {
          const requirements = rustAwaitValueRequirements(leaf);
          if (leaf.future === undefined || requirements.length === 0) continue;
          const error = addUse(node, leaf.future.outputCarrier, requirements);
          if (error !== undefined) return error;
        }
      }
    }
    if (operation?.kind === "default-value") {
      const error = addUse(node, operation.resultCarrier, ["default"]);
      if (error !== undefined) return error;
    }
    const sourceValue = records.sourceCallableValue.get(node);
    if (sourceValue !== undefined) {
      const captures = records.closureCapture.get(sourceValue.sourceDeclaration);
      const storage: readonly RustGenericRequirement[] = rustCallableProtocol(sourceValue.carrier)?.lifetime?.kind === "static"
        ? ["static"] : [];
      for (const capture of captures?.receivers ?? []) {
        const error = addUse(capture.reference, capture.carrier, ["clone", ...storage], true);
        if (error !== undefined) return error;
      }
      for (const capture of captures?.captures ?? []) {
        const move = capture.storage === "cell" || capture.storage === "borrow-cell" || copiedCapture(capture) ||
          input.ownershipFlow.captureTransfers.get(sourceValue.sourceDeclaration)?.has(capture.declaration) === true;
        const error = addUse(capture.reference, capture.carrier, [...(move ? [] : ["clone" as const]), ...storage], true);
        if (error !== undefined) return error;
      }
    }
    if (operation?.kind === "closure") {
      const captures = records.closureCapture.get(node);
      if (captures === undefined) {
        return "A Rust closure has no exact capture classification.";
      }
      const conversion = records.contextualValueConversion.get(node)?.conversion;
      const destination = conversion?.kind === "callable-adapter" ? conversion.target : operation.resultCarrier;
      const constructionCarrier = rustOptionElementCarrier(destination) ?? destination;
      const retainedAdapter = conversion?.kind === "callable-adapter" &&
        rustCallableProtocol(constructionCarrier)?.lifetime?.kind === "static";
      const required: readonly RustGenericRequirement[] =
        rustClosureProtocol(operation.resultCarrier) === undefined && rustGenericCallableValue(operation.resultCarrier) === undefined &&
          rustFrameCallableValue(operation.resultCarrier) === undefined
          && rustCallableInputProtocol(operation.resultCarrier) === undefined &&
          rustCallableProtocol(operation.resultCarrier)?.lifetime?.kind === "static"
          ? ["clone", "static"]
          : ["clone"];
      const addCaptureUse = (reference: Node, carrier: TargetTypeRef, requirements: readonly RustGenericRequirement[]): string | undefined => {
        const error = addUse(reference, carrier, requirements, true);
        return error ?? (retainedAdapter && !requirements.includes("static")
          ? addUse(reference, carrier, ["static"], true) : undefined);
      };
      for (const capture of captures.receivers) {
        const error = addCaptureUse(capture.reference, capture.carrier, required);
        if (error !== undefined) return error;
      }
      for (const capture of captures.receiverFields) {
        const error = addCaptureUse(capture.reference, capture.carrier, required.filter(requirement => requirement !== "clone"));
        if (error !== undefined) return error;
      }
      for (const capture of captures.captures) {
        const error = addCaptureUse(capture.reference, capture.carrier,
          capture.storage === "cell" || capture.storage === "borrow-cell" || copiedCapture(capture) ||
            input.ownershipFlow.captureTransfers.get(node)?.has(capture.declaration) === true
            ? required.filter(requirement => requirement !== "clone") : required);
        if (error !== undefined) return error;
      }
    }
    if (ast.kindName(node) === "KindClassDeclaration" || ast.kindName(node) === "KindClassExpression") {
      for (const capture of records.closureCapture.get(node)?.captures ?? []) {
        if (input.ownershipFlow.captureTransfers.get(node)?.has(capture.declaration) === true) continue;
        const error = addUse(node, capture.carrier, ["clone"]);
        if (error !== undefined) return error;
      }
      const classDefinition = input.projectTypes.definitionForDeclaration(node);
      const nativeLifetime = classDefinition === undefined ? undefined : input.objectRepresentations.nativeLifetimeFor(classDefinition);
      if (classDefinition !== undefined && nativeLifetime === undefined)
        failTargetAnalysisInvariant("tsonic-rust", "A native class field requirement consumes its original prepared lifetime contract.", node);
      if (classDefinition !== undefined && nativeLifetime?.ownedCallableFieldLifetime?.kind === "static") {
        for (const field of input.projectTypes.objectLayoutForDefinition(classDefinition)?.fields ?? []) {
          const carrier = records.runtimeCarrier.get(field.declaration)?.carrier;
          if (carrier === undefined || rustCallableProtocol(carrier) === undefined) continue;
          const parameters = new Map<string, Extract<TargetTypeRef, { readonly kind: "type-parameter" }>>();
          const pending: TargetTypeRef[] = [carrier];
          for (let index = 0; index < pending.length && index < 4096; index++) {
            const current = pending[index]!;
            if (current.kind === "type-parameter") parameters.set(current.identity, current);
            else pending.push(...rustTargetTypeChildren(current));
          }
          for (const parameter of parameters.values()) {
            const error = addUse(field.declaration, parameter, ["static"]);
            if (error !== undefined) return error;
          }
        }
      }
    }
    const yieldFact = records.yield.get(node);
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
    const callError = collectRustSourceCallRequirements(input, { node, operation, dependencies, projections, associated, addUse, collectType });
    if (callError !== undefined) return callError;
    let childError: string | undefined;
    ast.forEachChild(node, (child) => {
      if (child !== undefined && childError === undefined) {
        childError = visit(child);
      }
    });
    return childError;
  };
  return visit;
}
