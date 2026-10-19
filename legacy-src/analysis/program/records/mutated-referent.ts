import type { Node } from "@tsonic/tsts";
import type { RustRecordFamily } from "../../../target-model/records/program.js";
import { createRustRecordFamily } from "./family.js";

export interface RustMutatedReferentProducer {
  readonly records: RustRecordFamily<{ readonly mutated: true }>;
  readonly mutableBindings: RustRecordFamily<{ readonly mutableBinding: true }>;
  written(declaration: Node): void;
  finalizeBindings(requiresMutableBinding: (declaration: Node) => boolean): void;
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
  const declarations = new Set<Node>();
  return Object.freeze({
    records: family.reader,
    mutableBindings: bindings.reader,
    written(declaration: Node): void {
      assertOpen();
      declarations.add(declaration);
      if (family.reader.get(declaration) === undefined) family.writer.set(declaration, mutated);
    },
    finalizeBindings(requiresMutableBinding: (declaration: Node) => boolean): void {
      assertOpen();
      for (const declaration of declarations) {
        if (bindings.reader.get(declaration) === undefined && requiresMutableBinding(declaration))
          bindings.writer.set(declaration, mutableBinding);
      }
    },
  });
}

const mutated = Object.freeze({ mutated: true as const });
const mutableBinding = Object.freeze({ mutableBinding: true as const });
