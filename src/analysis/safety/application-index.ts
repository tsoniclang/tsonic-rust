import type {
  AstReader,
  ReadonlySourceFactResolver,
  SourceFile,
} from "@tsonic/tsts";
import { createTargetSafetyApplicationIndex } from "@tsonic/target-api/analysis";
import type { SourceProgramNavigation } from "@tsonic/target-api/source";
import type { RustSafetyApplicationFactIndex } from "../../target-model/records/safety.js";
import {
  readRustSourceSafetyBuilder,
  readRustSourceUnsafeContext,
} from "../../policy/operations/safety/source-explicit-safety.js";

export interface RustSafetyApplicationFactIndexInput {
  readonly ast: AstReader;
  readonly sourceFiles: readonly SourceFile[];
  readonly sourceFacts: ReadonlySourceFactResolver;
  readonly navigation: SourceProgramNavigation;
}

export function createRustSafetyApplicationFactIndex(
  input: RustSafetyApplicationFactIndexInput,
): RustSafetyApplicationFactIndex {
  const index = createTargetSafetyApplicationIndex({
    ast: input.ast,
    sourceFiles: input.sourceFiles,
    navigation: input.navigation,
    readUnsafeContext: (subject) => readRustSourceUnsafeContext(input.sourceFacts, subject),
    readSafetyBuilder: (subject) => readRustSourceSafetyBuilder(input.sourceFacts, subject),
  });
  return Object.freeze({
    safetyApplication: Object.freeze({ get: index.forDeclaration }),
    safetyOperation: Object.freeze({ get: index.operationForExpression }),
    safetySubjectOperation: Object.freeze({ get: index.operationForSubject }),
    isCompileTimeApplicationReference: Object.freeze({ get: index.isCompileTimeApplicationReference }),
    findings: Object.freeze({ get: index.findings }),
  });
}
