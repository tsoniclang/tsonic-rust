import type { AstReader, Node } from "@tsonic/tsts";
import type { TargetSourcePackageGraph } from "@tsonic/target-api";
import type { SourceStorageBindings, SourceStorageQueries, SourceStorageSubject } from "@tsonic/target-api/analysis";
import { sourceEnclosingCallable, sourceNodeIdentity, Node_Expression } from "@tsonic/target-api/source";
import type { RustProgramRecords } from "../../target-model/records/program.js";

import type { TargetTypeRef } from "../../target-model/types/model.js";
import { rustCallableProtocol } from "../../target-model/types/carriers/callables.js";
import { rustGenericCallableProtocol, rustGenericCallableValue } from "../../target-model/types/carriers/generic-callables.js";
import { rustOptionElementCarrier } from "../../target-model/types/carriers/optional.js";
import { rustCallableInvocationSignaturesMatch } from "../../target-model/conversions/callable-input.js";

import { isRustNeverCarrier } from "../../target-model/types/carriers/js.js";
import type { RustTypeDefinitions } from "../../target-model/types/source-union-definitions.js";
import { createRustNativeCallableProtocolRegistry, type RustNativeCallableProtocol, type RustNativeCallableProtocolBinding } from "./native-protocols.js";
import { rustNativeCallableErrorType } from "./native-protocols.js";
import { rustNativeCallableCompletion, type RustNativeCallableCompletion } from "../../target-model/types/callable-completions.js";
import { closedMetadataKey } from "../../target-model/metadata/closed-data.js";
import { rustNativeCallableInvocationArguments } from "./native-invocations.js";
import { rustJsPromiseOutputTargetType } from "../../target-model/types/carriers/promises.js";
import { rustJsRejectionErrorIdentity } from "../../target-model/records/error-effects.js";

export interface RustNativeCallableInput extends RustNativeCallableProtocolBinding {
  readonly owner: Node;
  readonly subject: SourceStorageSubject;
  readonly carrier: TargetTypeRef;
  readonly implementation: Extract<TargetTypeRef, { readonly kind: "type-parameter" }>;
}

export type RustNativeCallableOrigins =
  | { readonly kind: "resolved"; readonly inputs: readonly RustNativeCallableInput[];
      readonly implementations: readonly SourceStorageSubject[] }
  | { readonly kind: "unresolved"; readonly reason: string };

export interface RustNativeCallableCall {
  readonly node: Node;
  readonly input: RustNativeCallableInput;
  readonly invocationError: TargetTypeRef;
  readonly invocationErrorSource: string;
  readonly completion?: RustNativeCallableCompletion;
  readonly awaitErrors: readonly TargetTypeRef[];
  readonly awaitErrorSources: readonly string[];
}

export interface RustNativeCallableInputPlan {
  readonly inputs: readonly RustNativeCallableInput[];
  readonly protocols: readonly RustNativeCallableProtocol[];
  readonly calls: readonly RustNativeCallableCall[];
  callFor(node: Node): RustNativeCallableCall | undefined;
  inputsFor(declaration: Node): readonly RustNativeCallableInput[];
  capturesFor(declaration: Node): readonly RustNativeCallableInput[];
  originsFor(declaration: Node, subject: SourceStorageSubject, carrier: TargetTypeRef): RustNativeCallableOrigins;
  originsForValue(node: Node): RustNativeCallableOrigins;
  bindingsFor(declaration: Node): SourceStorageBindings | undefined;
  protocolForSourceItem(fileName: string, typeName: string): RustNativeCallableProtocol | undefined;
}

export function createRustNativeCallableInputPlan(input: {
  readonly ast: AstReader;
  readonly nativeNodes: readonly Node[];
  readonly storage: SourceStorageQueries;
  readonly records: RustProgramRecords;
  readonly definitions: RustTypeDefinitions;
  readonly sourcePackages: TargetSourcePackageGraph;
  readonly usedNames: Set<string>;
}): RustNativeCallableInputPlan {
  const registry = createRustNativeCallableProtocolRegistry(input);
  const componentByFile = new Map(input.sourcePackages.packages.flatMap(entry =>
    entry.sourceFiles.map(fileName => [fileName, entry.componentId] as const)));
  const ownerByComponent = new Map<string, string>();
  for (const fileName of input.storage.sourceFiles.map(file => input.ast.getFileName(file)).sort()) {
    const component = componentByFile.get(fileName);
    if (component !== undefined && !ownerByComponent.has(component)) ownerByComponent.set(component, fileName);
  }
  const bindings = new Map<Node, SourceStorageBindings | null>();
  const inputs = new Map<Node, Map<SourceStorageSubject, RustNativeCallableInput>>();
  const captures = new Map<Node, Set<RustNativeCallableInput>>();
  const values = new Map<Node, RustNativeCallableOrigins>();
  let collecting = true;
  const bindingsFor = (declaration: Node): SourceStorageBindings | undefined => {
    const existing = bindings.get(declaration);
    if (existing !== undefined) return existing ?? undefined;
    const selected = input.storage.bindingsForLexicalOwner(declaration);
    const result = selected.kind === "resolved" ? selected.bindings : undefined;
    bindings.set(declaration, result ?? null);
    return result;
  };
  const selectInput = (subject: SourceStorageSubject, carrier: TargetTypeRef): RustNativeCallableInput | undefined => {
    if (subject.kind !== "input") return undefined;
    const owner = input.ast.parent(subject.node);
    if (owner === undefined || !input.ast.parameters(owner).includes(subject.node)) return undefined;
    const selected = rustOptionElementCarrier(carrier) ?? carrier;
    if (rustGenericCallableProtocol(selected) === undefined && rustCallableProtocol(selected) === undefined) return undefined;
    const members = inputs.get(owner) ?? new Map<SourceStorageSubject, RustNativeCallableInput>();
    const existing = members.get(subject);
    if (existing !== undefined) {
      const contract = rustOptionElementCarrier(existing.carrier) ?? existing.carrier;
      return rustCallableInvocationSignaturesMatch(contract, selected) ? existing : undefined;
    }
    if (!collecting) return undefined;
    const identity = sourceNodeIdentity(input.ast, subject.node);
    const file = input.ast.getSourceFile(subject.node);
    if (identity === undefined || file === undefined) return undefined;
    const projection = subject.projection.map(component => component.kind === "array-element" ? "array"
      : component.kind === "tuple-element" ? `tuple:${component.index}`
      : sourceNodeIdentity(input.ast, component.declaration));
    if (projection.some(component => component === undefined)) return undefined;
    const nativeIdentity = `native-callable:${input.ast.getFileName(file)}:${identity}:${JSON.stringify(projection)}`;
    const component = componentByFile.get(input.ast.getFileName(file));
    const ownerFileName = component === undefined ? undefined : ownerByComponent.get(component);
    const protocol = ownerFileName === undefined ? undefined : registry.bind(ownerFileName, carrier);
    if (protocol === undefined) return undefined;
    const value: RustNativeCallableInput = Object.freeze({ owner, subject, carrier, ...protocol,
      implementation: Object.freeze({ kind: "type-parameter", name: `Implementation${members.size}`,
        identity: nativeIdentity }),
    });
    members.set(subject, value);
    inputs.set(owner, members);
    return value;
  };
  const originsFor = (declaration: Node, subject: SourceStorageSubject, carrier: TargetTypeRef): RustNativeCallableOrigins => {
    const selectedBindings = bindingsFor(declaration);
    if (selectedBindings === undefined) return { kind: "unresolved", reason: "Native callable storage requires an exact declaration-local input boundary." };
    const origins = input.storage.boundOriginsFor(subject, selectedBindings);
    if (origins.kind !== "resolved") return origins;
    const parameters = new Set<RustNativeCallableInput>();
    const implementations = new Set<SourceStorageSubject>();
    for (const origin of origins.subjects) {
      if (origin.kind === "return" && origin.projection.length === 0 &&
        isRustNeverCarrier(input.records.sourceCallableReturn.get(origin.node)?.returnCarrier)) continue;
      if (origin.kind !== "input") {
        implementations.add(origin);
        continue;
      }
      const parameter = selectInput(origin, carrier);
      if (parameter === undefined) return { kind: "unresolved", reason: "Native callable input identity or selected carrier is inconsistent." };
      parameters.add(parameter);
      if (collecting && parameter.owner !== declaration) {
        const selected = captures.get(declaration) ?? new Set<RustNativeCallableInput>();
        selected.add(parameter);
        captures.set(declaration, selected);
      }
    }
    return Object.freeze({ kind: "resolved", inputs: Object.freeze([...parameters]),
      implementations: Object.freeze([...implementations]) });
  };
  for (const node of input.nativeNodes) {
    if (!input.ast.is.IsParameterDeclaration(node)) continue;
    const carrier = input.records.sourceParameterAbi.get(node)?.valueCarrier ??
      input.records.runtimeCarrier.get(node)?.carrier;
    if (carrier === undefined) continue;
    const selected = rustOptionElementCarrier(carrier) ?? carrier;
    if (rustGenericCallableValue(selected) === undefined && rustCallableProtocol(selected) === undefined) continue;
    const subject = input.storage.subject(node, "input");
    if (subject.kind === "resolved") selectInput(subject.subject, carrier);
  }
  for (const node of input.nativeNodes) {
    const carrier = input.records.runtimeCarrier.get(node)?.carrier;
    if (carrier === undefined) continue;
    const selected = rustOptionElementCarrier(carrier) ?? carrier;
    if (rustGenericCallableValue(selected) === undefined && rustCallableProtocol(selected) === undefined) continue;
    const owner = sourceEnclosingCallable(node, input.ast);
    if (owner === undefined) continue;
    const subject = input.storage.subjectFor(node);
    if (subject.kind === "resolved") values.set(node, originsFor(owner, subject.subject, carrier));
  }
  collecting = false;
  const selectedInputs = Object.freeze([...inputs.values()].flatMap(members => [...members.values()]));
  const definitions = registry.definitions();
  const protocols = new Map(definitions.map(protocol => [protocol.targetName, protocol]));
  const calls = new Map<Node, RustNativeCallableCall>();
  for (const node of input.storage.invocations) {
    const operation = input.records.targetOperation.get(node);
    if (operation?.kind !== "source-call" || operation.target.form !== "callable") continue;
    const callee = Node_Expression(input.ast, node);
    const origins = callee === undefined ? undefined : values.get(callee);
    if (origins?.kind !== "resolved" || origins.inputs.length !== 1 || origins.implementations.length !== 0) continue;
    const parameter = origins.inputs[0]!;
    const methodArguments = rustNativeCallableInvocationArguments(parameter, operation);
    if (methodArguments === undefined) continue;
    const completion = rustNativeCallableCompletion(operation.resultCarrier, input.definitions);
    if ((completion?.futures.length ?? 0) !== (parameter.protocol.completion?.futures.length ?? 0)) continue;
    const invocationError = rustNativeCallableErrorType(parameter, parameter.implementation, "invocation", methodArguments)!;
    const awaitErrors = (completion?.futures ?? []).map(future =>
      rustNativeCallableErrorType(parameter, parameter.implementation, future.ordinal, methodArguments)!);
    const source = `${parameter.implementation.identity}:${closedMetadataKey(methodArguments)}`;
    calls.set(node, Object.freeze({ node, input: parameter, invocationError,
      invocationErrorSource: `${source}:invocation`,
      ...(completion === undefined ? {} : { completion }), awaitErrors: Object.freeze(awaitErrors),
      awaitErrorSources: Object.freeze(awaitErrors.map((_error, index) =>
        rustJsPromiseOutputTargetType(completion!.futures[index]!.carrier) === undefined
          ? `${source}:await:${index}` : rustJsRejectionErrorIdentity)) }));
  }
  const declarationInputs = new Map([...inputs].map(([owner, members]) => [owner, Object.freeze([...members.values()])]));
  const declarationCaptures = new Map([...captures].map(([owner, members]) => [owner, Object.freeze([...members])]));
  const emptyInputs: readonly RustNativeCallableInput[] = Object.freeze([]);
  return Object.freeze({ bindingsFor, originsFor, inputs: selectedInputs, protocols: definitions,
    calls: Object.freeze([...calls.values()]), callFor: (node: Node) => calls.get(node),
    inputsFor: (declaration: Node) => declarationInputs.get(declaration) ?? emptyInputs,
    capturesFor: (declaration: Node) => declarationCaptures.get(declaration) ?? emptyInputs,
    originsForValue: (node: Node) => values.get(node) ?? Object.freeze({ kind: "unresolved" as const,
      reason: "The value has no exact sealed declaration-local native callable origins." }),
    protocolForSourceItem: (fileName: string, typeName: string) => {
      const protocol = protocols.get(typeName);
      return protocol?.ownerFileName === fileName ? protocol : undefined;
    },
  });
}
