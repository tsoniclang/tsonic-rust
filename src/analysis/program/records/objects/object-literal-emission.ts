import type { Node, SourceFile } from "@tsonic/tsts";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { RustObjectLiteralEmission, RustObjectLiteralEmissionRequest, RustObjectLiteralEmissionRecords } from "../../../../target-model/records/objects/object-literal-emission.js";
import type { RustTargetOperationFact } from "../../../../target-model/records/operations/operations.js";

export interface RustObjectLiteralEmissionProducer {
  readonly records: RustObjectLiteralEmissionRecords;
  literal(node: Node, value: RustObjectLiteralEmission): void;
  closed(node: Node, value: Extract<RustTargetOperationFact, { readonly kind: "closed-record-literal" }>): void;
  module(file: SourceFile, values: readonly RustObjectLiteralEmissionRequest[]): void;
}

export function createRustObjectLiteralEmissionProducer(assertOpen: () => void): RustObjectLiteralEmissionProducer {
  const literals = new WeakMap<Node, RustObjectLiteralEmission>();
  const closed = new WeakMap<Node, Extract<RustTargetOperationFact, { readonly kind: "closed-record-literal" }>>();
  const modules = new WeakMap<SourceFile, readonly RustObjectLiteralEmissionRequest[]>();
  return Object.freeze({ records: Object.freeze({
    closedRecord: Object.freeze({ get: (node: Node) => closed.get(node) }),
    objectLiteralEmission: Object.freeze({ get: (node: Node) => literals.get(node) }),
    objectLiteralEmissions: Object.freeze({ get: (file: SourceFile) => modules.get(file) }),
  }),
    closed(node: Node, value: Extract<RustTargetOperationFact, { readonly kind: "closed-record-literal" }>): void {
      assertOpen();
      if (closed.has(node)) failTargetAnalysisInvariant("tsonic-rust", "A closed record has one checked property and carrier admission owner.", node);
      closed.set(node, value);
    },
    literal(node: Node, value: RustObjectLiteralEmission): void {
      assertOpen();
      if (literals.has(node)) failTargetAnalysisInvariant("tsonic-rust", "An object literal has one exact native implementation owner.", node);
      literals.set(node, Object.freeze(value));
    },
    module(file: SourceFile, values: readonly RustObjectLiteralEmissionRequest[]): void {
      assertOpen();
      if (modules.has(file)) failTargetAnalysisInvariant("tsonic-rust", "A source module has one native object-literal emission inventory.", file);
      modules.set(file, Object.freeze(values));
    },
  });
}
