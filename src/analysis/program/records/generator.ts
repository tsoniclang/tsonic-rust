import type { Node } from "@tsonic/tsts";
import type { RustGeneratorFact } from "../../../target-model/records/callables-and-resources.js";
import { rustGeneratorFactEquals } from "../../../target-model/records/equality.js";
import type { RustRecordFamily } from "../../../target-model/records/program.js";
import { rustGeneratorTargetType, rustAsyncGeneratorTargetType, type RustGeneratorProtocol } from "../../../target-model/types/index.js";
import { createRustRecordFamily } from "./family.js";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";

type RustGeneratorStorage = Pick<RustGeneratorFact, "capturedParameters" | "storage" | "ownedReceiver" | "reentry">;

export function rustGeneratorFact(protocol: RustGeneratorProtocol, retention: RustGeneratorStorage): RustGeneratorFact {
  if (retention.reentry !== "excluded" && retention.reentry !== "possible")
    failTargetAnalysisInvariant("tsonic-rust", "A generator requires its pre-seal source-storage reentry selection.");
  return Object.freeze({ kind: protocol.kind, reentry: retention.reentry,
    resultCarrier: protocol.kind === "sync" ? rustGeneratorTargetType(protocol) : rustAsyncGeneratorTargetType(protocol),
    yieldType: protocol.yieldType, returnType: protocol.returnType, nextType: protocol.nextType,
    capturedParameters: retention.capturedParameters, storage: retention.storage,
    ...(retention.ownedReceiver === undefined ? {} : { ownedReceiver: retention.ownedReceiver }),
  });
}

export interface RustGeneratorProducer {
  readonly records: RustRecordFamily<RustGeneratorFact>;
  suspend(declaration: Node, protocol: RustGeneratorProtocol, retention: RustGeneratorStorage): void;
}

export function createRustGeneratorProducer(
  assertOpen: () => void,
  inherited?: RustRecordFamily<RustGeneratorFact>,
): RustGeneratorProducer {
  const family = createRustRecordFamily<RustGeneratorFact>({ id: "tsonic.rust.generator", equals: rustGeneratorFactEquals,
  }, assertOpen, inherited);
  return Object.freeze({
    records: family.reader,
    suspend(declaration: Node, protocol: RustGeneratorProtocol, retention: RustGeneratorStorage): void {
      assertOpen();
      family.writer.set(declaration, rustGeneratorFact(protocol, retention));
    },
  });
}
