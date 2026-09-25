import type { RustProviderPackageDefinition } from "../model.js";
import type { RustAttributeArgumentSchema } from "../attributes.js";
import type { ExportRecord, Fail, MemberRecord, SignatureRecord } from "./model.js";
import { asRecord, requireExactKeys, requireNonEmpty, requireRustIdentifier, requireRustPath } from "./carriers.js";

export function validateAttributeRows(
  definition: RustProviderPackageDefinition,
  exports: ReadonlyMap<string, ExportRecord>,
  members: ReadonlyMap<string, MemberRecord>,
  signatures: ReadonlyMap<string, SignatureRecord>,
  fail: Fail,
): void {
  if (definition.attributes !== undefined && !Array.isArray(definition.attributes)) fail("attributes must be a finite array of exact contracts");
  const identities = new Set<string>();
  for (const row of definition.attributes ?? []) {
    requireExactKeys(asRecord(row), ["exportId", "signatureId", "kind", "path", "placements", "arguments", "requiredParent"], "attribute", fail);
    requireNonEmpty(row.exportId, "attribute export", fail);
    requireNonEmpty(row.signatureId, "attribute signature", fail);
    requireRustPath(row.path, "attribute path", fail);
    const signature = signatures.get(row.signatureId);
    if (exports.get(row.exportId)?.declaration.kind !== "function" || signature?.exportId !== row.exportId || signature.memberId !== undefined) {
      fail("attribute must select an exact exported function signature");
    }
    const identity = `${row.exportId}\0${row.signatureId}`;
    if (identities.has(identity)) fail("attribute signature has duplicate mappings");
    identities.add(identity);
    if (definition.operations.some(operation => operation.exportId === row.exportId && operation.memberId === undefined &&
      (operation.signatureId === undefined || operation.signatureId === row.signatureId))) fail("an attribute signature cannot also be a runtime operation");
    if (row.kind !== "attribute" && row.kind !== "derive") fail("attribute kind must be attribute or derive");
    if (!Array.isArray(row.placements) || row.placements.length === 0 || new Set(row.placements).size !== row.placements.length ||
      row.placements.some(placement => !["function", "module", "struct", "enum"].includes(placement))) fail("attribute placements must be unique native item kinds");
    if (!Array.isArray(row.arguments) || row.arguments.length !== signature.declaration.parameters.length ||
      signature.declaration.parameters.some(parameter => parameter.optional || parameter.rest) ||
      (signature.declaration.typeParameters?.length ?? 0) !== 0) fail("attribute grammar must exactly cover a closed required parameter list");
    if (row.kind === "derive" && (row.arguments.length !== 0 || row.placements.some(placement => placement !== "struct" && placement !== "enum"))) {
      fail("derive requires no arguments and a struct or enum placement");
    }
    for (const argument of row.arguments) validateSchema(argument, 0);
    if (row.requiredParent !== undefined) {
      requireExactKeys(asRecord(row.requiredParent), ["exportId", "signatureId"], "attribute parent", fail);
      const parent = (definition.attributes ?? []).find(candidate => candidate.exportId === row.requiredParent!.exportId &&
        candidate.signatureId === row.requiredParent!.signatureId);
      if (parent === undefined || parent === row || parent.requiredParent !== undefined || !parent.placements.includes("module")) {
        fail("helper attribute requires one exact enclosing module attribute in the same provider");
      }
    }
  }

  function validateSchema(schema: RustAttributeArgumentSchema, depth: number): void {
    if (depth > 32) fail("attribute grammar nesting exceeds 32");
    const record = asRecord(schema);
    if (schema.kind === "integer" || schema.kind === "string" || schema.kind === "boolean") {
      requireExactKeys(record, ["kind"], "attribute literal", fail);
    } else if (schema.kind === "tuple") {
      requireExactKeys(record, ["kind", "elements"], "attribute tuple", fail);
      if (!Array.isArray(schema.elements)) fail("attribute tuple requires its exact elements");
      for (const element of schema.elements) validateSchema(element, depth + 1);
    } else if (schema.kind === "record") {
      if (depth !== 0) fail("named attribute fields must be top-level arguments, not nested records");
      requireExactKeys(record, ["kind", "exportId", "fields"], "attribute record", fail);
      if (exports.get(schema.exportId)?.declaration.kind !== "interface" || !Array.isArray(schema.fields)) fail("attribute record requires an exact provider interface");
      const fieldIds = new Set<string>();
      const names = new Set<string>();
      for (const field of schema.fields) {
        requireExactKeys(asRecord(field), ["memberId", "name", "optional", "schema"], "attribute field", fail);
        requireRustIdentifier(field.name, "attribute field name", fail);
        const member = members.get(field.memberId);
        if (member?.exportId !== schema.exportId || member.declaration.kind !== "property" ||
          typeof field.optional !== "boolean" || field.optional !== (member.declaration.optional === true) ||
          fieldIds.has(field.memberId) || names.has(field.name)) fail("attribute fields require unique exact provider properties and presence");
        fieldIds.add(field.memberId); names.add(field.name);
        validateSchema(field.schema, depth + 1);
      }
      if (exports.get(schema.exportId)!.declaration.members?.length !== fieldIds.size) fail("attribute fields must cover their provider interface");
    } else {
      fail("unsupported attribute argument grammar");
    }
  }
}
