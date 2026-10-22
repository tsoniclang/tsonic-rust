import type { TargetCompileInput } from "@tsonic/target-api";
import type { TargetSourceSyntaxProgram } from "@tsonic/target-api/analysis";
import type { RustProgramRecords } from "./program.js";
import type { SourceLiteralIndex } from "@tsonic/target-api/source";

export interface RustTargetProgram {
  readonly source: Pick<TargetSourceSyntaxProgram, "ast">;
  readonly records: RustProgramRecords & SourceLiteralIndex;
  readonly host: {
    readonly paths: TargetCompileInput["paths"];
    readonly entryPoint: string;
    readonly sourcePackages: TargetCompileInput["sourcePackages"];
  };
}
