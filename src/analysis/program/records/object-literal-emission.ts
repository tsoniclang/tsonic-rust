import type { Node, SourceFile } from "@tsonic/tsts";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { RustObjectLiteralEmission, RustObjectLiteralEmissionRequest, RustObjectLiteralEmissionRecords } from "../../../target-model/records/object-literal-emission.js";

export interface RustObjectLiteralEmissionProducer {
  readonly records: RustObjectLiteralEmissionRecords;
  literal(node: Node, value: RustObjectLiteralEmission): void;
  module(file: SourceFile, values: readonly RustObjectLiteralEmissionRequest[]): void;
}

export function createRustObjectLiteralEmissionProducer(assertOpen: () => void): RustObjectLiteralEmissionProducer {
  const literals = new WeakMap<Node, RustObjectLiteralEmission>();
  const modules = new WeakMap<SourceFile, readonly RustObjectLiteralEmissionRequest[]>();
  return Object.freeze({ records: Object.freeze({
    objectLiteralEmission: Object.freeze({ get: (node: Node) => literals.get(node) }),
    objectLiteralEmissions: Object.freeze({ get: (file: SourceFile) => modules.get(file) }),
  }),
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
