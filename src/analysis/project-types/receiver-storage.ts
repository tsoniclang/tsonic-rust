import type { AstReader, Node, SourceFile } from "@tsonic/tsts";
import type { SourceProgramNavigation, SourceProgramSemantics } from "@tsonic/target-api/source";
import type { RustProjectTypeDefinition, RustProjectTypePolicy } from "./type-policy.js";
import { analyzeRustReceiverFieldAliases, type RustReceiverFieldAliasQueries } from "./receiver-field-aliases.js";
import { analyzeRustConstructionEffects } from "./construction-effects.js";
import { analyzeRustReceiverFieldCaptures, type RustReceiverFieldCaptureQueries } from "./receiver-captures.js";

export interface RustReceiverStorageInput {
  readonly ast: AstReader;
  readonly navigation: SourceProgramNavigation;
  readonly semantics: SourceProgramSemantics;
  readonly projectTypes: RustProjectTypePolicy;
  readonly sourceFiles: readonly SourceFile[];
}

export interface RustReceiverStoragePlan extends RustReceiverFieldAliasQueries {
  readonly captures: RustReceiverFieldCaptureQueries;
  publishedFieldWrites(definition: RustProjectTypeDefinition): readonly Node[];
}

export function analyzeRustReceiverStorage(input: RustReceiverStorageInput): RustReceiverStoragePlan {
  const aliases = analyzeRustReceiverFieldAliases(input);
  const effects = new Map(input.projectTypes.definitions.map(definition => {
    const effect = analyzeRustConstructionEffects(definition, input, aliases);
    return [definition, Object.freeze({
      publishedFieldWrites: Object.freeze([...effect.publishedFieldWrites]),
      deferredCaptureFields: Object.freeze([...effect.deferredCaptureFields]),
    })] as const;
  }));
  const captures = analyzeRustReceiverFieldCaptures({ ...input,
    isStoredField: declaration => aliases.aliasFor(declaration) === undefined,
    deferredFields: new Set([...effects.values()].flatMap(effect => effect.deferredCaptureFields)),
  });
  const empty: readonly Node[] = Object.freeze([]);
  return Object.freeze({ ...aliases, captures,
    publishedFieldWrites: (definition: RustProjectTypeDefinition) => effects.get(definition)?.publishedFieldWrites ?? empty,
  });
}
