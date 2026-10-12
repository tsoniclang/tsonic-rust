import type { AstReader, Node } from "@tsonic/tsts";
import type { SourceStorageBindings, SourceStorageQueries, SourceStorageSubject } from "@tsonic/target-api/analysis";
import { sourceEnclosingCallable, sourceNodeIdentity } from "@tsonic/target-api/source";
import type { RustPlanQueries } from "../../target-model/facts/selections.js";
import { rustRuntimeCarrierKey } from "../../target-model/facts/selections.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import type { RustTypeDefinitions } from "../../target-model/types/source-union-definitions.js";
import { isRustNativeFutureCarrier } from "../../target-model/types/carriers/primitives.js";
import { rustOptionElementCarrier } from "../../target-model/types/carriers/optional.js";
import { rustUnionAlternatives } from "../../target-model/types/union-relations.js";
import { closedMetadataKey } from "../../target-model/metadata/closed-data.js";
import { rustSourceParameterAbiFactKey } from "../facts/keys.js";

export interface RustNativeFutureInput {
  readonly owner: Node;
  readonly subject: SourceStorageSubject;
  readonly carrier: TargetTypeRef;
  readonly implementation: Extract<TargetTypeRef, { readonly kind: "type-parameter" }>;
}

export interface RustNativeFutureInputPlan {
  inputsFor(declaration: Node): readonly RustNativeFutureInput[];
  capturesFor(declaration: Node): readonly RustNativeFutureInput[];
  forSubject(subject: SourceStorageSubject): readonly RustNativeFutureInput[];
  failureReason(): string | undefined;
}

export function createRustNativeFutureInputPlan(input: {
  readonly ast: AstReader;
  readonly storage: SourceStorageQueries;
  readonly facts: RustPlanQueries;
  readonly definitions: RustTypeDefinitions;
  readonly bindingsFor: (declaration: Node) => SourceStorageBindings | undefined;
}): RustNativeFutureInputPlan {
  const subjects = new Map<SourceStorageSubject, Map<string, RustNativeFutureInput>>();
  const owners = new Map<Node, RustNativeFutureInput[]>();
  const captures = new Map<Node, Set<RustNativeFutureInput>>();
  let failure: string | undefined;
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
  const inspect = (node: Node, carrier: TargetTypeRef, subject: SourceStorageSubject, formal: boolean): void => {
    let remaining = 4096;
    const owner = sourceEnclosingCallable(node, input.ast);
    const bindings = owner === undefined ? undefined : input.bindingsFor(owner);
    const visit = (current: TargetTypeRef, selected: SourceStorageSubject, depth: number,
      ancestors: ReadonlySet<string>): void => {
      if (remaining-- <= 0 || depth > 128) {
        failure ??= "Native Future input discovery exceeds its bounded carrier projection budget.";
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
        if (formal) { select(selected, current); return; }
        if (bindings === undefined || owner === undefined) return;
        const origins = input.storage.boundOriginsFor(selected, bindings);
        if (origins.kind === "unresolved") return;
        for (const origin of origins.subjects) {
          if (remaining-- <= 0) { failure ??= "Native Future input discovery exceeds its bounded carrier projection budget."; return; }
          const parameter = subjects.get(origin)?.get(closedMetadataKey(current));
          if (parameter === undefined || parameter.owner === owner) continue;
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
        else failure ??= result.reason;
      };
      if (current.kind === "array" || current.kind === "slice") project({ kind: "array-element" }, current.element);
      else if (current.kind === "tuple")
        for (const [index, element] of current.elements.entries()) project({ kind: "tuple-element", index }, element);
    };
    visit(carrier, subject, 0, new Set());
  };
  for (const node of input.storage.nodes) {
    if (!input.ast.is.IsParameterDeclaration(node)) continue;
    const carrier = input.facts.getFact(node, rustSourceParameterAbiFactKey)?.parameterCarrier;
    if (carrier === undefined) continue;
    const subject = input.storage.subject(node, "input");
    if (subject.kind === "resolved") inspect(node, carrier, subject.subject, true);
  }
  for (const node of input.storage.nodes) {
    const carrier = input.facts.getFact(node, rustRuntimeCarrierKey)?.carrier;
    if (carrier === undefined) continue;
    const subject = input.storage.subjectFor(node);
    if (subject.kind === "resolved") inspect(node, carrier, subject.subject, false);
  }
  const empty: readonly RustNativeFutureInput[] = Object.freeze([]);
  const inputsByOwner = new Map([...owners].map(([owner, values]) => [owner, Object.freeze(values)]));
  const capturesByOwner = new Map([...captures].map(([owner, values]) => [owner, Object.freeze([...values])]));
  const inputsBySubject = new Map([...subjects].map(([subject, values]) => [subject, Object.freeze([...values.values()])]));
  return Object.freeze({
    inputsFor: (declaration: Node) => inputsByOwner.get(declaration) ?? empty,
    capturesFor: (declaration: Node) => capturesByOwner.get(declaration) ?? empty,
    forSubject: (subject: SourceStorageSubject) => inputsBySubject.get(subject) ?? empty,
    failureReason: () => failure,
  });
}
