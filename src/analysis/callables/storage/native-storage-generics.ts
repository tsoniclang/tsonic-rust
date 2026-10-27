import type { AstReader, Node } from "@tsonic/tsts";
import type { SourceStorageBindings, SourceStorageProducersSelection, SourceStorageQueries } from "@tsonic/target-api/analysis";
import { Node_Expression, sourceEnclosingCallable, sourceNodeIdentity } from "@tsonic/target-api/source";
import type { RustProgramRecords } from "../../../target-model/records/program.js";
import type { RustTargetGenericBindings } from "../../../target-model/types/carriers/generic-inference.js";
import { substituteRustTargetGenericArgument } from "../../../target-model/types/carriers/substitution.js";
import { rustTargetGenericBindingsForArguments, rustTargetGenericTypeArguments } from "../../../target-model/types/generic-arguments.js";
import { rustSourceTypeCarrierValue } from "../../../target-model/types/carriers/source-types.js";
import { rustTargetGenericArgumentEquals, rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import { rustLifetimeKey, rustLifetimesEqual } from "../../../target-model/lifetimes/index.js";

import { rustRetainedCallSubstitutions } from "../ownership/retained-call-lifetimes.js";

import { rustCallableInputLifetimeParameters } from "../ownership/source-input-lifetimes.js";
import { rustTargetGenericReferences } from "../../../target-model/types/carriers/generic-references.js";
import type { RustTargetGenericArgument, TargetTypeRef } from "../../../target-model/types/model.js";
import { inferRustTargetGenericBindings } from "../../../target-model/types/carriers/generic-inference.js";
import { rustGenericCallableProtocol, rustGenericCallableValue } from "../../../target-model/types/carriers/generic-callables.js";
import { rustStructuralMethodStorageCarrier } from "../../../policy/types/objects/member-storage.js";
import { rustOptionElementCarrier } from "../../../target-model/types/carriers/optional.js";
import { substituteRustTargetGenerics } from "../../../target-model/types/carriers/substitution.js";
import type { RustLifetimeIndex } from "../../../target-model/lifetimes/index.js";
import type { RustGenericCallablePlan } from "../generics/generic-values.js";
import type { RustPhysicalCallableSourceActivations } from "../../../target-model/records/physical-emission-contexts.js";
import { snapshotRustCallableBindings } from "../../../policy/types/callables/generic-bindings.js";

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
  // An instance member or constructor of a generic class is bound by its class's type parameters, which the
  // receiver (or constructed) instance selects at each activation.
  const classTypeParameters = (declaration: Node): readonly Node[] => {
    const owner = input.ast.parent(declaration);
    if (owner === undefined || !input.ast.is.IsClassDeclaration(owner) && !input.ast.is.IsClassExpression(owner)) return [];
    if (!input.ast.is.IsConstructorDeclaration(declaration) && !input.ast.is.IsMethodDeclaration(declaration) &&
      !input.ast.is.IsGetAccessorDeclaration(declaration) && !input.ast.is.IsSetAccessorDeclaration(declaration) ||
      input.ast.hasModifierKind(declaration, "static")) return [];
    return input.ast.typeParameters(owner).filter((parameter): parameter is Node => parameter !== undefined);
  };
  const ownBindings = (declaration: Node): boolean => input.ast.typeParameters(declaration).length !== 0 ||
    classTypeParameters(declaration).length !== 0 ||
    input.records.retainedEnvironment.get(declaration) !== undefined ||
    rustCallableInputLifetimeParameters(declaration, input.ast, input.records).length !== 0;
  // The class type parameter bindings an invocation's instance selects: the receiver of a member call, or the
  // constructed instance of a `new` expression.
  const classBindingsFor = (declaration: Node, invocation: Node, caller: RustTargetGenericBindings): RustTargetGenericBindings | undefined => {
    const parameters = classTypeParameters(declaration);
    if (parameters.length === 0) return Object.freeze({ types: new Map(), lifetimes: new Map(), consts: new Map() });
    const callee = input.ast.is.IsNewExpression(invocation) ? undefined : Node_Expression(input.ast, invocation);
    const instance = input.ast.is.IsNewExpression(invocation) ? invocation
      : callee !== undefined && (input.ast.is.IsPropertyAccessExpression(callee) || input.ast.is.IsElementAccessExpression(callee))
        ? Node_Expression(input.ast, callee) : undefined;
    const carrier = instance === undefined ? undefined : input.records.runtimeCarrier.get(instance)?.carrier;
    const sourceType = carrier === undefined ? undefined
      : rustSourceTypeCarrierValue(substituteRustTargetGenerics(carrier, caller.types, caller.lifetimes, caller.consts));
    // An instance that is not a nominal source-type carrier (an interface or structural view of the class) carries
    // no class arguments here; the member keeps the bindings its own activation selects, as before.
    if (sourceType === undefined) return Object.freeze({ types: new Map(), lifetimes: new Map(), consts: new Map() });
    const arguments_ = rustTargetGenericTypeArguments(sourceType.genericArguments);
    if (arguments_.length !== parameters.length) return undefined;
    const types = new Map<string, TargetTypeRef>();
    for (const [index, parameter] of parameters.entries()) {
      const identity = sourceNodeIdentity(input.ast, parameter);
      if (identity === undefined) return undefined;
      types.set(identity, arguments_[index]!);
    }
    return Object.freeze({ types, lifetimes: new Map(), consts: new Map() });
  };
  const lexicalOwnerFor = (declaration: Node, depth: number): Node | null | undefined => {
    const previous = lexicalOwners.get(declaration);
    if (previous !== undefined) return previous;
    const captures = input.records.closureCapture.get(declaration);
    const parameters = input.ast.is.IsClassDeclaration(declaration) || input.ast.is.IsClassExpression(declaration)
      ? [] : input.ast.parameters(declaration);
    const carriers = [input.records.sourceCallableReturn.get(declaration)?.returnCarrier,
      input.records.asyncFunction.get(declaration)?.futureCarrier,
      ...parameters.map(parameter => input.records.sourceParameterAbi.get(parameter)?.parameterCarrier),
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
        const instance = classBindingsFor(declaration, activation.invocation, caller.bindings);
        if (instance === undefined)
          return finish(unresolved("Native class member activation requires its exact instance type arguments."));
        const classBound = mergeBindings(actual, instance);
        if (classBound === undefined)
          return finish(unresolved("Native callable activation has inconsistent selected generic arguments."));
        actual = classBound;
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

export function selectRustSourceCallableInvocationBindings(input: {
  readonly ast: AstReader;
  readonly storage: SourceStorageQueries;
  readonly records: RustProgramRecords;
  readonly lifetimes: RustLifetimeIndex;
  readonly generic: Pick<RustGenericCallablePlan, "implementationFor">;
  readonly extendProducers: (selection: SourceStorageProducersSelection) => SourceStorageProducersSelection;
}, declaration: Node, invocation: Node, bindings: SourceStorageBindings,
  arguments_: readonly RustTargetGenericArgument[], caller: RustTargetGenericBindings): RustNativeStorageTargetBindingsSelection | undefined {
  const operation = input.records.targetOperation.get(invocation);
  if (operation?.kind !== "source-call") return undefined;
  const target = operation.target;
  const logical = target.form === "callable" ? target.carrier
    : target.form === "structural-method" || target.form === "constructor-value" ? target.callableCarrier : undefined;
  if (rustGenericCallableValue(logical) === undefined) return undefined;
  const unresolved = (): RustNativeStorageTargetBindingsSelection => Object.freeze({ kind: "unresolved",
    reason: "A generic activation lost its exact source implementation-to-invocation correspondence." });
  const callee = Node_Expression(input.ast, invocation);
  const subject = callee === undefined ? undefined : input.storage.subjectFor(callee);
  const producers = subject?.kind !== "resolved" ? undefined
    : input.extendProducers(input.storage.storageProducersFor(subject.subject, bindings));
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
  // A stored value whose declared type names no outer generic carries no environment, while its implementation may be
  // generic over the outer parameters it reads through its receiver; those bind from the receiver and signature.
  const storedEnvironment = actualValue?.environment.length === 0 ? [] : source.environment;
  if (pattern === undefined || actual === undefined || actualValue === undefined ||
    storedEnvironment.length !== actualValue.environment.length) return unresolved();
  const template: TargetTypeRef = { kind: "tuple", elements: [...storedEnvironment, ...pattern.parameters, pattern.result] };
  const references = rustTargetGenericReferences(template);
  const inferred = inferRustTargetGenericBindings(template,
    { kind: "tuple", elements: [...actualValue.environment, ...actual.parameters, actual.result] }, {
      typeIdentities: new Set(references.typeIdentities.filter(identity => !methodArguments.some(argument =>
        rustTargetGenericReferences(argument).typeIdentities.includes(identity)))),
      lifetimeIdentities: new Set(references.lifetimeIdentities), constIdentities: new Set(references.constIdentities),
    });
  const environmentReferences = rustTargetGenericReferences({ kind: "tuple", elements: [...source.environment] });
  if (inferred !== undefined && environmentReferences.typeIdentities.some(identity => !inferred.types.has(identity) &&
    !methodArguments.some(argument => rustTargetGenericReferences(argument).typeIdentities.includes(identity)))) return unresolved();
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
