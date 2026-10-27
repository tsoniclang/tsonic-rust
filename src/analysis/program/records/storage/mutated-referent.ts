import type { Node } from "@tsonic/tsts";
import type { RustRecordFamily } from "../../../../target-model/records/program.js";
import { createRustRecordFamily } from "../family.js";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";

export interface RustReferentWrite {
  readonly target: Node;
  readonly receivers: readonly { readonly expression: Node; readonly use: Node }[];
}

export interface RustMutatedReferentProducer {
  readonly records: RustRecordFamily<{ readonly mutated: true }>;
  readonly mutableBindings: RustRecordFamily<{ readonly mutableBinding: true }>;
  written(declaration: Node, write: RustReferentWrite): void;
  finalizeBindings(requiresMutableBinding: (declaration: Node, writes: readonly RustReferentWrite[]) => boolean): void;
}

export function createRustMutatedReferentProducer(
  assertOpen: () => void,
  inherited?: RustRecordFamily<{ readonly mutated: true }>,
  inheritedBindings?: RustRecordFamily<{ readonly mutableBinding: true }>,
): RustMutatedReferentProducer {
  const family = createRustRecordFamily<{ readonly mutated: true }>({
    id: "tsonic.rust.mutatedReferent", equals: () => true,
  }, assertOpen, inherited);
  const bindings = createRustRecordFamily<{ readonly mutableBinding: true }>({
    id: "tsonic.rust.mutatedReferentBinding", equals: () => true,
  }, assertOpen, inheritedBindings);
  const declarations = new Map<Node, Map<Node, RustReferentWrite>>();
  let finalized = false;
  return Object.freeze({
    records: family.reader,
    mutableBindings: bindings.reader,
    written(declaration: Node, write: RustReferentWrite): void {
      assertOpen();
      if (finalized) failTargetAnalysisInvariant("tsonic-rust", "Referent writes must precede their native binding finalization.", declaration);
      if (write.receivers.length === 0) failTargetAnalysisInvariant("tsonic-rust", "A referent write requires its actual receiver path.", write.target);
      let writes = declarations.get(declaration);
      if (writes === undefined) { writes = new Map(); declarations.set(declaration, writes); }
      const previous = writes.get(write.target);
      if (previous !== undefined && (previous.receivers.length !== write.receivers.length ||
        previous.receivers.some((receiver, index) => receiver.expression !== write.receivers[index]?.expression ||
          receiver.use !== write.receivers[index]?.use)))
        failTargetAnalysisInvariant("tsonic-rust", "A referent write retains one exact source receiver path.", write.target);
      if (previous === undefined) writes.set(write.target, Object.freeze({ target: write.target,
        receivers: Object.freeze(write.receivers.map(receiver => Object.freeze({ ...receiver }))) }));
      if (family.reader.get(declaration) === undefined) family.writer.set(declaration, mutated);
    },
    finalizeBindings(requiresMutableBinding: (declaration: Node, writes: readonly RustReferentWrite[]) => boolean): void {
      assertOpen();
      if (finalized) failTargetAnalysisInvariant("tsonic-rust", "Referent binding mutability is finalized once.");
      finalized = true;
      for (const [declaration, writes] of declarations) {
        const mutable = requiresMutableBinding(declaration, Object.freeze([...writes.values()]));
        if (bindings.reader.get(declaration) === undefined && mutable)
          bindings.writer.set(declaration, mutableBinding);
      }
    },
  });
}

const mutated = Object.freeze({ mutated: true as const });
const mutableBinding = Object.freeze({ mutableBinding: true as const });
