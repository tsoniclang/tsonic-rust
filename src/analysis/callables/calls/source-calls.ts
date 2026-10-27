import type { Node } from "@tsonic/tsts";
import { rustProducerErrorReference } from "../../../target-model/types/carriers/producer-errors.js";
import { rustFrameCallableValue } from "../../../target-model/types/carriers/frame-callables.js";
import { selectRustFrameInvocationErrors } from "../../errors/regions.js";
import { Node_Expression, sourceEnclosingCallable } from "@tsonic/target-api/source";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { RustAnalysisProgram } from "../../program/model.js";
import type { RustSourceCallProducer } from "../../program/records/calls/source-calls.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import type { RustSourceCallEffectsFact } from "../../../target-model/records/objects/object-methods.js";
import type { RustTargetOperationFact } from "../../../target-model/records/operations/operations.js";
import type { RustNativeCallableCall } from "../../../target-model/records/native/native-protocols.js";
import type { RustTypeDefinitions } from "../../../target-model/types/source-union-definitions.js";
import { rustCallableProtocol, rustCallableInputProtocol, isRustNeverCarrier, rustOptionElementCarrier, rustTargetGenericTypeArguments } from "../../../target-model/types/index.js";
import { rustGenericCallableProtocol, rustGenericCallableValue } from "../../../target-model/types/carriers/generic-callables.js";
import { rustNativeCallableCompletion } from "../../../policy/types/callables/native-completion.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import { rustSourceCallCallableStorageCarrier } from "../../../policy/operations/members/native-contracts.js";
import { rustNativeInputEffectsMatch } from "../emission/native-protocol-emission.js";
import { isValidRustIdentifier } from "../../../target-model/names/identifiers.js";
import { rustInfallibleTargetId } from "../../../target-model/types/carriers/source-types.js";
import { rustValueCarrierBeforeContextualConversion } from "../../conversions/value-carrier-queries.js";
import { rustNativeCallableOperand } from "../native/native-conversions.js";
import { rustNodeIsOutsideNativeCode } from "../../control-flow/compile-time-statements.js";
import { substituteRustTargetGenerics } from "../../../target-model/types/carriers/substitution.js";
import type { RustProjectMethodDispatchVariant } from "../../../target-model/records/operations/method-dispatch.js";
import type { RustStructuralMethodPlan } from "../../../target-model/records/objects/structural-shapes.js";

export function sourceCallEffectsMatch(fact: Extract<RustTargetOperationFact, { readonly kind: "source-call" }>,
  effects: RustSourceCallEffectsFact | undefined, definitions: RustTypeDefinitions, native?: RustNativeCallableCall,
  method?: RustStructuralMethodPlan): boolean {
  if (effects === undefined || effects.invocation !== "infallible" && effects.invocation !== "fallible" ||
    effects.awaiting !== "not-applicable" && effects.awaiting !== "infallible" && effects.awaiting !== "fallible") return false;
  if (native !== undefined || effects.nativeInput !== undefined)
    return fact.target.form === "callable" && native !== undefined && rustNativeInputEffectsMatch(native, effects);
  const async = rustNativeCallableCompletion(fact.resultCarrier, definitions) !== undefined;
  if (fact.target.form === "union-method") {
    if (effects.unionBranches?.length !== fact.target.variants.length || !effects.unionBranches.every(branch => branch !== undefined &&
      (branch.invocation === "infallible" || branch.invocation === "fallible") &&
      (async ? branch.awaiting === "infallible" || branch.awaiting === "fallible" : branch.awaiting === "not-applicable"))) return false;
    return effects.invocation === (effects.unionBranches.some(branch => branch.invocation === "fallible") ? "fallible" : "infallible") &&
      effects.awaiting === (!async ? "not-applicable" : effects.unionBranches.some(branch => branch.awaiting === "fallible") ? "fallible" : "infallible");
  }
  const callable = method?.kind === "fixed" ? undefined : fact.target.form === "callable" ? fact.target.carrier
    : fact.target.form === "structural-method" || fact.target.form === "constructor-value" ? fact.target.callableCarrier : undefined;
  return async ? effects.awaiting !== "not-applicable" && (callable === undefined || callable.kind === "function-pointer" ||
    rustGenericCallableValue(callable) !== undefined || effects.invocation === "fallible") : effects.awaiting === "not-applicable";
}

export function analyzeRustSourceCalls(program: Omit<RustAnalysisProgram, "reachability">, nodes: readonly Node[],
  producer: RustSourceCallProducer): readonly TargetDiagnostic[] {
  const issues: TargetDiagnostic[] = [];
  const refuse = (node: Node, capability: string, message: string, unsupported = false): void => {
    issues.push({ code: unsupported ? "RUST_UNSUPPORTED_AST" : "RUST_MISSING_TARGET_FACT", category: "error", source: "tsonic-rust", sourceNode: node,
      message: `${message} Node kind: ${program.source.ast.kindName(node)}.`, evidence: [`target.capability=${capability}`] });
  };
  for (const node of nodes) {
    const fact = program.records.targetOperation.get(node);
    if (fact?.kind !== "source-call") continue;
    // A call inside compile-time source (a safety builder chain or erased metadata) is never planned as native code.
    if (rustNodeIsOutsideNativeCode(program.source.ast, program.records,
      expression => program.safetyApplications.operationForExpression(expression), node)) continue;
    const selected = program.records.selectedCall.get(node);
    const method = fact.target.form !== "structural-method" ? undefined
      : program.structuralShapes.field(fact.target.receiverCarrier, fact.target.storageIndex)?.methodPlan;
    const declaration = method?.kind === "fixed" ? method.declaration : selected?.sourceDeclaration;
    const native = program.callableValues.native.callFor(node);
    const effects = program.records.sourceCallEffects.get(node);
    if (!sourceCallEffectsMatch(fact, effects, program.typeDefinitions, native, method)) {
      refuse(node, "rust.backend.source-call-effects", "Project-source call requires one structurally consistent finalized invocation/await effect fact."); continue;
    }
    if (selected === undefined || (selected.sourceSelectedMethodTypeArguments?.length ?? 0) !== (fact.targetGenericArguments?.length ?? 0)) {
      refuse(node, "rust.backend.source-call-generic-arguments", "Selected project-source call has inconsistent source and target generic-argument evidence."); continue;
    }
    const specialized = declaration !== undefined && program.sourceCallableSpecializations.requiresSpecialization(declaration);
    const specializations = declaration === undefined || !specialized ? [] : program.sourceCallableSpecializations.variantsForCallable(declaration);
    if (specialized && specializations.length === 0) {
      refuse(node, "rust.backend.source-callable-specialization", "Selected project-source call has no exact finite Rust callable specialization."); continue;
    }
    const lexical = declaration === undefined ? undefined : program.lexicalFunctions.forDeclaration(declaration);
    if (lexical?.kind === "unresolved") { refuse(node, "rust.backend.source-call-target", "Selected project-source call target does not resolve to a finalized Rust path or receiver operation.", true); continue; }
    const inputs = declaration === undefined || fact.target.form === "callable" || specialized ? [] :
      [...new Set([...program.callableValues.native.inputsFor(declaration), ...program.callableValues.native.capturesFor(declaration)])];
    const constructor = fact.target.form === "constructor-value" ? program.structuralShapes.definitionForCarrier(fact.target.receiverCarrier)?.construction : undefined;
    const dispatch = fact.target.form !== "method" || fact.target.dispatch === undefined || declaration === undefined ? undefined
      : program.projectMethodDispatch.variantForMember(declaration, rustTargetGenericTypeArguments(fact.targetGenericArguments ?? []), fact.target.dispatch.ownerCarrier);
    // A call inside a specialized callable dispatches per specialization: its generic arguments and owner name the
    // enclosing callable's type parameters, which each specialization substitutes.
    const specializedDispatch: { readonly substitutions: ReadonlyMap<string, TargetTypeRef>; readonly variant: RustProjectMethodDispatchVariant }[] = [];
    if (fact.target.form === "method" && fact.target.dispatch !== undefined && dispatch === undefined && declaration !== undefined) {
      let enclosing = sourceEnclosingCallable(node, program.source.ast);
      while (enclosing !== undefined && !program.sourceCallableSpecializations.requiresSpecialization(enclosing))
        enclosing = sourceEnclosingCallable(enclosing, program.source.ast);
      for (const variant of enclosing === undefined ? [] : program.sourceCallableSpecializations.variantsForCallable(enclosing)) {
        const substitutions = new Map(variant.sourceTypeParameterIdentities.map((identity, index) => [identity, variant.targetTypeArguments[index]!] as const));
        const selected = program.projectMethodDispatch.variantForMember(declaration,
          rustTargetGenericTypeArguments(fact.targetGenericArguments ?? []).map(argument => substituteRustTargetGenerics(argument, substitutions, new Map())),
          substituteRustTargetGenerics(fact.target.dispatch.ownerCarrier, substitutions, new Map()));
        if (selected === undefined) { specializedDispatch.length = 0; break; }
        specializedDispatch.push(Object.freeze({ substitutions, variant: selected }));
      }
    }
    if (fact.target.form === "method" && fact.target.dispatch !== undefined && dispatch === undefined && specializedDispatch.length === 0) {
      refuse(node, "rust.backend.project-method-specialization", "Selected polymorphic project call has no exact finalized Rust dispatch specialization."); continue;
    }
    const carrier = rustSourceCallCallableStorageCarrier(fact, program.structuralShapes);
    const generic = program.records.genericCallableInvocation.get(node);
    if (native === undefined && rustGenericCallableValue(carrier) !== undefined) {
      const physical = program.callableValues.nativeStorage.invocationCallableFor(node);
      if (generic === undefined || physical === undefined || physical.kind === "unresolved" || !rustTargetTypeRefEquals(physical.carrier, generic.carrier) ||
        generic.effects.invocation !== effects!.invocation || generic.effects.awaiting !== effects!.awaiting) {
        refuse(node, "rust.backend.generic-callable-effects", "The invocation effects differ from the sealed generic implementation family."); continue;
      }
    }
    const callCarrier = fact.target.form === "callable" ? fact.target.carrier : undefined;
    const protocol = rustGenericCallableProtocol(callCarrier) ?? rustCallableProtocol(callCarrier);
    const callable = callCarrier === undefined ? undefined : callCarrier.kind === "function-pointer" || callCarrier.kind === "closure" ? "direct"
      : rustGenericCallableValue(callCarrier) !== undefined ? "generic" : rustCallableInputProtocol(callCarrier) !== undefined ? "input" : "tuple";
    const targetName = "name" in fact.target ? fact.target.name : undefined;
    const callee = Node_Expression(program.source.ast, node);
    if (fact.target.form === "constructor-value" && constructor === undefined ||
      targetName !== undefined && !isValidRustIdentifier(targetName) ||
      fact.target.form === "callable" && native === undefined && callable !== "direct" && (protocol === undefined || protocol.parameters.length !== fact.parameters.length)) {
      refuse(node, "rust.backend.source-call-target", "Selected project-source call target does not resolve to a finalized Rust path or receiver operation.", true); continue;
    }
    const inputCarrier = callee === undefined ? undefined : rustValueCarrierBeforeContextualConversion(program.records, callee);
    // The callee's physical operand: its conversion record when the callee was converted, otherwise its selected
    // native storage or producer, as the checkpoint planner selected it for every callable callee.
    const physical = callee === undefined || inputCarrier === undefined ? undefined
      : program.records.callableOperand.get(callee, inputCarrier)?.physical ?? (fact.target.form === "callable" && native === undefined
        ? rustNativeCallableOperand(inputCarrier, callee, { records: program.records, storage: program.callableValues.nativeStorage,
          producers: program.callableValues.nativeProducers, frames: program.callableValues.frames }) : undefined);
    // A producer-owned error channel is decided by its closed producer error (an infallible closure yields Infallible).
    const declaredError = physical?.signature.error;
    const producerError = declaredError === undefined ? undefined : rustProducerErrorReference(declaredError);
    // A stored structural method slot is invoked through its sealed physical storage, whose error is the one its
    // producers selected (an infallible method stores Infallible), not the method's declared logical error.
    const slot = fact.target.form === "structural-method"
      ? program.structuralShapes.field(fact.target.receiverCarrier, fact.target.storageIndex) : undefined;
    const slotStorage = slot === undefined || slot.methodPlan?.kind === "native-dispatch" ? undefined
      : slot.presence === "optional" ? rustOptionElementCarrier(slot.methodPlan?.carrier) : slot.methodPlan?.carrier;
    const slotError = slotStorage === undefined ? undefined : rustCallableProtocol(slotStorage)?.error;
    const error = slotError ?? (producerError === undefined ? declaredError : program.errorRegions.producerError(producerError));
    const frameCarrier = physical?.carrier;
    const frameError = frameCarrier === undefined || rustFrameCallableValue(frameCarrier) === undefined ? undefined
      : selectRustFrameInvocationErrors(frameCarrier, program.callableValues.frames,
        program.records.errorEffects.get(node) ?? failTargetAnalysisInvariant("tsonic-rust",
          "A selected frame invocation requires its completed effects.", node),
        program.records.sourceErrorEffects.get(node)?.edges ?? [], program.errorRegions);
    if (frameCarrier !== undefined && rustFrameCallableValue(frameCarrier) !== undefined && frameError === undefined) {
      refuse(node, "rust.backend.frame-call-error-correspondence", "The selected frame invocation has no exact completed native error correspondence."); continue;
    }
    const eliminateInfallible = method?.kind !== "fixed" && error?.kind === "target-named" && error.id === rustInfallibleTargetId;
    const edges = program.records.sourceErrorEffects.get(node)?.edges.filter(edge => edge.kind === "invoke" && edge.declaration === declaration);
    const directError = effects!.invocation === "fallible" && native === undefined && generic === undefined && declaration !== undefined &&
      fact.target.form !== "callable" && (fact.target.form !== "structural-method" || method?.kind === "fixed") && fact.target.form !== "constructor-value";
    if (directError && edges?.length !== 1) {
      refuse(node, "rust.backend.source-call-error-correspondence", "The selected source call has no unique exact invocation error edge."); continue;
    }
    const owner = sourceEnclosingCallable(node, program.source.ast);
    const pinned = owner === undefined ? undefined : program.promiseBodies.pinnedInvocations.get(owner);
    const lexicalParameters = (lexical?.genericParameters ?? []).flatMap((parameter): readonly Extract<TargetTypeRef, { readonly kind: "type-parameter" }>[] =>
      parameter.kind !== "type" ? [] : [{ kind: "type-parameter", identity: parameter.identity, name: parameter.targetName }]);
    producer.publish(node, { declaration, lexical: lexical !== undefined, lexicalParameters: Object.freeze(lexicalParameters),
      optionalStorage: declaration !== undefined && fact.target.form !== "constructor" && !specialized &&
        program.declarationGenericRequirements.contractFor(declaration, fact.asyncBody === undefined ? undefined : true) !== undefined,
      witnesses: Object.freeze(inputs.map(input => program.callableValues.nativeStorage.invocationWitnessFor(input, node))), specialized,
      constructor: constructor === undefined ? undefined : Object.freeze({ name: constructor.targetName }),
      constructorOwner: fact.target.form === "constructor" ? program.projectTypes.definitionForCarrier(fact.target.typeCarrier)?.declaration : undefined,
      dispatch, specializedDispatch: Object.freeze(specializedDispatch), callable, callableCarrier: carrier, eliminateInfallible,
      ...(fact.target.form === "callable" && native === undefined && generic === undefined && error !== undefined && !eliminateInfallible
        ? { physicalCallableError: error } : {}),
      never: isRustNeverCarrier(fact.resultCarrier),
      errorEdge: directError ? edges![0] : undefined,
      frameError: frameError === undefined ? undefined : Object.freeze({ ...frameError,
        channels: new Map(frameError.channels.map(channel => [channel.sourceIdentity, {
          targetIdentity: channel.targetIdentity, uninhabited: channel.uninhabited, jsRejection: false,
        }])) }),
      pinnedBodies: new Set([...(pinned ?? [])].filter(([, calls]) => fact.asyncBody?.maySuspend === true && calls.has(node)).map(([name]) => name)),
    }, specializations);
  }
  return Object.freeze(issues);
}
