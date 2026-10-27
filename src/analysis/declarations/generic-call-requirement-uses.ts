import type { RustCallableRequirementInput } from "./generic-callable-requirements-model.js";
import type { createRustAssociatedRequirementCollector } from "./associated-requirements.js";
import type { createRustProjectProjectionRequirementCollector } from "./project-projection-requirements.js";

import { rustGenericCallableValue } from "../../target-model/types/carriers/generic-callables.js";
import { rustFrameCallableValue } from "../../target-model/types/carriers/frame-callables.js";
import { bindRustExactTypeParameters } from "../../target-model/types/carriers/generic-inference.js";
import { rustCallableProtocol, rustNativeCallableProtocol } from "../../target-model/types/carriers/callables.js";

import type { Node } from "@tsonic/tsts";
import { Node_Expression } from "@tsonic/target-api/source";

import { substituteRustTargetTypeParameters } from "../../target-model/types/carriers/substitution.js";

import type { RustAnalysisRecords } from "../../target-model/records/analysis.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";

import { rustOptionElementCarrier, rustSourceTypeCarrierValue, rustTargetGenericTypeArguments } from "../../target-model/types/index.js";
import { isRustCopyCarrier } from "../../policy/constraints/native-traits.js";

import type { TargetTypeRef } from "../../target-model/types/model.js";

import type { RustGenericRequirement } from "../../target-model/records/types/generic-requirements.js";

import { rustGenericCallableMemberInvocationBindings } from "../callables/generics/generic-bindings.js";

import { rustSourceCallCallableStorageCarrier } from "../../policy/operations/members/native-contracts.js";
import { bindRustStructuralInterfaceParameters, bindRustStructuralReceiverParameters } from "./structural-receiver-requirements.js";
import { rustTargetTypeParameterIdentities } from "../../target-model/types/carriers/generic-references.js";

import { rustPhysicalPayloadFor } from "../../policy/conversions/physical-payloads.js";
import { rustMemberAccessReceiver } from "../../target-model/syntax/expressions.js";
import { rustContextualRuntimeConversionContract } from "../../policy/conversions/contextual.js";

interface SourceCallRequirements {
  readonly node: Node;
  readonly operation: ReturnType<RustAnalysisRecords["targetOperation"]["get"]>;
  readonly dependencies: Set<string>;
  readonly projections: ReturnType<typeof createRustProjectProjectionRequirementCollector>;
  readonly associated: ReturnType<typeof createRustAssociatedRequirementCollector>;
  readonly addUse: (node: Node, carrier: TargetTypeRef | undefined, requirements: readonly RustGenericRequirement[], nativeStorage?: boolean) => string | undefined;
  readonly collectType: (carrier: TargetTypeRef) => string | undefined;
}

export function collectRustSourceCallRequirements(input: RustCallableRequirementInput, state: SourceCallRequirements): string | undefined {
  const { ast, declaration, records } = input;
  const { node, operation, dependencies, projections, associated, addUse, collectType } = state;
  if (operation?.kind === "source-call") {
    for (const parameter of operation.parameters) {
      if (parameter.mode !== "value") continue;
      for (const argument of parameter.inputs) {
        if (argument.sourceForm !== "value") continue;
        const expression = ast.arguments(node)[argument.sourceArgumentIndex];
        if (expression === undefined || !ast.is.IsIdentifier(expression) ||
          input.ownershipFlow.movingReads.has(expression)) continue;
        const conversion = records.contextualValueConversion.get(expression);
        if (conversion !== undefined &&
          rustContextualRuntimeConversionContract(conversion.conversion, input.typeDefinitions)?.sourceMode === "ref") continue;
        const storage = input.nativeStorage.operandFor(expression);
        if (storage.kind === "unresolved") return storage.reason;
        const argumentCarrier = storage.carrier;
        if (isRustCopyCarrier(argumentCarrier)) continue;
        const error = addUse(expression, argumentCarrier, ["clone"]);
        if (error !== undefined) return error;
      }
    }
    const selected = records.selectedCall.get(node);
    const selectedMethod = operation.target.form === "structural-method"
      ? input.structuralShapes.field(operation.target.receiverCarrier, operation.target.storageIndex)?.methodPlan : undefined;
    const fixed = selectedMethod?.kind === "fixed" ? selectedMethod : undefined;
    const callableCarrier = rustSourceCallCallableStorageCarrier(operation, input.structuralShapes);
    const genericCallable = rustGenericCallableValue(callableCarrier);
    const nativeCall = input.nativeCallables.callFor(node);
    const genericDefinition = callableCarrier === undefined || nativeCall !== undefined ? undefined : input.genericCallables.definitionFor(callableCarrier);
    const frameEntry = callableCarrier === undefined ? undefined : input.frameCallables.entryFor(callableCarrier);
    if (genericCallable !== undefined && genericDefinition === undefined && nativeCall === undefined) {
      return "A quantified call has no exact sealed implementation family for its generic obligations.";
    }
    if (rustFrameCallableValue(callableCarrier) !== undefined && frameEntry === undefined) {
      return "A frame call has no exact sealed implementation entry for its generic obligations.";
    }
    const genericInvocation = genericDefinition === undefined ? undefined : records.genericCallableInvocation.get(node);
    const genericPhysicalDefinition = genericInvocation === undefined ? undefined
      : input.genericCallables.physical.definitionFor(genericInvocation.carrier);
    if (genericDefinition !== undefined && genericPhysicalDefinition === undefined) {
      return "A quantified call has no exact physical implementation family for its generic obligations.";
    }
    const physical = nativeCall?.input.protocol.method ?? (frameEntry === undefined && genericDefinition === undefined && operation.target.form === "callable"
      ? rustCallableProtocol(callableCarrier) ?? rustNativeCallableProtocol(callableCarrier) : undefined);
    if (physical !== undefined && callableCarrier !== undefined) {
      const error = collectType(callableCarrier);
      if (error !== undefined) return error;
    }
    const sourceDeclaration = selected?.sourceDeclaration === undefined ? undefined : input.implementationDeclaration(selected.sourceDeclaration);
    const callees = frameEntry?.implementations ?? (genericPhysicalDefinition === undefined
      ? fixed !== undefined ? [{ declaration: fixed.declaration },
        ...(sourceDeclaration === undefined || sourceDeclaration === fixed.declaration ? [] : [{ declaration: sourceDeclaration }])]
        : physical !== undefined || sourceDeclaration === undefined ? [] : [{ declaration: sourceDeclaration }]
      : genericPhysicalDefinition.members);
    for (const selectedCallee of callees) {
      const implementation = "implementation" in selectedCallee ? selectedCallee.implementation : selectedCallee;
      const selectedDeclaration = implementation.declaration;
      const calleeId = (operation.asyncBody === undefined ? input.idByDeclaration : input.bodyIdByDeclaration).get(selectedDeclaration);
      if ((genericDefinition !== undefined || frameEntry !== undefined || selectedDeclaration === fixed?.declaration) && calleeId === undefined) {
        return "A sealed callable implementation has no exact source generic-contract owner.";
      }
      const selectedClass = operation.target.form === "constructor"
        ? input.projectTypes.definitionForCarrier(operation.target.typeCarrier)
        : undefined;
      const targetTypeArguments = rustTargetGenericTypeArguments(
        operation.target.form === "constructor"
          ? selectedClass?.declaration === selectedDeclaration
            ? rustSourceTypeCarrierValue(operation.target.typeCarrier)?.genericArguments : []
          : operation.targetGenericArguments,
      );
      if (calleeId !== undefined) {
        dependencies.add(calleeId);
        const callee = input.contractFor(selectedDeclaration, operation.asyncBody === undefined ? undefined : true);
        if (callee !== undefined) {
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
          const memberBindings = "implementation" in selectedCallee && genericPhysicalDefinition !== undefined && genericInvocation !== undefined
            ? rustGenericCallableMemberInvocationBindings(genericPhysicalDefinition, selectedCallee, genericInvocation.carrier,
              operation.targetGenericArguments ?? [], { ast, sourceLifetimes: input.sourceLifetimes,
                physical: input.genericCallables.physical }) : undefined;
          if ("implementation" in selectedCallee && memberBindings === undefined) {
            return "A quantified invocation lost its exact physical member capture bindings.";
          }
          const capturedInputs = input.nativeCallables.capturesFor(selectedDeclaration);
          const fixedBody = fixed !== undefined && fixed.declaration === selectedDeclaration;
          const sourceReceiver = fixedBody ? rustMemberAccessReceiver(ast, Node_Expression(ast, node)) : undefined;
          const receiverStorage = !fixedBody || sourceReceiver === undefined ? undefined : input.nativeStorage.operandFor(sourceReceiver);
          const physicalReceiver = receiverStorage === undefined || receiverStorage.kind === "unresolved" ? undefined : receiverStorage.carrier;
          const physicalTemplate = physicalReceiver === undefined ? undefined : input.structuralShapes.templateForCarrier(physicalReceiver);
          const physicalBindings = !fixedBody || physicalTemplate === undefined || physicalReceiver === undefined ? undefined
            : bindRustStructuralReceiverParameters(physicalTemplate.carrier, physicalReceiver,
              new Set([...physicalTemplate.genericParameters.flatMap(parameter => parameter.kind === "type" ? [parameter.identity] : []),
                ...callee.capturedTypeParameters.map(parameter => parameter.identity),
                ...capturedInputs.map(parameter => parameter.implementation.identity)]));
          if (fixedBody && physicalBindings === undefined)
            return "A fixed structural call requires its exact admitted physical receiver and captured native bindings.";
          for (const [identity, carrier] of physicalBindings ?? []) substitutions.set(identity, carrier);
          for (const parameter of [...input.nativeCallables.inputsFor(selectedDeclaration), ...capturedInputs]) {
            if (fixedBody && capturedInputs.includes(parameter)) {
              const payload = physicalBindings?.get(parameter.implementation.identity);
              if (payload === undefined) return "A fixed structural invocation lost its actual physical native capture binding.";
              substitutions.set(parameter.implementation.identity, payload);
              continue;
            }
            if (memberBindings !== undefined && capturedInputs.includes(parameter)) {
              const payload = memberBindings.types.get(parameter.implementation.identity);
              if (payload === undefined) return "A quantified invocation lost a required physical native capture binding.";
              substitutions.set(parameter.implementation.identity, payload);
              continue;
            }
            const physical = input.nativeStorage.invocationInputFor(parameter, node, declaration);
            if (physical.kind === "unresolved")
              return `A source call lost the exact physical native input required by its callee contract: ${physical.reason}`;
            const payload = rustPhysicalPayloadFor(parameter.carrier,
              physical.carrier, rustOptionElementCarrier(parameter.carrier) ?? parameter.carrier, input.typeDefinitions);
            if (payload === undefined) return "A source call lost the exact physical native input required by its callee contract.";
            substitutions.set(parameter.implementation.identity, payload);
          }
          if (frameEntry !== undefined && "carrier" in implementation && callableCarrier !== undefined) {
            const bindings = bindRustExactTypeParameters(implementation.carrier, callableCarrier,
              new Set(callee.capturedTypeParameters.map(parameter => parameter.identity)));
            if (bindings === undefined) return "A frame invocation lost its exact captured generic environment binding.";
            for (const [identity, carrier] of bindings) substitutions.set(identity, carrier);
          }
          if (genericCallable !== undefined && genericDefinition !== undefined && "substitutions" in implementation) {
            for (const [identity, parameter] of implementation.substitutions) {
              const index = parameter.kind === "type-parameter"
                ? genericDefinition.signature.environmentParameters.findIndex(candidate => candidate.identity === parameter.identity) : -1;
              const argument = genericCallable.environment[index];
              if (index < 0 || argument === undefined) return "A quantified invocation lost its exact captured generic environment binding.";
              substitutions.set(identity, argument);
            }
          }
          const frame = rustFrameCallableValue(callableCarrier);
          const receiver = fixedBody ? physicalReceiver : operation.target.form === "constructor" ? operation.target.typeCarrier
            : selected?.sourceSelectedOwnerCarrier ?? selected?.sourceSelectedReceiverCarrier ??
              (frame?.owner.kind === "class" ? frame.owner.instance : undefined);
          const receiverDeclaration = ast.parent(selectedDeclaration);
          // An object literal member binds its captured parameters against the literal's own carrier; a member of a
          // generic interface or type literal binds them against the receiver's structural template (its open shape).
          const structuralReceiver = operation.target.form === "constructor-value"
            ? (() => { const value = Node_Expression(ast, node); return value === undefined ? undefined : records.runtimeCarrier.get(value)?.carrier; })()
            : operation.target.form === "structural-method" ? receiver : undefined;
          const interfaceMember = receiverDeclaration !== undefined && (ast.is.IsInterfaceDeclaration(receiverDeclaration) ||
            ast.is.IsTypeLiteralNode(receiverDeclaration));
          // A captured parameter the receiver carrier itself names is in scope at the call (the call sits inside its owner)
          // and denotes itself; only the interface's foreign parameters bind against the template.
          const inScope = structuralReceiver === undefined ? new Set<string>() : new Set(rustTargetTypeParameterIdentities(structuralReceiver));
          const foreign = callee.capturedTypeParameters.filter(parameter => !inScope.has(parameter.identity));
          if (foreign.length !== 0 && structuralReceiver !== undefined && interfaceMember) {
            const definition = input.structuralShapes.templateForCarrier(structuralReceiver);
            const bindings = definition === undefined ? undefined : bindRustStructuralInterfaceParameters(
              [definition.carrier, ...definition.sourceCarriers], structuralReceiver, new Set(foreign.map(parameter => parameter.identity)));
            if (bindings === undefined) return "A structural member call lost its exact captured interface type bindings.";
            for (const [identity, carrier] of bindings) {
              const existing = substitutions.get(identity);
              if (existing !== undefined && !rustTargetTypeRefEquals(existing, carrier)) {
                return "A structural member call has conflicting captured interface type bindings.";
              }
              substitutions.set(identity, carrier);
            }
          }
          if (!fixedBody && operation.target.form === "structural-method" && callee.capturedTypeParameters.length !== 0 &&
            receiverDeclaration !== undefined && ast.is.IsObjectLiteralExpression(receiverDeclaration)) {
            const template = records.runtimeCarrier.get(receiverDeclaration)?.carrier;
            const bindings = template === undefined || receiver === undefined ? undefined
              : bindRustStructuralReceiverParameters(template, receiver,
                new Set(callee.capturedTypeParameters.map(parameter => parameter.identity)));
            if (bindings === undefined) return "A structural call lost its exact captured receiver type bindings.";
            for (const [identity, carrier] of bindings) {
              const existing = substitutions.get(identity);
              if (existing !== undefined && !rustTargetTypeRefEquals(existing, carrier)) {
                return "A structural call has conflicting captured receiver type bindings.";
              }
              substitutions.set(identity, carrier);
            }
          }
          const instantiate = (carrier: TargetTypeRef): TargetTypeRef | undefined => {
            const instantiated = substituteRustTargetTypeParameters(carrier, substitutions);
            return receiver === undefined || input.projectTypes.definitionContainingDeclaration(selectedDeclaration) === undefined
              ? instantiated : input.projectTypes.instantiateMemberCarrier(selectedDeclaration, receiver, instantiated);
          };
          for (const parameter of callee.nativeInputs) {
            if (parameter.requirements.length === 0) continue;
            const carrier = instantiate({ kind: "type-parameter", identity: parameter.identity, name: parameter.name });
            const error = addUse(node, carrier, parameter.requirements);
            if (error !== undefined) return error;
          }
          for (const parameter of callee.capturedTypeParameters) {
            if (parameter.requirements.length === 0) continue;
            const carrier = instantiate({ kind: "type-parameter", identity: parameter.identity, name: parameter.name });
            const error = addUse(node, carrier, parameter.requirements);
            if (error !== undefined) return error;
          }
          for (const requirement of callee.optionalStorage) {
            const error = addUse(node, instantiate(requirement.carrier), requirement.requirements);
            if (error !== undefined) return error;
          }
          for (const requirement of callee.projectProjections) {
            const sourceCarrier = instantiate(requirement.sourceCarrier);
            const targetCarrier = instantiate(requirement.targetCarrier);
            if (sourceCarrier === undefined || targetCarrier === undefined || !projections.require({ sourceCarrier, targetCarrier })) {
              return "A generic call does not satisfy its exact native projection contract.";
            }
          }
          for (const requirement of callee.associatedTypes) {
            const carrier = instantiate(requirement.carrier);
            if (carrier === undefined) return "A generic call lost its exact enclosing member carrier substitution.";
            const collected = collectType(carrier);
            if (collected !== undefined) return collected;
            if (requirement.fieldAccess !== undefined && (carrier.kind !== "associated-type" ||
              !associated.requireField(carrier, requirement.fieldAccess, requirement.output === undefined ? undefined :
                instantiate(requirement.output)))) return "A generic call does not satisfy its selected field access contract.";
            const error = addUse(node, carrier, requirement.requirements);
            if (error !== undefined) return error;
          }
        }
      }
    }
  }
  return undefined;
}
