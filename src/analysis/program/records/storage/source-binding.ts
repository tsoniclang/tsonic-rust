import type { Node } from "@tsonic/tsts";
import type { RustRecordFamily } from "../../../../target-model/records/program.js";
import type { RustSourceBindingFact } from "../../../../target-model/records/objects/value-projections.js";
import { createRustRecordFamily } from "../family.js";
import { rustSourceBindingFactEquals } from "../../../../target-model/records/operations/equality.js";

export interface RustSourceBindingProducer {
  readonly records: RustRecordFamily<RustSourceBindingFact>;
  lexical(reference: Node, declaration: Node, sourceName: string): Extract<RustSourceBindingFact, { readonly scope: "lexical" }>;
  module(reference: Node, declaration: Node, sourceName: string, fileName: string): Extract<RustSourceBindingFact, { readonly scope: "module" }>;
}

export function createRustSourceBindingProducer(
  assertOpen: () => void,
  inherited?: RustRecordFamily<RustSourceBindingFact>,
): RustSourceBindingProducer {
  const family = createRustRecordFamily<RustSourceBindingFact>({ id: "tsonic.rust.sourceBinding", equals: rustSourceBindingFactEquals }, assertOpen, inherited);
  return Object.freeze({
    records: family.reader,
    lexical(reference: Node, declaration: Node, sourceName: string): Extract<RustSourceBindingFact, { readonly scope: "lexical" }> {
      assertOpen();
      const fact = Object.freeze({ scope: "lexical" as const, sourceName, sourceDeclaration: declaration });
      family.writer.set(reference, fact);
      return fact;
    },
    module(reference: Node, declaration: Node, sourceName: string, fileName: string): Extract<RustSourceBindingFact, { readonly scope: "module" }> {
      assertOpen();
      const fact = Object.freeze({ scope: "module" as const, sourceName, fileName, sourceDeclaration: declaration });
      family.writer.set(reference, fact);
      return fact;
    },
  });
}
