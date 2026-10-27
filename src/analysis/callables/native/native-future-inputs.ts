import type { AstReader, Node } from "@tsonic/tsts";
import type { SourceStorageBindings, SourceStorageQueries, SourceStorageSubject } from "@tsonic/target-api/analysis";
import { isSourceCallableBodyBoundary, sourceNodeIdentity, sourceCallableValueParameters } from "@tsonic/target-api/source";
import type { RustProgramRecords } from "../../../target-model/records/program.js";

import type { TargetTypeRef } from "../../../target-model/types/model.js";
import type { RustTypeDefinitions } from "../../../target-model/types/source-union-definitions.js";
import { isRustNativeFutureCarrier } from "../../../target-model/types/carriers/primitives.js";
import { rustCallableProtocol } from "../../../target-model/types/carriers/callables.js";
import { rustGenericCallableValue } from "../../../target-model/types/carriers/generic-callables.js";
import { rustFrameCallableValue } from "../../../target-model/types/carriers/frame-callables.js";
import { rustTargetTypeChildren } from "../../../target-model/types/carriers/children.js";
import { rustSourceUnionCarrierValue, rustStructuralObjectCarrierValue } from "../../../target-model/types/carriers/source-types.js";
import { rustOptionElementCarrier } from "../../../target-model/types/carriers/optional.js";
import { rustUnionAlternatives } from "../../../target-model/types/union-relations.js";
import { closedMetadataKey } from "../../../target-model/metadata/closed-data.js";
import { isRustTargetTypeRef } from "../../../target-model/types/equality.js";

import type { RustLexicalFunctionEnvironments } from "../../../target-model/records/callables/lexical-functions.js";

import type { RustNativeFutureInput, RustNativeFutureEnvironmentSelection, RustNativeFutureInputPlan } from "../../../target-model/records/native/native-future-inputs.js";
import { sealRustNativeFutureInputs } from "../../program/records/native/native-future-inputs.js";
import { rustNativeStorageProjectionDepth, rustNativeStorageProjectionSteps } from "../storage/native-storage-generics.js";

export function selectRustNativeFutureTypeDemand(carrier: TargetTypeRef, definitions: RustTypeDefinitions,
  step: (depth: number) => boolean, depth: number):
  | { readonly kind: "resolved"; readonly future: boolean }
  | { readonly kind: "unresolved"; readonly reason: string } {
  const pending = [{ carrier, depth }];
  const seen = new Set<string>();
  let future = false;
  while (pending.length !== 0) {
    const selected = pending.pop();
    if (selected === undefined) break;
    const current = selected.carrier;
    const identity = closedMetadataKey(current);
    if (seen.has(identity)) continue;
    if (!step(selected.depth)) return Object.freeze({ kind: "unresolved",
      reason: "Native storage TYPE demand exceeds its bounded carrier projection budget." });
    seen.add(identity);
    if (current.kind === "closure" || current.kind === "function-pointer") continue;
    if (isRustNativeFutureCarrier(current)) {
      future = true;
      continue;
    }
    if (rustCallableProtocol(current) !== undefined || rustGenericCallableValue(current) !== undefined ||
      rustFrameCallableValue(current) !== undefined) {
      continue;
    }
    const variants = rustUnionAlternatives(current, definitions);
    if (rustSourceUnionCarrierValue(current) !== undefined && (variants === undefined || variants.length === 0))
      return Object.freeze({ kind: "unresolved", reason: "Native storage TYPE demand requires its admitted source union payload inventory." });
    const structural = rustStructuralObjectCarrierValue(current);
    const children = structural === undefined ? rustTargetTypeChildren(current) : [...structural.bases, ...structural.fields
      .filter(field => field.method !== true && field.accessor === undefined).map(field => field.type)];
    for (const child of [...children, ...(variants?.map(variant => variant.carrier) ?? [])])
      pending.push({ carrier: child, depth: selected.depth + 1 });
  }
  return Object.freeze({ kind: "resolved", future });
}

export function createRustNativeFutureInputPlan(input: {
  readonly ast: AstReader;
  readonly nativeNodes: readonly Node[];
  readonly storage: SourceStorageQueries;
  readonly records: RustProgramRecords;
  readonly definitions: RustTypeDefinitions;
  readonly lexicalFunctions: RustLexicalFunctionEnvironments;
  readonly bindingsFor: (declaration: Node) => SourceStorageBindings | undefined;
}): RustNativeFutureInputPlan {
  const subjects = new Map<SourceStorageSubject, Map<string, RustNativeFutureInput>>();
  const owners = new Map<Node, RustNativeFutureInput[]>();
  const captures = new Map<Node, Set<RustNativeFutureInput>>();
  const nodes = new Set(input.storage.nodes);
  const failures = new Map<Node, string>();
  const fail = (owner: Node, reason: string): void => { if (!failures.has(owner)) failures.set(owner, reason); };
  const select = (subject: SourceStorageSubject, carrier: TargetTypeRef): RustNativeFutureInput | undefined => {
    if (subject.kind !== "input" || !isRustNativeFutureCarrier(carrier)) return undefined;
    const owner = input.ast.parent(subject.node);
    if (owner === undefined || sourceCallableValueParameters(input.ast, owner, input.storage.source.semantics.forNode(owner))?.includes(subject.node) !== true) return undefined;
    const identity = closedMetadataKey(carrier);
    const members = subjects.get(subject) ?? new Map<string, RustNativeFutureInput>();
    const existing = members.get(identity);
    if (existing !== undefined) return existing;
    const nodeIdentity = sourceNodeIdentity(input.ast, subject.node);
    const file = input.ast.getSourceFile(subject.node);
    if (nodeIdentity === undefined || file === undefined) return undefined;
    const projection = subject.projection.map(component => component.kind === "array-element" ? "array"
      : component.kind === "tuple-element" ? `tuple:${component.index}`
      : sourceNodeIdentity(input.ast, component.declaration));
    if (projection.some(component => component === undefined)) return undefined;
    const declarations = owners.get(owner) ?? [];
    const value: RustNativeFutureInput = Object.freeze({ owner, subject, carrier,
      implementation: Object.freeze({ kind: "type-parameter", name: `Future${declarations.length}`,
        identity: `native-future:${input.ast.getFileName(file)}:${nodeIdentity}:${JSON.stringify(projection)}:${identity}` }),
    });
    members.set(identity, value);
    subjects.set(subject, members);
    declarations.push(value);
    owners.set(owner, declarations);
    return value;
  };
  const inspect = (owner: Node, carrier: TargetTypeRef, subject: SourceStorageSubject, formal: boolean): void => {
    const bindings = formal ? undefined : input.bindingsFor(owner);
    let remaining = rustNativeStorageProjectionSteps;
    const step = (depth: number): boolean => remaining-- > 0 && depth <= rustNativeStorageProjectionDepth;
    const initialDemand = selectRustNativeFutureTypeDemand(carrier, input.definitions, step, 0);
    if (initialDemand.kind === "unresolved") { fail(owner, initialDemand.reason); return; }
    if (!initialDemand.future) return;
    const visit = (current: TargetTypeRef, selected: SourceStorageSubject,
      ancestors: ReadonlySet<string>): void => {
      const identity = closedMetadataKey(current);
      if (ancestors.has(identity)) return;
      const next = new Set([...ancestors, identity]);
      const optional = rustOptionElementCarrier(current);
      if (optional !== undefined) {
        visit(optional, selected, next);
        return;
      }
      if (current.kind === "reference") {
        visit(current.referent, selected, next);
        return;
      }
      if (isRustNativeFutureCarrier(current)) {
        if (formal) {
          if (select(selected, current) === undefined)
            fail(owner, "Native Future input requires its exact owned formal identity.");
          return;
        }
        if (bindings === undefined) {
          fail(owner, "Native Future capture requires exact declaration-local bindings.");
          return;
        }
        const origins = input.storage.boundOriginsFor(selected, bindings);
        if (origins.kind === "unresolved") { fail(owner, origins.reason); return; }
        for (const origin of origins.subjects) {
          const checked = input.storage.typeFor(origin);
          if (checked.kind === "unresolved") { fail(owner, checked.reason); return; }
          if (origin.kind !== "input") continue;
          const parameter = subjects.get(origin)?.get(closedMetadataKey(current));
          if (parameter === undefined) {
            fail(owner, "Native Future capture has no exact registered formal payload.");
            return;
          }
          if (parameter.owner === owner) continue;
          const values = captures.get(owner) ?? new Set<RustNativeFutureInput>();
          values.add(parameter);
          captures.set(owner, values);
        }
        return;
      }
      const variants = rustUnionAlternatives(current, input.definitions);
      if (variants !== undefined) {
        for (const variant of variants) {
          const demand = selectRustNativeFutureTypeDemand(variant.carrier, input.definitions, step, next.size);
          if (demand.kind === "unresolved") { fail(owner, demand.reason); return; }
          if (demand.future) visit(variant.carrier, selected, next);
        }
        return;
      }
      const project = (component: SourceStorageSubject["projection"][number], child: TargetTypeRef): void => {
        const result = input.storage.subject(selected.node, selected.kind, [...selected.projection, component]);
        if (result.kind === "resolved") visit(child, result.subject, next);
        else fail(owner, result.reason);
      };
      if (current.kind === "array" || current.kind === "slice") project({ kind: "array-element" }, current.element);
      else if (current.kind === "tuple") {
        for (const [index, element] of current.elements.entries()) {
          const demand = selectRustNativeFutureTypeDemand(element, input.definitions, step, next.size);
          if (demand.kind === "unresolved") { fail(owner, demand.reason); return; }
          if (demand.future) project({ kind: "tuple-element", index }, element);
        }
      }
    };
    visit(carrier, subject, new Set());
  };
  for (const node of input.nativeNodes) {
    if (!input.ast.is.IsParameterDeclaration(node)) continue;
    const carrier = input.records.sourceParameterAbi.get(node)?.parameterCarrier;
    if (carrier === undefined) continue;
    const owner = input.ast.parent(node);
    if (owner === undefined || sourceCallableValueParameters(input.ast, owner, input.storage.source.semantics.forNode(owner))?.includes(node) !== true) continue;
    if (!isRustTargetTypeRef(carrier)) {
      fail(owner, "Native Future input discovery requires a valid finalized carrier.");
      continue;
    }
    const subject = input.storage.subject(node, "input");
    if (subject.kind === "resolved") inspect(owner, carrier, subject.subject, true);
    else fail(owner, subject.reason);
  }
  for (const declaration of input.nativeNodes) {
    const fact = input.records.closureCapture.get(declaration);
    const lexical = input.lexicalFunctions.forDeclaration(declaration);
    if (lexical?.kind === "unresolved") { fail(declaration, lexical.reason); continue; }
    const selected = [...fact?.captures ?? [], ...fact?.receiverFields ?? [], ...fact?.receivers ?? [],
      ...lexical?.captures.map(capture => ({ reference: capture.reference,
        carrier: input.records.runtimeCarrier.get(capture.declaration)?.carrier ??
          input.records.runtimeCarrier.get(capture.reference)?.carrier })) ?? []];
    for (const capture of selected) {
      if (!nodes.has(capture.reference) || !isRustTargetTypeRef(capture.carrier)) {
        fail(declaration, "Native Future capture requires its exact owned reference and valid finalized carrier.");
        continue;
      }
      const subject = input.storage.subjectFor(capture.reference);
      if (subject.kind === "resolved") inspect(declaration, capture.carrier, subject.subject, false);
      else fail(declaration, subject.reason);
    }
  }
  const inputsBySubject = new Map([...subjects].map(([subject, values]) => [subject, Object.freeze([...values.values()])]));
  const environments = new Map<Node, RustNativeFutureEnvironmentSelection>();
  for (const declaration of input.nativeNodes) {
    if (!isSourceCallableBodyBoundary(input.ast, declaration) &&
      !input.ast.is.IsMethodSignatureDeclaration(declaration) && !input.ast.is.IsCallSignatureDeclaration(declaration) &&
      !input.ast.is.IsConstructSignatureDeclaration(declaration) && !input.ast.is.IsFunctionTypeNode(declaration) &&
      !input.ast.is.IsConstructorTypeNode(declaration)) continue;
    const reason = failures.get(declaration) ?? [...captures.get(declaration) ?? []].map(capture => failures.get(capture.owner))
      .find(failure => failure !== undefined);
    const selected: RustNativeFutureEnvironmentSelection = reason === undefined ? Object.freeze({ kind: "resolved",
      inputs: Object.freeze(owners.get(declaration) ?? []), captures: Object.freeze([...captures.get(declaration) ?? []]) })
      : Object.freeze({ kind: "unresolved", reason });
    environments.set(declaration, selected);
  }
  return sealRustNativeFutureInputs(environments, inputsBySubject);
}
