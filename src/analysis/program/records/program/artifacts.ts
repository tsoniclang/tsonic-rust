import type { SourceArtifactFile } from "@tsonic/target-api/analysis";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { RustSourceArtifactRecords } from "../../../../target-model/records/program/artifacts.js";

export function createRustSourceArtifactProducer(assertOpen: () => void) {
  let files: readonly SourceArtifactFile[] | undefined;
  let items: ReadonlyMap<string, string> | undefined;
  const records: RustSourceArtifactRecords = Object.freeze({
    sourceArtifacts: Object.freeze({ get: () => files }),
    externalSourceItems: Object.freeze({ get: () => items }),
  });
  return Object.freeze({ records,
    publish(sourceFiles: readonly SourceArtifactFile[], externalItems: ReadonlyMap<string, string>): void {
      assertOpen();
      if (files !== undefined || items !== undefined)
        failTargetAnalysisInvariant("tsonic-rust", "Source artifacts have one exact closed producer.");
      files = Object.freeze([...sourceFiles]);
      items = new Map(externalItems);
    },
  });
}

export type RustSourceArtifactProducer = ReturnType<typeof createRustSourceArtifactProducer>;
