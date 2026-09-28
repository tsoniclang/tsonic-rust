import type { RustNativeEvidence, RustNativeTypingEvidence } from "./evidence.js";
import { nativeNodeKey } from "./evidence.js";
import type { RustNativeBody, RustNativeLocal, RustNativeOccurrence } from "./occurrence-model.js";

type RustNativeExpression = Extract<RustNativeOccurrence, { readonly kind: "expression" }>;
type RustNativePattern = Extract<RustNativeOccurrence, { readonly kind: "pattern" }>;

export interface RustNativeBodyQueries {
  readonly result: (body: RustNativeBody) => RustNativeExpression;
  readonly parameters: (body: RustNativeBody) => readonly RustNativePattern[];
  readonly pattern: (local: RustNativeLocal) => RustNativePattern;
  readonly initializer: (local: RustNativeLocal) => RustNativeExpression | undefined;
  readonly parent: (occurrence: RustNativeOccurrence) => RustNativeOccurrence | undefined;
  readonly children: (occurrence: RustNativeOccurrence) => readonly RustNativeOccurrence[];
}

export function createRustNativeBodyQueries(evidence: RustNativeTypingEvidence | RustNativeEvidence): RustNativeBodyQueries {
  const nodes = new Map(evidence.occurrences.map(occurrence => [nativeNodeKey(occurrence.id), occurrence]));
  const bodies = new Set(evidence.bodies);
  const locals = new Set(evidence.bodies.flatMap(body => body.locals));
  const children = new Map<RustNativeOccurrence, RustNativeOccurrence[]>();
  for (const occurrence of evidence.occurrences) {
    if (occurrence.parent === null) continue;
    const parent = nodes.get(nativeNodeKey(occurrence.parent));
    if (parent === undefined) throw new Error("Native body queries require validated containment evidence.");
    const entries = children.get(parent);
    if (entries === undefined) children.set(parent, [occurrence]);
    else entries.push(occurrence);
  }
  for (const entries of children.values()) Object.freeze(entries);
  const empty = Object.freeze([]);
  const owned = <Value>(value: Value, values: ReadonlySet<Value>): void => {
    if (!values.has(value)) throw new Error("Native body query subject belongs to another evidence snapshot.");
  };
  const requireOccurrence = (occurrence: RustNativeOccurrence): void => {
    if (nodes.get(nativeNodeKey(occurrence.id)) !== occurrence) {
      throw new Error("Native body query subject belongs to another evidence snapshot.");
    }
  };
  const expression = (id: RustNativeExpression["id"]): RustNativeExpression => {
    const occurrence = nodes.get(nativeNodeKey(id));
    if (occurrence?.kind !== "expression") throw new Error("Native body query requires exact expression evidence.");
    return occurrence;
  };
  const pattern = (id: RustNativePattern["id"]): RustNativePattern => {
    const occurrence = nodes.get(nativeNodeKey(id));
    if (occurrence?.kind !== "pattern") throw new Error("Native body query requires exact pattern evidence.");
    return occurrence;
  };
  return Object.freeze({
    result(body: RustNativeBody): RustNativeExpression {
      owned(body, bodies);
      return expression(body.value);
    },
    parameters(body: RustNativeBody): readonly RustNativePattern[] {
      owned(body, bodies);
      return Object.freeze(body.parameters.map(pattern));
    },
    pattern(local: RustNativeLocal): RustNativePattern {
      owned(local, locals);
      return pattern(local.pattern);
    },
    initializer(local: RustNativeLocal): RustNativeExpression | undefined {
      owned(local, locals);
      return local.initializer === null ? undefined : expression(local.initializer);
    },
    parent(occurrence: RustNativeOccurrence): RustNativeOccurrence | undefined {
      requireOccurrence(occurrence);
      return occurrence.parent === null ? undefined : nodes.get(nativeNodeKey(occurrence.parent));
    },
    children(occurrence: RustNativeOccurrence): readonly RustNativeOccurrence[] {
      requireOccurrence(occurrence);
      return children.get(occurrence) ?? empty;
    },
  });
}
