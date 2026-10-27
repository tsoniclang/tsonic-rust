import type {
  TsonicSafetyBuilderFact,
  TsonicUnsafeContextFact,
} from "@tsonic/source-core/facts";
import type {
  AstReader,
  ReadonlySourceFactResolver,
  SourceFile,
} from "@tsonic/tsts";
import { createTargetSafetyApplicationIndex } from "@tsonic/target-api/analysis";
import type {
  TargetSafetyApplicationIndex,
} from "@tsonic/target-api/analysis";
import type { SourceProgramNavigation } from "@tsonic/target-api/source";
import {
  readRustSourceSafetyBuilder,
  readRustSourceUnsafeContext,
} from "../../source/extension/explicit-safety.js";

import type { RustSafetyApplication } from "../../target-model/records/storage/safety.js";

export type RustSafetyApplicationFactIndex = TargetSafetyApplicationIndex<
  TsonicUnsafeContextFact,
  TsonicSafetyBuilderFact,
  RustSafetyApplication
>;

export interface RustSafetyApplicationFactIndexInput {
  readonly ast: AstReader;
  readonly sourceFiles: readonly SourceFile[];
  readonly sourceFacts: ReadonlySourceFactResolver;
  readonly navigation: SourceProgramNavigation;
}

export function createRustSafetyApplicationFactIndex(
  input: RustSafetyApplicationFactIndexInput,
): RustSafetyApplicationFactIndex {
  return createTargetSafetyApplicationIndex({
    ast: input.ast,
    sourceFiles: input.sourceFiles,
    navigation: input.navigation,
    readUnsafeContext: (subject) => readRustSourceUnsafeContext(input.sourceFacts, subject),
    readSafetyBuilder: (subject) => readRustSourceSafetyBuilder(input.sourceFacts, subject),
  });
}
