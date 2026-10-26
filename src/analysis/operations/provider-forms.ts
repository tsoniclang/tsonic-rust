import type { Node } from "@tsonic/tsts";
import { sourceEnclosingCallable } from "@tsonic/target-api/source";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { RustAnalysisProgram } from "../program/model.js";
import type { RustProviderFormProducer } from "../program/records/provider-forms.js";
import type { RustProviderFormEmission } from "../../target-model/records/provider-forms.js";
import { isRustFinalizedSourceInput } from "../../target-model/operations/finalized-inputs.js";
import { rustGeneratorSourceInvocationKind } from "../../policy/operations/source-profiles/generator-source-profile.js";
import type { RustOperationAttempt } from "../program/operation-attempts.js";
import { materializeRustSourceErrorRegion } from "../errors/source-regions.js";
import { rustErrorRegionCarrier, rustFrameInvocationErrorOperand, selectRustErrorRegion } from "../errors/regions.js";
import { rustFrameCallableValue } from "../../target-model/types/carriers/frame-callables.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { rustUninhabitedError } from "../../policy/conversions/callable-physical.js";
import { rustPreparedCallbackResultEffects } from "../errors/callback-effects.js";
import { rustNativeCallableOperand } from "../callables/native-conversions.js";
import { rustValueCarrierBeforeContextualConversion } from "../conversions/value-carrier-queries.js";
import { rustNativeErrorJoinTargetType } from "../../target-model/types/native-error-joins.js";
import { rustProgramErrorTargetType } from "../../target-model/types/carriers/js.js";
import type { RustFinalizedOperationAbi } from "../../target-model/records/finalized-operation.js";
import type { RustValueConversionContract } from "../../target-model/conversions/contracts.js";
import { rustRuntimeErrorTargetType } from "../../target-model/types/carriers/runtime-carriers.js";
import { rustJsErrorTargetType } from "../../target-model/types/carriers/js.js";
import { rustCallbackProtocol } from "../../policy/operations/members/callbacks.js";
import { selectRustSourceValueConversion } from "../../policy/conversions/selection.js";
import { rustValueConversionContract } from "../../policy/conversions/contracts.js";
import { rustCallableInvocationErrorEffects } from "../errors/error-effects.js";

export interface RustProviderReadSelection {
  readonly node: Node;
  readonly abi: RustFinalizedOperationAbi;
  readonly bodies: readonly {
    readonly body: true | undefined;
    readonly read: RustProviderFormEmission["read"];
  }[];
}

export function selectRustProviderReads(program: Omit<RustAnalysisProgram, "reachability">, nodes: readonly Node[]): {
  readonly reads: readonly RustProviderReadSelection[];
  readonly diagnostics: readonly TargetDiagnostic[];
} {
  const issues: TargetDiagnostic[] = [];
  const reads: RustProviderReadSelection[] = [];
  const selected = new WeakMap<Node, Set<RustFinalizedOperationAbi>>();
  const { ast } = program.source;
  // A provider disposer is planned at its resource declaration, outside the source operation occurrences.
  const disposals = nodes.flatMap(node => {
    const target = program.records.resourceManagement.get(node)?.disposal.target;
    return target?.form === "provider" ? [{ node, abi: target.abi, runtimeSet: false }] : [];
  });
  const occurrences = program.physicalEmissionContexts.sourceOccurrences.map(occurrence =>
    ({ node: occurrence.node, abi: occurrence.operation.abi, runtimeSet: occurrence.operation.kind === "runtime-set" }));
  for (const { node, abi, runtimeSet } of [...occurrences, ...disposals]) {
    const previous = selected.get(node) ?? new Set<RustFinalizedOperationAbi>();
    if (previous.has(abi)) continue;
    previous.add(abi);
    selected.set(node, previous);
    const form = abi.target;
    const owner = sourceEnclosingCallable(node, ast);
    const native = owner === undefined ? undefined : program.records.callableDeclaration.get(owner)?.nativeBody;
    const bodies: (true | undefined)[] = native === undefined ? [undefined]
      : program.promiseBodies.objects.has(owner!) ? [undefined, true] : [true];
    const contexts: RustProviderReadSelection["bodies"][number][] = [];
    for (const body of bodies) {
      let read: RustProviderFormEmission["read"] = "storage";
      if (!runtimeSet && (form.form === "field" || form.form === "index")) {
        const carrier = abi.result.kind === "async" ? abi.result.futureCarrier : abi.result.carrier;
        const physical = program.records.carrierRead.get(carrier);
        if (physical === undefined) failTargetAnalysisInvariant("tsonic-rust", "An admitted provider read requires its exact native carrier guarantees.", node);
        const clone = owner === undefined ? physical.clone : program.records.carrierClone.get(carrier, owner, body);
        if (physical.copy) read = "copy";
        else if (clone === true) read = "clone";
        else if (program.ownership.reads.get(node)?.source.kind !== "borrow") {
          issues.push({ code: "RUST_UNSUPPORTED_AST", source: "tsonic-rust", category: "error", sourceNode: node,
            message: `A provider ${form.form} read requires an exact Copy or Clone result-carrier contract. Node kind: ${ast.kindName(node)}.`,
            evidence: [`target.capability=rust.backend.provider-${form.form}-read-ownership`] });
          continue;
        }
      }
      contexts.push(Object.freeze({ body, read }));
    }
    reads.push(Object.freeze({ node, abi, bodies: Object.freeze(contexts) }));
  }
  return Object.freeze({ reads: Object.freeze(reads), diagnostics: Object.freeze(issues) });
}

export function analyzeRustProviderForms(program: Omit<RustAnalysisProgram, "reachability">, reads: readonly RustProviderReadSelection[],
  producer: RustProviderFormProducer, attempts: Pick<WeakMap<Node, RustOperationAttempt>, "get">): readonly TargetDiagnostic[] {
  const issues: TargetDiagnostic[] = [];
  const { ast } = program.source;
  for (const { node, abi, bodies } of reads) {
    const form = abi.target;
    let worker: RustProviderFormEmission["worker"];
    let nativeResult: RustProviderFormEmission["nativeResult"];
    let callbackBody: RustProviderFormEmission["callbackBody"];
    const operation = program.records.targetOperation.get(node);
    if (operation?.kind === "provider-operation" && rustGeneratorSourceInvocationKind(operation.operationId) === "sync") {
      const edges = program.records.sourceErrorEffects.get(node)?.edges;
      const edge = edges?.length === 1 ? edges[0] : undefined;
      nativeResult = edge === undefined ? undefined : program.records.sourceErrorRegion.get(edge);
      if (edge === undefined || nativeResult === undefined || program.records.generator.get(edge.declaration) === undefined) {
        issues.push({ code: "RUST_GENERATOR_BODY_ERRORS_NOT_CLOSED", category: "error", source: "tsonic-rust", sourceNode: node,
          message: "A generator resume result requires its exact admitted body error correspondence before rendering.",
          evidence: ["target.capability=rust.generator.exact-body-errors"] });
        continue;
      }
    }
    if (nativeResult === undefined && abi.effects.invocation === "fallible" && abi.effects.errorBoundary === "provider-native") {
      const error = abi.effects.errorCarrier;
      if (error === undefined)
        failTargetAnalysisInvariant("tsonic-rust", "An admitted native provider result requires its selected error carrier.", node);
      const effects = rustCallableInvocationErrorEffects(error);
      if (!effects.localErrors) {
        const selected = selectRustErrorRegion(node, effects,
          { ast, records: program.records, producers: program.callableValues.nativeProducers,
            definitions: program.typeDefinitions, components: program.sourcePackageComponents, promiseBodies: program.promiseBodies }, false);
        if (selected.kind === "rejected") {
          issues.push(...selected.diagnostics);
          continue;
        }
        nativeResult = materializeRustSourceErrorRegion(node, { operand: selected.value, local: undefined,
          channels: selected.value.sources.map(source => ({ sourceIdentity: source.identity, targetIdentity: source.identity,
            uninhabited: rustUninhabitedError(source.errorType) })) });
      }
    }
    const attempt = attempts.get(node);
    const callback = attempt?.kind === "checked-call" ? attempt.prepared : undefined;
    const vectorConversions = callback === undefined ? [] : abi.targetArguments.flatMap(input => {
      if (!isRustFinalizedSourceInput(input) || input.source.kind !== "argument" ||
        input.source.sourceIndex !== callback.value.callback.sourceArgumentIndex) return [];
      const conversions = input.conversion.kind === "sequence" ? input.conversion.steps : [input.conversion];
      return conversions.flatMap(conversion => {
        if (conversion.kind !== "semantic") return [];
        const contract = program.records.conversionContract.get(conversion.conversion);
        return contract?.lowering === "js-argument-vector-callback" ? [contract] : [];
      });
    });
    if (vectorConversions.length > 1)
      failTargetAnalysisInvariant("tsonic-rust", "A selected callback has one exact argument-vector conversion.", node);
    const vector = vectorConversions[0];
    if (attempt?.kind === "checked-call" && callback !== undefined && callback.value.callback.failure.kind !== "returned-future" &&
      (abi.effects.invocation === "fallible" || vector !== undefined)) {
      const effects = rustPreparedCallbackResultEffects(callback.value, callback.callbackEffects.invocationEffects);
      if (effects === undefined)
        failTargetAnalysisInvariant("tsonic-rust", "An admitted provider callback requires its completed native Result effects.", node);
      const argument = attempt.request.source.sourceArguments[callback.value.callback.sourceArgumentIndex]?.expression;
      const source = argument === undefined ? undefined : rustValueCarrierBeforeContextualConversion(program.records, argument);
      const physical = argument === undefined || source === undefined ? undefined : rustNativeCallableOperand(source, argument, {
        records: program.records, storage: program.callableValues.nativeStorage,
        producers: program.callableValues.nativeProducers, frames: program.callableValues.frames,
      });
      const conversion = argument === undefined ? undefined : program.records.contextualValueConversion.get(argument)?.conversion;
      const adapted = conversion?.kind !== "callable-adapter" || argument === undefined ? undefined
        : program.records.callableContract.get(argument, conversion);
      if (argument === undefined || physical === undefined || conversion?.kind === "callable-adapter" && adapted === undefined)
        failTargetAnalysisInvariant("tsonic-rust", "An admitted provider callback requires its exact physical invocation operand.", node);
      const signature = adapted?.physical ?? physical.signature;
      const callbackFallible = callback.callbackEffects.invocationEffects.localErrors ||
        callback.callbackEffects.invocationEffects.nativeErrors.length !== 0;
      const helperError = abi.effects.errorCarrier;
      if (abi.effects.errorBoundary === "provider-native" && helperError === undefined)
        failTargetAnalysisInvariant("tsonic-rust", "An admitted intrinsic callback helper requires its exact selected native Result error carrier.", node);
      const frame = !callbackFallible || helperError !== undefined || adapted !== undefined ? undefined : rustFrameCallableValue(physical.carrier);
      const selected = frame === undefined ? selectRustErrorRegion(!callbackFallible || helperError !== undefined ? node
        : callback.callbackEffects.invocationOwner, effects,
        { ast, records: program.records, producers: program.callableValues.nativeProducers,
          definitions: program.typeDefinitions, components: program.sourcePackageComponents, promiseBodies: program.promiseBodies }, false) : undefined;
      if (selected?.kind === "rejected") {
        issues.push(...selected.diagnostics);
        continue;
      }
      const operand = frame === undefined ? selected?.kind === "resolved" ? selected.value : undefined
        : rustFrameInvocationErrorOperand(physical.carrier, program.callableValues.frames);
      if (operand === undefined || (operand.localOwner !== undefined) !== effects.localErrors ||
        operand.sources.length !== effects.nativeErrors.length || operand.sources.some(source =>
          !effects.nativeErrors.some(error => error.identity === source.identity && rustTargetTypeRefEquals(error.errorType, source.errorType))))
        failTargetAnalysisInvariant("tsonic-rust", "An admitted provider callback requires its exact selected physical error correspondence.", node);
      const invocationSelection = frame === undefined
        ? selectRustErrorRegion(callback.callbackEffects.invocationOwner, callback.callbackEffects.invocationEffects,
          { ast, records: program.records, producers: program.callableValues.nativeProducers,
            definitions: program.typeDefinitions, components: program.sourcePackageComponents, promiseBodies: program.promiseBodies }, false)
        : undefined;
      if (invocationSelection?.kind === "rejected") {
        issues.push(...invocationSelection.diagnostics);
        continue;
      }
      const invocationOperand = frame === undefined
        ? invocationSelection?.kind === "resolved" ? invocationSelection.value : undefined : operand;
      if (invocationOperand === undefined)
        failTargetAnalysisInvariant("tsonic-rust", "A callback body requires its exact physical invocation error selection.", argument);
      const invocationLocal = invocationOperand.localOwner === undefined ? undefined
        : invocationOperand.localOwner.kind === "physical" && invocationOperand.localOwner.domain === "runtime"
          ? rustRuntimeErrorTargetType() : rustProgramErrorTargetType(invocationOperand.localOwner);
      const invocationError = rustNativeErrorJoinTargetType(invocationOperand.fileName,
        [...(invocationLocal === undefined ? [] : [invocationLocal]), ...invocationOperand.sources.map(source => source.errorType)]);
      const expected = helperError ?? invocationError;
      if (expected === undefined || callbackFallible && !rustTargetTypeRefEquals(signature.error, expected) &&
        !(helperError !== undefined && rustUninhabitedError(signature.error)))
        failTargetAnalysisInvariant("tsonic-rust", "An admitted provider Result requires its exact selected callback adapter error contract.", node);
      if (abi.effects.invocation === "fallible") nativeResult = materializeRustSourceErrorRegion(node, { operand,
        local: operand.localOwner === undefined ? undefined : { kind: "local" },
        channels: operand.sources.map(source => ({ sourceIdentity: source.identity, targetIdentity: source.identity,
          uninhabited: rustUninhabitedError(source.errorType) })) });
      if (vector !== undefined) {
        const lambda = program.records.lambdaBody.get(argument);
        const sourceProtocol = rustCallbackProtocol(source);
        if (sourceProtocol === undefined)
          failTargetAnalysisInvariant("tsonic-rust", "An argument-vector callback requires its actual source invocation form.", argument);
        const sourceResultFallible = adapted !== undefined || (lambda?.construction === "native" && lambda.nativeClosure !== undefined
          ? lambda.resultFallible : sourceProtocol.fallible);
        if (invocationError === undefined || !rustTargetTypeRefEquals(signature.error, invocationError) ||
          invocationOperand.localOwner !== undefined && operand.localOwner === undefined ||
          invocationOperand.sources.some(source => !operand.sources.some(target => source.identity === target.identity &&
            rustTargetTypeRefEquals(source.errorType, target.errorType))))
          failTargetAnalysisInvariant("tsonic-rust", "A callback body requires exact source-to-helper error correspondence.", argument);
        let projection: RustValueConversionContract | undefined;
        if (vector.projections.includes("native-string")) {
          const source = rustJsErrorTargetType();
          const target = rustErrorRegionCarrier(operand);
          const conversion = target === undefined ? undefined : rustTargetTypeRefEquals(source, target)
            ? { kind: "native-representation" as const, source, target }
            : selectRustSourceValueConversion(source, target, program.typeDefinitions);
          projection = conversion === undefined ? undefined : rustValueConversionContract(conversion, program.typeDefinitions);
          if (projection === undefined || projection.fallible)
            failTargetAnalysisInvariant("tsonic-rust", "A native callback projection requires its exact native error conversion.", argument);
        }
        callbackBody = Object.freeze({ argument, region: operand, sourceResultFallible,
          targetResultFallible: vector.targetResultFallible,
          invocation: sourceResultFallible ? materializeRustSourceErrorRegion(argument, {
            operand: invocationOperand, local: invocationOperand.localOwner === undefined ? undefined : { kind: "local" },
            channels: invocationOperand.sources.map(source => ({ sourceIdentity: source.identity, targetIdentity: source.identity,
              uninhabited: rustUninhabitedError(source.errorType) })),
          }) : undefined,
          projection });
      }
    }
    if (form.form === "source-module-construction") {
      const construction = program.sourceModuleConstructions.construction(node);
      if (construction === undefined || construction.sourceArgumentIndex !== form.sourceArgumentIndex ||
        construction.targetArgumentIndex !== form.targetArgumentIndex)
        failTargetAnalysisInvariant("tsonic-rust", "An admitted source-module constructor requires its exact source construction.", node);
      const argumentIndex = abi.targetArguments.findIndex(input => input.source.kind === "argument" && input.source.sourceIndex === form.sourceArgumentIndex);
      const input = abi.targetArguments[argumentIndex];
      const fileName = ast.getFileName(construction.targetSourceFile);
      const entry = program.records.workerEntries.get()?.find(entry => entry.fileName === fileName);
      if (input === undefined || !isRustFinalizedSourceInput(input) || input.source.kind !== "argument" ||
        input.mode !== "ref" && input.mode !== "value" || entry === undefined)
        failTargetAnalysisInvariant("tsonic-rust", "An admitted source-module constructor requires its worker identity and immutable source argument.", node);
      worker = Object.freeze({ fileName, argumentIndex, mode: input.mode });
    }
    for (const { body, read } of bodies) {
      producer.publish(node, abi, body, { read, worker, nativeResult, callbackBody });
    }
  }
  return Object.freeze(issues);
}
