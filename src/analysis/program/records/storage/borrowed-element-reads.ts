import type { Node } from "@tsonic/tsts";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { RustBorrowedElementRecords, RustBorrowedElementRead, RustBorrowedElementLocal, RustBorrowedIterationBinding } from "../../../../target-model/records/storage/borrowed-element-reads.js";
import type { RustBorrowedElementReads } from "../../../storage/borrowed-element-reads.js";
import { createRustRecordFamily } from "../family.js";

export interface RustBorrowedElementProducer {
  readonly records: RustBorrowedElementRecords;
  publish(nodes: readonly Node[], selected: RustBorrowedElementReads): void;
}

export function createRustBorrowedElementProducer(assertOpen: () => void): RustBorrowedElementProducer {
  let published = false;
  const reads = createRustRecordFamily<RustBorrowedElementRead>({ id: "tsonic.rust.borrowedElementRead", equals: (left, right) => left === right }, assertOpen);
  const appends = createRustRecordFamily<boolean>({ id: "tsonic.rust.borrowedElementAppend", equals: (left, right) => left === right }, assertOpen);
  const elements = createRustRecordFamily<RustBorrowedElementRead>({ id: "tsonic.rust.borrowedElement", equals: (left, right) => left === right }, assertOpen);
  const locals = createRustRecordFamily<RustBorrowedElementLocal>({ id: "tsonic.rust.borrowedElementLocal", equals: (left, right) => left === right }, assertOpen);
  const endings = createRustRecordFamily<readonly RustBorrowedElementLocal[]>({ id: "tsonic.rust.borrowedElementEnds", equals: (left, right) => left === right }, assertOpen);
  const iterations = createRustRecordFamily<RustBorrowedIterationBinding>({ id: "tsonic.rust.borrowedIterationBinding", equals: (left, right) => left === right }, assertOpen);
  return Object.freeze({ records: Object.freeze({ borrowedElementAppend: appends.reader, borrowedElementRead: reads.reader, borrowedElement: elements.reader,
    borrowedElementLocal: locals.reader, borrowedElementEnds: endings.reader, borrowedIterationBinding: iterations.reader }),
    publish(nodes: readonly Node[], selected: RustBorrowedElementReads): void {
      assertOpen();
      if (published) failTargetAnalysisInvariant("tsonic-rust", "Borrowed-element records publish exactly once.");
      published = true;
      for (const node of nodes) {
        const read = selected.forExpression(node);
        const element = selected.forRead(node);
        const local = selected.forStatement(node);
        const ending = selected.endingAt(node);
        const iteration = selected.forIteration(node);
        if (read !== undefined) { reads.writer.set(node, read); appends.writer.set(node, selected.isAppend(node)); }
        if (element !== undefined) elements.writer.set(node, element);
        if (local !== undefined) locals.writer.set(node, local);
        if (ending.length !== 0) endings.writer.set(node, Object.freeze([...ending]));
        if (iteration !== undefined) iterations.writer.set(node, iteration);
      }
    },
  });
}
