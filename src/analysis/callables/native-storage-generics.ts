import type { AstReader, Node } from "@tsonic/tsts";
import type { SourceStorageBindings, SourceStorageProducer, SourceStorageQueries, SourceStorageSubject } from "@tsonic/target-api/analysis";
import { rejectedTargetStage, resolvedTargetStage, type TargetStageResult } from "@tsonic/target-api/artifacts";
import { Node_Expression, sourceEnclosingCallable, sourceNodeIdentity, asSourceNode } from "@tsonic/target-api/source";
import type { RustProgramRecords } from "../../target-model/records/program.js";
import type { RustTargetGenericBindings } from "../../target-model/types/carriers/generic-inference.js";
import { substituteRustTargetGenericArgument } from "../../target-model/types/carriers/substitution.js";
import { rustTargetGenericBindingsForArguments } from "../../target-model/types/generic-arguments.js";
import { rustTargetGenericArgumentEquals, rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { rustLifetimeKey, rustLifetimesEqual } from "../../target-model/lifetimes/index.js";

import { rustRetainedCallSubstitutions } from "./retained-call-lifetimes.js";

import { rustCallableInputLifetimeParameters } from "./source-input-lifetimes.js";
import { rustTargetGenericReferences } from "../../target-model/types/carriers/generic-references.js";
import type { RustTargetConstArgument, RustTargetGenericArgument, TargetTypeRef } from "../../target-model/types/model.js";
import { inferRustTargetGenericBindings } from "../../target-model/types/carriers/generic-inference.js";
import { rustGenericCallableProtocol, rustGenericCallableValue } from "../../target-model/types/carriers/generic-callables.js";
import { rustStructuralMethodStorageCarrier } from "../../target-model/types/carriers/callables.js";
import { rustOptionElementCarrier } from "../../target-model/types/carriers/optional.js";
import { substituteRustTargetGenerics } from "../../target-model/types/carriers/substitution.js";
import type { RustLifetimeIndex } from "../../target-model/lifetimes/index.js";
import type { RustGenericCallablePlan } from "./generic-values.js";
import type { RustPhysicalCallableSourceActivations } from "../../target-model/records/physical-emission-contexts.js";
import { snapshotRustCallableBindings, rustGenericCallablePhysicalBindings } from "./generic-bindings.js";
import type { RustProjectTypePolicy } from "../../target-model/types/project-types.js";
import type { RustProjectMethodBodySelection, RustProjectMethodDispatchPlan } from "../project-types/method-dispatch.js";
import type { RustProjectCallableAdapter } from "../../target-model/records/project-callable-adapters.js";
import { rustSourceTypeCarrierValue } from "../../target-model/types/carriers/source-types.js";

type RustNativeStorageTargetBindingsSelection =
  | { readonly kind: "resolved"; readonly bindings: RustTargetGenericBindings }
  | { readonly kind: "unresolved"; readonly reason: string };

interface RustNativeStorageGenericInput {
  readonly ast: AstReader;
  readonly storage: SourceStorageQueries;
  readonly records: RustProgramRecords;
  readonly genericInvocationBindingsFor: (declaration: Node, invocation: Node, bindings: SourceStorageBindings,
    arguments_: readonly RustTargetGenericArgument[], caller: RustTargetGenericBindings) => RustNativeStorageTargetBindingsSelection | undefined;
}

export type RustNativeStorageGenericSelection =
  | { readonly kind: "resolved"; readonly bindings: RustTargetGenericBindings;
      readonly sourceActivations: RustPhysicalCallableSourceActivations }
  | { readonly kind: "unresolved"; readonly reason: string };

export const rustNativeStorageProjectionSteps = 4096;
export const rustNativeStorageProjectionDepth = 128;

export function selectRustNativeStorageGenericBindings(input: RustNativeStorageGenericInput,
  declaration: Node, bindings: SourceStorageBindings): RustNativeStorageGenericSelection {
  let remaining = rustNativeStorageProjectionSteps;
  return createRustNativeStorageGenericSelection({ ...input,
    step: depth => remaining-- > 0 && depth <= rustNativeStorageProjectionDepth,
  })(declaration, bindings, 0);
}

export function createRustNativeStorageGenericSelection(input: RustNativeStorageGenericInput & {
  readonly step: (depth: number) => boolean;
}): (declaration: Node | undefined, bindings: SourceStorageBindings, depth: number) => RustNativeStorageGenericSelection {
  const empty: RustNativeStorageGenericSelection = Object.freeze({ kind: "resolved",
    bindings: snapshotRustCallableBindings({ types: new Map(), lifetimes: new Map(), consts: new Map() }),
    sourceActivations: Object.freeze({ kind: "unresolved", reason: "An absent source declaration has no callable activation selection." }) });
  const cache = new Map<Node, Map<SourceStorageBindings, RustNativeStorageGenericSelection | "resolving">>();
  const unresolved = (reason: string): RustNativeStorageGenericSelection => Object.freeze({ kind: "unresolved", reason });
  const lexicalOwners = new Map<Node, Node | null>();
  const classOwner = (declaration: Node): boolean => input.ast.is.IsClassDeclaration(declaration) ||
    input.ast.is.IsClassExpression(declaration);
  const ownBindings = (declaration: Node): boolean => input.ast.typeParameters(declaration).length !== 0 ||
    input.records.retainedEnvironment.get(declaration) !== undefined ||
    !classOwner(declaration) && rustCallableInputLifetimeParameters(declaration, input.ast, input.records).length !== 0;
  const lexicalOwnerFor = (declaration: Node, depth: number): Node | null | undefined => {
    const previous = lexicalOwners.get(declaration);
    if (previous !== undefined) return previous;
    const captures = input.records.closureCapture.get(declaration);
    const carriers = [input.records.sourceCallableReturn.get(declaration)?.returnCarrier,
      input.records.asyncFunction.get(declaration)?.futureCarrier,
      ...(classOwner(declaration) ? [input.records.runtimeCarrier.get(declaration)?.carrier]
        : input.ast.parameters(declaration).map(parameter => input.records.sourceParameterAbi.get(parameter)?.parameterCarrier)),
      ...[...captures?.captures ?? [], ...captures?.receiverFields ?? [], ...captures?.receivers ?? []].map(capture => capture.carrier),
    ].filter((carrier): carrier is TargetTypeRef => carrier !== undefined);
    const references = rustTargetGenericReferences({ kind: "tuple", elements: carriers });
    for (let owner = sourceEnclosingCallable(input.ast.parent(declaration), input.ast); owner !== undefined;
      owner = sourceEnclosingCallable(input.ast.parent(owner), input.ast)) {
      if (!input.step(depth++)) return undefined;
      const environment = input.records.retainedEnvironment.get(owner);
      const lifetimes = [...rustCallableInputLifetimeParameters(owner, input.ast, input.records)
        .flatMap(parameter => parameter.kind === "lifetime" ? [parameter.lifetime] : []),
        ...environment === undefined ? [] : [environment.lifetime]];
      if (input.ast.typeParameters(owner).some(parameter => references.typeIdentities.includes(sourceNodeIdentity(input.ast, parameter)!)) ||
        lifetimes.some(lifetime => references.lifetimeIdentities.includes(rustLifetimeKey(lifetime)))) {
        lexicalOwners.set(declaration, owner);
        return owner;
      }
    }
    lexicalOwners.set(declaration, null);
    return null;
  };
  const select = (declaration: Node | undefined, bindings: SourceStorageBindings, depth: number): RustNativeStorageGenericSelection => {
    if (!input.step(depth)) return unresolved("Native callable activation exceeds its bounded projection budget.");
    if (declaration === undefined) return empty;
    const previous = cache.get(declaration)?.get(bindings);
    if (previous === "resolving") return unresolved("Native callable activation requires a completed generic substitution.");
    if (previous !== undefined) return previous;
    const values = cache.get(declaration) ?? new Map<SourceStorageBindings, RustNativeStorageGenericSelection | "resolving">();
    values.set(bindings, "resolving");
    cache.set(declaration, values);
    const finish = (selection: RustNativeStorageGenericSelection): RustNativeStorageGenericSelection => {
      values.set(bindings, selection);
      return selection;
    };
    if (classOwner(declaration) && input.records.runtimeCarrier.get(declaration)?.carrier === undefined)
      return finish(unresolved("Native class activation requires its finalized selected class carrier."));
    const lexicalOwner = lexicalOwnerFor(declaration, depth + 1);
    if (lexicalOwner === undefined) return finish(unresolved("Native callable activation exceeds its bounded projection budget."));
    if (!ownBindings(declaration) && lexicalOwner === null) {
      const subject = input.storage.subject(declaration, "value");
      const validated = subject.kind === "unresolved" ? subject : input.storage.boundOriginsFor(subject.subject, bindings);
      if (validated.kind === "unresolved") return finish(validated);
      const selected = input.storage.boundActivationsFor(declaration, bindings);
      return finish(Object.freeze({ kind: "resolved", bindings: empty.bindings,
        sourceActivations: selected.kind === "unresolved" ? selected : Object.freeze({ kind: "resolved",
          rows: Object.freeze(selected.activations.map(activation => Object.freeze({ activation, targetBindings: empty.bindings }))) }) }));
    }
    const selected = input.storage.boundActivationsFor(declaration, bindings);
    if (selected.kind === "unresolved") return finish(selected);
    let result: RustTargetGenericBindings | undefined;
    const rows: Extract<RustPhysicalCallableSourceActivations, { readonly kind: "resolved" }>["rows"][number][] = [];
    for (const activation of selected.activations) {
      if (!input.step(depth)) return finish(unresolved("Native callable activation exceeds its bounded projection budget."));
      const lexical = select(lexicalOwner ?? undefined, activation.bindings, depth + 1);
      if (lexical.kind === "unresolved") return finish(lexical);
      let actual = lexical.bindings;
      if (activation.kind === "invocation") {
        const signature = input.records.selectedCall.get(activation.invocation);
        const operation = input.records.targetOperation.get(activation.invocation);
        if (signature === undefined || operation?.kind !== "source-call")
          return finish(unresolved("Native callable activation has no exact finalized invocation signature."));
        const caller = select(sourceEnclosingCallable(activation.invocation, input.ast), activation.callerBindings, depth + 1);
        if (caller.kind === "unresolved") return finish(caller);
        const arguments_ = (operation.targetGenericArguments ?? []).map(argument =>
          substituteRustTargetGenericArgument(argument, caller.bindings.types, caller.bindings.lifetimes, caller.bindings.consts));
        const generic = input.genericInvocationBindingsFor(declaration, activation.invocation, activation.callerBindings, arguments_, caller.bindings);
        if (generic?.kind === "unresolved") return finish(generic);
        const own = generic?.bindings ?? rustTargetGenericBindingsForArguments(signature.member.genericParameters ?? [], arguments_);
        const merged = own === undefined ? undefined : mergeBindings(actual, { ...own,
          lifetimes: new Map([...own.lifetimes, ...[...rustRetainedCallSubstitutions(input.records, activation.invocation)]
            .map(([identity, lifetime]) => [identity, caller.bindings.lifetimes.get(rustLifetimeKey(lifetime)) ?? lifetime] as const)]) });
        if (merged === undefined)
          return finish(unresolved("Native callable activation has inconsistent selected generic arguments."));
        actual = merged;
      }
      const completed = snapshotRustCallableBindings(actual);
      rows.push(Object.freeze({ activation, targetBindings: completed }));
      if (result !== undefined && !sameBindings(result, completed))
        return finish(unresolved("Native callable activation has distinct generic substitutions requiring a sealed join."));
      result = completed;
    }
    return finish(result === undefined ? unresolved("Native callable activation has no selected generic environment.")
      : Object.freeze({ kind: "resolved", bindings: result,
          sourceActivations: Object.freeze({ kind: "resolved", rows: Object.freeze(rows) }) }));
  };
  return select;
}

export function selectRustSourceMethodInvocation(input: {
  readonly ast: AstReader;
  readonly records: RustProgramRecords;
  readonly storage: SourceStorageQueries;
  readonly projectTypes: RustProjectTypePolicy;
  readonly projectMethodDispatch: RustProjectMethodDispatchPlan;
  readonly logicalCarrierFor: (subject: SourceStorageSubject, bindings: SourceStorageBindings) => TargetTypeRef | undefined;
}, invocation: Node, callerBindings: SourceStorageBindings, caller: RustTargetGenericBindings): TargetStageResult<readonly {
  readonly body: RustProjectMethodBodySelection;
  readonly adapter: RustProjectCallableAdapter;
  readonly receiver: SourceStorageProducer;
  readonly receiverCarrier: TargetTypeRef;
  readonly activation: SourceStorageBindings;
  readonly implementationBindings: RustTargetGenericBindings;
  readonly contractBindings: RustTargetGenericBindings;
  readonly receiverBindings: RustTargetGenericBindings;
}[]> | undefined {
  const operation = input.records.targetOperation.get(invocation);
  if (operation?.kind !== "source-call" || operation.target.form !== "method") return undefined;
  if (operation.target.dispatch === undefined) return resolvedTargetStage(Object.freeze([]));
  const reject = (reason: string): ReturnType<typeof rejectedTargetStage> => rejectedTargetStage([{
    code: "RUST_NATIVE_CALLABLE_ADAPTER_NOT_PROVEN", category: "error", source: "tsonic-rust", sourceNode: invocation,
    message: reason, evidence: ["target.capability=rust.callable-value.exact-implementation"],
  }]);
  const signature = input.records.selectedCall.get(invocation);
  const contract = asSourceNode(signature?.sourceDeclaration, input.ast);
  const checked = input.storage.source.semantics.forNode(invocation).operations.call(invocation);
  const receiver = checked?.sourceReceiver?.expression ?? checked?.sourceCalleeAccess?.receiver.expression;
  const receiverSubject = receiver === undefined ? undefined : input.storage.subjectFor(receiver);
  const calleeSubject = checked === undefined ? undefined : input.storage.subjectFor(checked.sourceCallee.expression);
  const implementations = input.storage.invocationImplementationsFor(invocation, callerBindings);
  const receiverProducers = receiverSubject?.kind !== "resolved" ? undefined
    : input.storage.storageProducersFor(receiverSubject.subject, callerBindings);
  const calleeProducers = calleeSubject?.kind !== "resolved" ? undefined
    : input.storage.storageProducersFor(calleeSubject.subject, callerBindings);
  if (contract === undefined || checked === undefined || implementations.kind !== "resolved" || !implementations.exact ||
    receiverProducers?.kind !== "complete" || calleeProducers?.kind !== "complete")
    return reject("A native method adaptation requires its exact checked receiver, implementation and correlated source activations.");
  const methodArguments = (operation.targetGenericArguments ?? []).flatMap(argument => argument.kind === "type"
    ? [substituteRustTargetGenerics(argument.type, caller.types, caller.lifetimes, caller.consts)] : []);
  const selectedReceiver = signature?.sourceSelectedReceiverCarrier;
  const variant = selectedReceiver === undefined ? undefined : input.projectMethodDispatch.variantForMember(contract,
    methodArguments, substituteRustTargetGenerics(selectedReceiver, caller.types, caller.lifetimes, caller.consts));
  if (variant === undefined) return reject("A native method adaptation requires its one already-selected original dispatch variant.");
  const rows: Extract<ReturnType<typeof selectRustSourceMethodInvocation>, { readonly kind: "resolved" }>["value"][number][] = [];
  for (const producer of calleeProducers.producers) {
    const selected = input.storage.source.navigation.callableImplementation(producer.subject.node);
    if (producer.subject.projection.length !== 0 || selected.kind !== "resolved" ||
      !implementations.nodes.includes(selected.implementation.declaration))
      return reject("A native method adaptation has an unselected original implementation activation.");
    const declaration = selected.implementation.declaration;
    const activation = input.storage.bindingsForInvocation(declaration, invocation, callerBindings, producer);
    const formalReceiver = input.storage.subject(declaration, "receiver");
    const actualReceivers = activation.kind !== "resolved" || formalReceiver.kind !== "resolved" ? undefined
      : input.storage.storageProducersFor(formalReceiver.subject, activation.bindings);
    if (activation.kind !== "resolved" || actualReceivers?.kind !== "complete")
      return reject("A native method adaptation lost the original implementation's exact receiver activation.");
    for (const actual of actualReceivers.producers) {
      if (!receiverProducers.producers.some(candidate => candidate.subject === actual.subject && candidate.bindings === actual.bindings))
        return reject("A native method adaptation cannot substitute an unrelated receiver or source binding.");
      const carrier = input.logicalCarrierFor(actual.subject, actual.bindings);
      const concrete = carrier === undefined ? undefined : input.projectTypes.definitionForCarrier(carrier);
      const named = rustSourceTypeCarrierValue(carrier);
      const body = concrete === undefined ? undefined : input.projectMethodDispatch.bodyFor(concrete, declaration, variant);
      const role = operation.target.dispatch.selected;
      const selectedBody = concrete === undefined ? undefined : input.projectMethodDispatch.implementationFor(concrete, variant, role);
      const adapters = concrete === undefined ? [] : (input.records.projectCallableAdapters.get(concrete.declaration) ?? [])
        .filter(adapter => adapter.contract === contract && adapter.implementation === declaration &&
          adapter.slot === (role === "virtual" ? variant.virtualSlot : variant.exactSlot));
      if (carrier === undefined || concrete?.kind !== "class" || named === undefined || body === undefined || selectedBody !== body || adapters.length !== 1)
        return reject("A native method adaptation requires its exact original concrete body and admitted callable adapter.");
      const parameters: RustTargetGenericArgument[] = concrete.genericParameters.map(parameter => parameter.kind === "lifetime"
        ? { kind: "lifetime", lifetime: parameter.lifetime }
        : { kind: "type", type: { kind: "type-parameter", identity: parameter.identity, name: parameter.targetName } });
      const bindings = rustGenericCallablePhysicalBindings(parameters, named.genericArguments);
      if (bindings === undefined) return reject("A native method adaptation requires the complete original concrete receiver arguments.");
      const bind = (selected: RustTargetGenericBindings): RustTargetGenericBindings | undefined => {
        const consts = new Map<string, RustTargetConstArgument>();
        for (const [identity, value] of selected.consts) {
          const argument = substituteRustTargetGenericArgument({ kind: "const", value }, bindings.types, bindings.lifetimes, bindings.consts);
          if (argument.kind !== "const") return undefined;
          consts.set(identity, argument.value);
        }
        return snapshotRustCallableBindings({
          types: new Map([...selected.types].map(([identity, type]) => [identity,
            substituteRustTargetGenerics(type, bindings.types, bindings.lifetimes, bindings.consts)])),
          lifetimes: new Map([...selected.lifetimes].map(([identity, lifetime]) =>
            [identity, bindings.lifetimes.get(rustLifetimeKey(lifetime)) ?? lifetime])),
          consts,
        });
      };
      const implementationBindings = bind(body.bindings);
      const contractBindings = bind(body.contractBindings);
      if (implementationBindings === undefined || contractBindings === undefined)
        return reject("A native method adaptation lost an original constant argument correspondence.");
      rows.push(Object.freeze({ body, adapter: adapters[0]!, receiver: actual, receiverCarrier: carrier,
        activation: activation.bindings, implementationBindings, contractBindings,
        receiverBindings: bindings }));
    }
  }
  return rows.length === 0 ? reject("A native method adaptation has no exact original receiver activation.")
    : resolvedTargetStage(Object.freeze(rows));
}

export function selectRustSourceCallableInvocationBindings(input: {
  readonly ast: AstReader;
  readonly storage: SourceStorageQueries;
  readonly records: RustProgramRecords;
  readonly lifetimes: RustLifetimeIndex;
  readonly generic: Pick<RustGenericCallablePlan, "implementationFor">;
  readonly projectTypes: RustProjectTypePolicy;
  readonly projectMethodDispatch: RustProjectMethodDispatchPlan;
  readonly logicalCarrierFor: (subject: SourceStorageSubject, bindings: SourceStorageBindings) => TargetTypeRef | undefined;
}, declaration: Node, invocation: Node, bindings: SourceStorageBindings,
  arguments_: readonly RustTargetGenericArgument[], caller: RustTargetGenericBindings): RustNativeStorageTargetBindingsSelection | undefined {
  const operation = input.records.targetOperation.get(invocation);
  if (operation?.kind !== "source-call") return undefined;
  const method = selectRustSourceMethodInvocation(input, invocation, bindings, caller);
  if (method?.kind === "rejected") return Object.freeze({ kind: "unresolved", reason: method.diagnostics[0]!.message });
  if (method?.kind === "resolved" && method.value.length !== 0) {
    const matching = method.value.filter(row => row.body.declaration === declaration);
    if (matching.length === 0 || matching.some(row => !sameBindings(row.implementationBindings, matching[0]!.implementationBindings)))
      return Object.freeze({ kind: "unresolved", reason: "A native method activation requires its exact single original implementation binder substitution." });
    return Object.freeze({ kind: "resolved", bindings: matching[0]!.implementationBindings });
  }
  if (method?.kind === "resolved") {
    const signature = input.records.selectedCall.get(invocation);
    if (asSourceNode(signature?.sourceDeclaration, input.ast) !== declaration)
      return Object.freeze({ kind: "unresolved", reason: "A direct native method activation requires its original selected source declaration." });
    const selected = rustTargetGenericBindingsForArguments(signature?.member.genericParameters ?? [], arguments_);
    return selected === undefined
      ? Object.freeze({ kind: "unresolved", reason: "A direct native method activation lost its exact selected generic arguments." })
      : Object.freeze({ kind: "resolved", bindings: selected });
  }
  const target = operation.target;
  const logical = target.form === "callable" ? target.carrier
    : target.form === "structural-method" || target.form === "constructor-value" ? target.callableCarrier : undefined;
  if (rustGenericCallableValue(logical) === undefined) return undefined;
  const unresolved = (): RustNativeStorageTargetBindingsSelection => Object.freeze({ kind: "unresolved",
    reason: "A generic activation lost its exact source implementation-to-invocation correspondence." });
  const callee = Node_Expression(input.ast, invocation);
  const subject = callee === undefined ? undefined : input.storage.subjectFor(callee);
  const producers = subject?.kind !== "resolved" ? undefined : input.storage.storageProducersFor(subject.subject, bindings);
  const implementation = input.generic.implementationFor(declaration);
  if (producers?.kind !== "complete" || implementation === undefined || !producers.producers.some(producer =>
    producer.subject.kind === "value" && producer.subject.projection.length === 0 && producer.subject.node === declaration)) return unresolved();
  const source = rustGenericCallableValue(implementation.carrier);
  const parameters = input.lifetimes.contractFor(declaration)?.parameters;
  const selected = parameters === undefined ? undefined : rustTargetGenericBindingsForArguments(parameters.map(parameter =>
    parameter.kind === "type" ? { kind: "type" as const, sourceName: parameter.sourceName, targetIdentity: parameter.identity }
      : { kind: "lifetime" as const, sourceName: parameter.lifetime.name, targetIdentity: rustLifetimeKey(parameter.lifetime) }), arguments_);
  if (source === undefined || selected === undefined) return unresolved();
  const methodArguments = arguments_.flatMap(argument => argument.kind === "type" ? [argument.type] : []);
  const pattern = rustGenericCallableProtocol(implementation.carrier, methodArguments);
  const independent = input.records.receiverIndependentMethod.get(declaration) !== undefined;
  const destination = target.form === "structural-method" && !independent
    ? rustStructuralMethodStorageCarrier(target.receiverCarrier, logical!, "required") : logical;
  const actualCarrier = destination === undefined ? undefined : substituteRustTargetGenerics(
    rustOptionElementCarrier(destination) ?? destination, caller.types, caller.lifetimes, caller.consts);
  const actual = rustGenericCallableProtocol(actualCarrier, methodArguments);
  const actualValue = rustGenericCallableValue(actualCarrier);
  if (pattern === undefined || actual === undefined || actualValue === undefined ||
    source.environment.length !== actualValue.environment.length) return unresolved();
  const template: TargetTypeRef = { kind: "tuple", elements: [...source.environment, ...pattern.parameters, pattern.result] };
  const references = rustTargetGenericReferences(template);
  const inferred = inferRustTargetGenericBindings(template,
    { kind: "tuple", elements: [...actualValue.environment, ...actual.parameters, actual.result] }, {
      typeIdentities: new Set(references.typeIdentities.filter(identity => !methodArguments.some(argument =>
        rustTargetGenericReferences(argument).typeIdentities.includes(identity)))),
      lifetimeIdentities: new Set(references.lifetimeIdentities), constIdentities: new Set(references.constIdentities),
    });
  const merged = inferred === undefined ? undefined : mergeBindings(selected, inferred);
  return merged === undefined ? unresolved() : Object.freeze({ kind: "resolved", bindings: merged });
}

function mergeBindings(left: RustTargetGenericBindings, right: RustTargetGenericBindings): RustTargetGenericBindings | undefined {
  const types = mergeEntries(left.types, right.types, rustTargetTypeRefEquals);
  const lifetimes = mergeEntries(left.lifetimes, right.lifetimes, rustLifetimesEqual);
  const consts = mergeEntries(left.consts, right.consts, (left, right) =>
    rustTargetGenericArgumentEquals({ kind: "const", value: left }, { kind: "const", value: right }));
  return types === undefined || lifetimes === undefined || consts === undefined ? undefined : Object.freeze({ types, lifetimes, consts });
}

function mergeEntries<Value>(left: ReadonlyMap<string, Value>, right: ReadonlyMap<string, Value>,
  equal: (left: Value, right: Value) => boolean): ReadonlyMap<string, Value> | undefined {
  const values = new Map(left);
  for (const [identity, value] of right) {
    const previous = values.get(identity);
    if (previous !== undefined && !equal(previous, value)) return undefined;
    values.set(identity, value);
  }
  return values;
}

function sameBindings(left: RustTargetGenericBindings, right: RustTargetGenericBindings): boolean {
  return left.types.size === right.types.size && left.lifetimes.size === right.lifetimes.size &&
    left.consts.size === right.consts.size && mergeBindings(left, right) !== undefined;
}
