import type { SourceArtifactFile } from "@tsonic/target-api/analysis";

export interface RustSourceArtifactRecords {
  readonly sourceArtifacts: { readonly get: () => readonly SourceArtifactFile[] | undefined };
  readonly externalSourceItems: { readonly get: () => ReadonlyMap<string, string> | undefined };
}
