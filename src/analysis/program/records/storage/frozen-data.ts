import type { Node } from "@tsonic/tsts";
import type { RustFrozenDataWritePlan, RustFrozenReceiverCapturePlan } from "../../../../target-model/records/storage/frozen-data.js";
import type { RustFrozenWriteReceiver } from "../../../../target-model/records/storage/field-writes.js";
import type { TargetTypeRef } from "../../../../target-model/types/model.js";
import { rustSourceTypeCarrierValue } from "../../../../target-model/types/carriers/source-types.js";
import { closedMetadataKey } from "../../../../target-model/metadata/closed-data.js";

export function createRustFrozenDataWriteRecords(input: {
  readonly declarations: ReadonlyMap<Node, RustFrozenWriteReceiver>;
  readonly projectFields: ReadonlyMap<string, ReadonlyMap<number, RustFrozenWriteReceiver>>;
  readonly structuralFields: ReadonlyMap<string, ReadonlySet<number>>;
  readonly retained: RustFrozenReceiverCapturePlan | undefined;
}): RustFrozenDataWritePlan {
  const declarations = new WeakMap(input.declarations);
  const projectFields = new Map([...input.projectFields].map(([identity, fields]) => [identity, new Map(fields)]));
  const structuralFields = new Map([...input.structuralFields].map(([identity, fields]) => [identity, new Set(fields)]));
  return Object.freeze({
    receiverFor(storage: "project-object" | "structural-object", carrier: TargetTypeRef, index: number): RustFrozenWriteReceiver | undefined {
      if (storage === "structural-object") return structuralFields.get(closedMetadataKey(carrier))?.has(index) === true ? "receiver" : undefined;
      const source = rustSourceTypeCarrierValue(carrier);
      return source === undefined ? undefined : projectFields.get(JSON.stringify([source.fileName, source.typeName]))?.get(index);
    },
    receiverForDeclaration: (declaration: Node) => declarations.get(declaration),
    capturesFieldIdentity: (declaration: Node, reference?: Node) => input.retained?.capturesFieldIdentity(declaration, reference) === true,
  });
}

export function createRustFrozenReceiverCaptureRecords(entries: Iterable<readonly [Node, ReadonlySet<Node>]>): RustFrozenReceiverCapturePlan {
  const fields = new WeakMap(entries);
  return Object.freeze({ capturesFieldIdentity(declaration: Node, reference?: Node): boolean {
    const references = fields.get(declaration);
    return references !== undefined && (reference === undefined || references.has(reference));
  } });
}
