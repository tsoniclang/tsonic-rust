import type { Node } from "@tsonic/tsts";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { RustAnalysisRecords } from "./model.js";

export interface RustRequiredRecord {
  readonly subject: Node;
  readonly construct: string;
  readonly family: keyof RustAnalysisRecords;
  readonly producer: string;
}

export function requireRustRecord(
  requirements: RustRequiredRecord[],
  family: keyof RustAnalysisRecords,
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
