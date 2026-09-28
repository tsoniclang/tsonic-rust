import { defineExtensionFactKey } from "@tsonic/tsts";
import type {
  ProviderVirtualDeclarationFact,
  SourceElaborationNodeReference,
  SourceElaborationResolverContext,
} from "@tsonic/tsts";
import type { RustCompilerMacroExport } from "../../providers/model/compiler-exports.js";
import { snapshotClosedMetadata, closedMetadataEquals } from "../../target-model/metadata/closed-data.js";
import type { RustLexicalTokenTree, RustNativeMacroInput } from "../../target-model/syntax/token-tree.js";
import { rustSourceSemanticsExtensionId } from "./identity.js";
import { readRustSourceMacroInput } from "./macro-input.js";
import { readRustSourceProviderSelection } from "./native-selection.js";

export interface RustSourceNativeServices {
  readonly macro: (declaration: ProviderVirtualDeclarationFact) => RustCompilerMacroExport | undefined;
  readonly tokenize: (source: string) => readonly RustLexicalTokenTree[];
}

export type RustSourceNativeFragment =
  | { readonly kind: "expression"; readonly source: SourceElaborationNodeReference }
  | { readonly kind: "type"; readonly source: SourceElaborationNodeReference; readonly type: SourceElaborationNodeReference }
  | { readonly kind: "items"; readonly source: SourceElaborationNodeReference;
      readonly scope: SourceElaborationNodeReference; readonly body: SourceElaborationNodeReference };

export type RustSourceNativeInput =
  | { readonly kind: "not-native" }
  | { readonly kind: "rejected"; readonly source: SourceElaborationNodeReference; readonly reason: string }
  | { readonly kind: "invocation"; readonly source: SourceElaborationNodeReference;
      readonly binding: SourceElaborationNodeReference; readonly declaration: ProviderVirtualDeclarationFact;
      readonly macro: RustCompilerMacroExport; readonly input: RustNativeMacroInput<RustSourceNativeFragment> };

export const rustSourceNativeInputFactKey = defineExtensionFactKey<RustSourceNativeInput>({
  extensionId: rustSourceSemanticsExtensionId,
  name: "nativeInvocationInput",
  snapshot: snapshotClosedMetadata,
  equals: closedMetadataEquals,
});

export function resolveRustSourceNativeInput(
  context: SourceElaborationResolverContext,
  native: RustSourceNativeServices,
): RustSourceNativeInput {
  const { ast } = context.source;
  const file = ast.getSourceFile(context.node);
  if (file === undefined) throw new Error("Native invocation input requires an exact current source file.");
  const reference = context.source.getSourceFileQueries(file).checker.getProviderReferenceInfo;
  const call = ast.is.IsCallExpression(context.node) ? ast.as.AsCallExpression(context.node) : undefined;
  const tagged = ast.is.IsTaggedTemplateExpression(context.node) ? ast.as.AsTaggedTemplateExpression(context.node) : undefined;
  const callee = call?.Expression ?? tagged?.Tag;
  if (callee === undefined) return rejected(context, "Native invocation input requires a call or tagged template.");
  const selected = readRustSourceProviderSelection(callee, { ast, reference });
  if (selected.kind === "unavailable" || selected.kind === "ordinary") return Object.freeze({ kind: "not-native" });
  if (selected.kind === "rejected") {
    return Object.freeze({ kind: "rejected", source: context.reference(selected.subject), reason: selected.reason });
  }
  if (selected.kind === "ambiguous") {
    return native.macro(selected.reference.intrinsic!) === undefined
      ? Object.freeze({ kind: "not-native" })
      : rejected(context, "The native binding has both macro and ordinary facets; select native.macro or native.value explicitly.");
  }
  const macro = native.macro(selected.intrinsic);
  if (macro === undefined) return Object.freeze({ kind: "not-native" });
  if (macro.macroKind !== "declarative" && macro.macroKind !== "function") {
    return rejected(context, "Native attribute and derive macros require an attribute application, not a function-like invocation.");
  }
  const input = readRustSourceMacroInput<RustSourceNativeFragment>(context.node, {
    ast,
    reference,
    tokenize: native.tokenize,
    fragment(fragment) {
      const source = context.reference(fragment.source);
      switch (fragment.kind) {
        case "expression": return Object.freeze({ kind: "expression", source });
        case "type": return Object.freeze({ kind: "type", source, type: context.reference(fragment.type) });
        case "items": return Object.freeze({ kind: "items", source,
          scope: context.reference(fragment.scope), body: context.reference(fragment.body) });
      }
    },
  });
  if (input.kind === "rejected") {
    return Object.freeze({ kind: "rejected", source: context.reference(input.subject), reason: input.reason });
  }
  return Object.freeze({ kind: "invocation", source: context.reference(context.node),
    binding: context.reference(selected.expression), declaration: selected.intrinsic, macro, input: input.input });
}

function rejected(context: SourceElaborationResolverContext, reason: string): RustSourceNativeInput {
  return Object.freeze({ kind: "rejected", source: context.reference(context.node), reason });
}
