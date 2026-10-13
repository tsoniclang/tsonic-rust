import type { RustSourceUnionPayloadTemplate } from "../../../target-model/types/source-union-definitions.js";
import { rustSourceUnionCarrierValue } from "../../../target-model/types/carriers/source-types.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import type { RustItem, RustGenerics, RustType } from "../../target-ast/syntax/nodes.js";

export function planRustSourceUnionPayloadTemplate(
  template: RustSourceUnionPayloadTemplate,
  sourceGenerics: RustGenerics,
  render: (carrier: TargetTypeRef) => RustType | undefined,
): { readonly generics: RustGenerics; readonly variants: Extract<RustItem, { readonly kind: "enum" }>["variants"] } | undefined {
  const source = rustSourceUnionCarrierValue(template.carrier);
  if (source === undefined || sourceGenerics.parameters.length !== source.genericArguments.length ||
    sourceGenerics.parameters.some((parameter, index) => parameter.kind !== source.genericArguments[index]?.kind)) return undefined;
  const parameters = template.sourceArgumentIndexes.map(index => sourceGenerics.parameters[index]);
  const fields = template.variants.map(variant => render(variant.carrier));
  if (parameters.some(parameter => parameter === undefined) || fields.some(field => field === undefined)) return undefined;
  return {
    generics: { parameters: [...parameters as RustGenerics["parameters"], ...template.payloadParameters.map(({ parameter }) => ({
      kind: "type" as const, name: parameter.name, bounds: [],
    }))], wherePredicates: sourceGenerics.wherePredicates },
    variants: template.variants.map((variant, index) => ({ name: variant.name, fields: [fields[index]!] })),
  };
}
