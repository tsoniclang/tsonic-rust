import type { Node, SourceFile } from "@tsonic/tsts";
import { VariableDeclarationList_Declarations, VariableStatement_DeclarationList, type TargetSourceProgram } from "@tsonic/target-api/source";
import type { RustSourceProfileErrorContract } from "../../target-model/records/program/source-profiles.js";

export function readRustSourceProfileErrorContract(
  source: TargetSourceProgram,
  file: SourceFile,
): RustSourceProfileErrorContract | undefined {
  const { ast } = source;
  const statements = ast.statements(file);
  const interfaces = statements.filter((node): node is Node => node !== undefined && ast.is.IsInterfaceDeclaration(node));
  const instances = interfaces.filter(node => ast.text(ast.name(node)) === "Error");
  const constructors = interfaces.filter(node => ast.text(ast.name(node)) === "ErrorConstructor");
  const values = statements.flatMap(statement => statement === undefined ? [] :
    VariableDeclarationList_Declarations(ast, VariableStatement_DeclarationList(ast, statement)) ?? [])
    .filter((node): node is Node => node !== undefined && ast.text(ast.name(node)) === "Error");
  if (instances.length !== 1 || constructors.length !== 1 || values.length !== 1) return undefined;
  const instance = instances[0]!;
  const constructor = constructors[0]!;
  const value = values[0]!;
  // The profile is a declaration file, which source navigation does not index; a reference to one of the two
  // interfaces above is matched by its unqualified name within this file, without type arguments.
  const referenced = (node: Node | undefined): Node | undefined => {
    const reference = node === undefined ? undefined : ast.as.AsTypeReferenceNode(node);
    if (reference === undefined || ast.typeArguments(node).length !== 0 || !ast.is.IsIdentifier(reference.TypeName)) return undefined;
    const name = ast.text(reference.TypeName);
    return name === "ErrorConstructor" ? constructor : name === "Error" ? instance : undefined;
  };
  if (ast.variableDeclarationKind(value) !== "var" || referenced(ast.typeNode(value)) !== constructor ||
    ast.typeParameters(instance).length !== 0 || ast.typeParameters(constructor).length !== 0) return undefined;
  const nativeConstructors = ast.members(constructor).filter((node): node is Node => node !== undefined &&
    ast.kindName(node) === "KindConstructSignature" && referenced(ast.typeNode(node)) === instance);
  if (nativeConstructors.length !== 1) return undefined;
  const members = ast.members(instance);
  if (members.some(member => member === undefined)) return undefined;
  const field = (name: string): Node | undefined => {
    const matching = members.filter((node): node is Node => node !== undefined &&
      ast.kindName(node) === "KindPropertySignature" && ast.text(ast.name(node)) === name);
    return matching.length === 1 ? matching[0] : undefined;
  };
  const name = field("name");
  const message = field("message");
  const stack = field("stack");
  if (name === undefined || message === undefined || stack === undefined) return undefined;
  return Object.freeze({ value, instance, constructors: Object.freeze(nativeConstructors),
    fields: Object.freeze({ name, message, stack }) });
}
