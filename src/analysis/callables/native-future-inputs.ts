import type { AstReader, Node } from "@tsonic/tsts";
import type { SourceStorageBindings, SourceStorageQueries, SourceStorageSubject } from "@tsonic/target-api/analysis";
import { sourceEnclosingCallable, sourceNodeIdentity } from "@tsonic/target-api/source";
import type { RustProgramRecords } from "../../target-model/records/program.js";

import type { TargetTypeRef } from "../../target-model/types/model.js";
import type { RustTypeDefinitions } from "../../target-model/types/source-union-definitions.js";
import { isRustNativeFutureCarrier } from "../../target-model/types/carriers/primitives.js";
import { rustOptionElementCarrier } from "../../target-model/types/carriers/optional.js";
import { rustUnionAlternatives } from "../../target-model/types/union-relations.js";
import { closedMetadataKey } from "../../target-model/metadata/closed-data.js";
import { isRustTargetTypeRef } from "../../target-model/types/equality.js";

import type { RustLexicalFunctionEnvironments } from "./lexical-functions.js";

export interface RustNativeFutureInput {
  readonly owner: Node;
  readonly subject: SourceStorageSubject;
  readonly carrier: TargetTypeRef;
  readonly implementation: Extract<TargetTypeRef, { readonly kind: "type-parameter" }>;
}

export type RustNativeFutureEnvironmentSelection =
  | { readonly kind: "resolved"; readonly inputs: readonly RustNativeFutureInput[];
      readonly captures: readonly RustNativeFutureInput[] }
  | { readonly kind: "unresolved"; readonly reason: string };

export interface RustNativeFutureInputPlan {
  forDeclaration(declaration: Node): RustNativeFutureEnvironmentSelection;
  forSubject(subject: SourceStorageSubject): readonly RustNativeFutureInput[];
}

export function createRustNativeFutureInputPlan(input: {
  readonly ast: AstReader;
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
    if (owner === undefined || !input.ast.parameters(owner).includes(subject.node)) return undefined;
    const identity = closedMetadataKey(carrier);
    const members = subjects.get(subject) ?? new Map<string, RustNativeFutureInput>();
    const existing = members.get(identity);
    if (existing !== undefined) return existing;
    const nodeIdentity = sourceNodeIdentity(input.ast, subject.node);
    const file = input.ast.getSourceFile(subject.node);
    if (nodeIdentity === undefined || file === undefined) return undefined;
    const projection = subject.projection.map(component => component.kind === "array-element" ? "array"
      : component.kind === "tuple-element" ? `tuple:${component.index}` : sourceNodeIdentity(input.ast, component.declaration));
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
    let remaining = 4096;
    const bindings = formal ? undefined : input.bindingsFor(owner);
    const visit = (current: TargetTypeRef, selected: SourceStorageSubject, depth: number,
      ancestors: ReadonlySet<string>): void => {
      if (remaining-- <= 0 || depth > 128) {
        fail(owner, "Native Future input discovery exceeds its bounded carrier projection budget.");
        return;
      }
      const identity = closedMetadataKey(current);
      if (ancestors.has(identity)) return;
      const next = new Set([...ancestors, identity]);
      const optional = rustOptionElementCarrier(current);
      if (optional !== undefined) {
        visit(optional, selected, depth + 1, next);
        return;
      }
      if (current.kind === "reference") {
        visit(current.referent, selected, depth + 1, next);
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
          if (remaining-- <= 0) {
            fail(owner, "Native Future input discovery exceeds its bounded carrier projection budget.");
            return;
          }
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
        for (const variant of variants) visit(variant.carrier, selected, depth + 1, next);
        return;
      }
      const project = (component: SourceStorageSubject["projection"][number], child: TargetTypeRef): void => {
        const result = input.storage.subject(selected.node, selected.kind, [...selected.projection, component]);
        if (result.kind === "resolved") visit(child, result.subject, depth + 1, next);
        else fail(owner, result.reason);
      };
      if (current.kind === "array" || current.kind === "slice") project({ kind: "array-element" }, current.element);
      else if (current.kind === "tuple")
        for (const [index, element] of current.elements.entries()) project({ kind: "tuple-element", index }, element);
    };
    visit(carrier, subject, 0, new Set());
  };
  for (const node of input.storage.nodes) {
    if (!input.ast.is.IsParameterDeclaration(node)) continue;
    const carrier = input.records.sourceParameterAbi.get(node)?.parameterCarrier;
    if (carrier === undefined) continue;
    const owner = input.ast.parent(node);
    if (owner === undefined || !input.ast.parameters(owner).includes(node)) continue;
    if (!isRustTargetTypeRef(carrier)) {
      fail(owner, "Native Future input discovery requires a valid finalized carrier.");
      continue;
    }
    const subject = input.storage.subject(node, "input");
    if (subject.kind === "resolved") inspect(owner, carrier, subject.subject, true);
    else fail(owner, subject.reason);
  }
  for (const declaration of input.storage.nodes) {
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
  const empty: readonly RustNativeFutureInput[] = Object.freeze([]);
  const inputsBySubject = new Map([...subjects].map(([subject, values]) => [subject, Object.freeze([...values.values()])]));
  const environments = new Map<Node, RustNativeFutureEnvironmentSelection>();
  const environmentFor = (declaration: Node): RustNativeFutureEnvironmentSelection => {
    const previous = environments.get(declaration);
    if (previous !== undefined) return previous;
    const callable = nodes.has(declaration) && (sourceEnclosingCallable(declaration, input.ast) === declaration ||
      input.ast.is.IsMethodSignatureDeclaration(declaration) || input.ast.is.IsCallSignatureDeclaration(declaration) ||
      input.ast.is.IsConstructSignatureDeclaration(declaration) || input.ast.is.IsFunctionTypeNode(declaration) ||
      input.ast.is.IsConstructorTypeNode(declaration));
    const reason = !callable
      ? "Native Future environment requires an owned callable declaration."
      : failures.get(declaration) ?? [...captures.get(declaration) ?? []].map(capture => failures.get(capture.owner))
        .find(failure => failure !== undefined);
    const selected: RustNativeFutureEnvironmentSelection = reason === undefined ? Object.freeze({ kind: "resolved",
      inputs: Object.freeze(owners.get(declaration) ?? []), captures: Object.freeze([...captures.get(declaration) ?? []]) })
      : Object.freeze({ kind: "unresolved", reason });
    if (nodes.has(declaration)) environments.set(declaration, selected);
    return selected;
  };
  return Object.freeze({
    forDeclaration: environmentFor,
    forSubject: (subject: SourceStorageSubject) => inputsBySubject.get(subject) ?? empty,
  });
}
