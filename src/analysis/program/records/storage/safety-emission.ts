import type { Node } from "@tsonic/tsts";
import type { RustSafetyOperation } from "../../../../target-model/records/storage/safety.js";
import type { RustSafetyEmission, RustSafetyEmissionRecords, RustSafetyPlacement } from "../../../../target-model/records/storage/safety-emission.js";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";

export function createRustSafetyEmissionProducer(assertOpen: () => void) {
  const declarations = new Map<Node, ReadonlyMap<RustSafetyPlacement, boolean>>();
  const calls = new Map<Node, boolean>();
  const accessors = new Map<Node, ReadonlyMap<"getter" | "setter", boolean>>();
  const attributes = new Map<Node, RustSafetyEmission>();
  const operations = new Map<Node, RustSafetyOperation>();
  const records: RustSafetyEmissionRecords = Object.freeze({
    safetyOperation: Object.freeze({ get: (node: Node) => operations.get(node) }),
    declarationSafety: Object.freeze({ get: (node: Node, placement: RustSafetyPlacement) => declarations.get(node)?.get(placement) }),
    callSafety: Object.freeze({ get: (node: Node) => calls.get(node) }),
    accessorSafety: Object.freeze({ get: (node: Node, role: "getter" | "setter") => accessors.get(node)?.get(role) }),
    safetyAttributes: Object.freeze({ get: (node: Node) => attributes.get(node) }),
  });
  return Object.freeze({ records,
    subject(node: Node, declaration: ReadonlyMap<RustSafetyPlacement, boolean>, call: boolean,
      accessor: ReadonlyMap<"getter" | "setter", boolean>, selected: RustSafetyEmission, operation: RustSafetyOperation | undefined): void {
      assertOpen();
      if (declarations.has(node)) failTargetAnalysisInvariant("tsonic-rust", "Native safety emission has one exact source owner.", node);
      declarations.set(node, new Map(declaration)); calls.set(node, call);
      accessors.set(node, new Map(accessor)); attributes.set(node, Object.freeze(selected));
      if (operation !== undefined) operations.set(node, operation);
    },
  });
}

export type RustSafetyEmissionProducer = ReturnType<typeof createRustSafetyEmissionProducer>;
