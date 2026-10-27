import type { Node } from "@tsonic/tsts";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { RustAnalysisRecords } from "../../../../target-model/records/analysis.js";

export type RustNodeRecordFamily = {
  [Family in keyof RustAnalysisRecords]: RustAnalysisRecords[Family] extends { readonly get: (subject: Node) => unknown } ? Family : never;
}[keyof RustAnalysisRecords];

export interface RustRequiredRecord {
  readonly subject: Node;
  readonly construct: string;
  readonly family: RustNodeRecordFamily;
  readonly producer: string;
}

export function requireRustRecord(
  requirements: RustRequiredRecord[],
  family: RustNodeRecordFamily,
  subject: Node,
  construct: string,
  producer: string,
): void {
  requirements.push({ subject, construct, family, producer });
}

export function assertRustRequiredRecords(
  records: RustAnalysisRecords,
  requirements: readonly RustRequiredRecord[],
): void {
  for (const requirement of requirements) {
    if (records[requirement.family].get(requirement.subject) === undefined) {
      failTargetAnalysisInvariant("tsonic-rust",
        `Required Rust semantic plan '${requirement.family}' was not published for '${requirement.construct}' by '${requirement.producer}'.`,
        requirement.subject);
    }
  }
}
