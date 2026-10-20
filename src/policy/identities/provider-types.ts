import { mergeProviderDeclarationIdentities } from "./selected-source.js";
import { providerVirtualDeclarationFactKey } from "@tsonic/tsts";

import type { ExtensionFactSubject, ProviderDeclarationIdentity } from "@tsonic/tsts";

import type { RustSourcePolicyContext } from "../model/context.js";

export function resolveProviderTypeIdentity(
  subjects: readonly ExtensionFactSubject[],
  context: Pick<RustSourcePolicyContext, "source">,
): ProviderDeclarationIdentity | undefined {
  let selected: ProviderDeclarationIdentity | undefined;
  for (const subject of subjects) {
    const fact = context.source.sourceFacts.getFact(subject, providerVirtualDeclarationFactKey);
    if (fact === undefined) {
      continue;
    }
    if (selected === undefined) {
      selected = fact;
      continue;
    }
    const merged = mergeProviderDeclarationIdentities(selected, fact);
    if (merged === undefined) {
      return undefined;
    }
    selected = merged;
  }
  return selected;
}
