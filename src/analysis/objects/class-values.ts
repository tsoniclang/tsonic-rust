import type { Node, SourceFile } from "@tsonic/tsts";
import { Node_Type } from "@tsonic/target-api/source";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { rustStructuralObjectCarrierValue } from "../../target-model/types/index.js";
import { closedMetadataKey, closedMetadataEquals } from "../../target-model/metadata/closed-data.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { rustScreamingSnakeIdentifier, rustSnakeCaseIdentifier } from "../../target-model/names/identifiers.js";
import type { RustFactWalk } from "../program/walk.js";
import { appendRustDiagnostic, rustResolutionContext } from "../program/walk.js";
import { resolveRustTargetTypeRef } from "../../policy/types/resolution.js";
import { setCarrierFact } from "../operations/project-calls.js";
import { rustClassValueFactKey } from "../facts/class-values.js";
import type { RustAnalysisContext } from "../program/context.js";
import { rustProjectStaticFieldStorage, type RustProjectStaticFieldStorage } from "../project-types/object-layout.js";
import { selectRustClassValueCallable, type RustClassValueCallable } from "./class-value-callables.js";

export interface RustClassValueView {
  readonly declaration: Node;
  readonly carrier: TargetTypeRef;
  readonly fields: readonly (RustProjectStaticFieldStorage & {
    readonly storageIndex: number;
    readonly writable: boolean;
    readonly callable?: RustClassValueCallable;
  })[];
  readonly construction?: RustClassValueCallable;
}

export interface RustClassValueDefinition {
  readonly declaration: Node;
  readonly identityName: string;
  readonly views: readonly (RustClassValueView & {
    readonly storageName: string;
    readonly constructionName?: string;
    readonly fields: readonly (RustClassValueView["fields"][number] & { readonly forwarderName?: string })[];
  })[];
}

export interface RustClassValuePlan {
  forDeclaration(declaration: Node): RustClassValueDefinition | undefined;
  viewFor(declaration: Node, carrier: TargetTypeRef): RustClassValueDefinition["views"][number] | undefined;
}

export interface RustClassValueRegistry {
  record(view: RustClassValueView): boolean;
  seal(context: RustAnalysisContext): RustClassValuePlan;
}

export function createRustClassValueRegistry(): RustClassValueRegistry {
  const requests = new Map<Node, Map<string, RustClassValueView>>();
  let sealed = false;
  return {
    record(view) {
      if (sealed) throw new Error("Rust constructor views cannot change after sealing.");
      const views = requests.get(view.declaration) ?? new Map<string, RustClassValueView>();
      const key = closedMetadataKey(view.carrier);
      const existing = views.get(key);
      if (existing !== undefined) return existing.fields.length === view.fields.length &&
        classValueCallablesEqual(existing.construction, view.construction) &&
        existing.fields.every((field, index) => field.declaration === view.fields[index]?.declaration &&
          field.storageIndex === view.fields[index]?.storageIndex && field.writable === view.fields[index]?.writable &&
          classValueCallablesEqual(field.callable, view.fields[index]?.callable));
      views.set(key, Object.freeze({ ...view, fields: Object.freeze(view.fields.map(field => Object.freeze({ ...field }))) }));
      requests.set(view.declaration, views);
      return true;
    },
    seal(context) {
      if (sealed) throw new Error("Rust constructor views can be sealed only once.");
      sealed = true;
      const byDeclaration = new Map<Node, RustClassValueDefinition>();
      const namesByFile = new Map<SourceFile, Set<string>>();
      const { ast } = context;
      const allocate = (declaration: Node, purpose: string, callable = false): string => {
        const file = ast.getSourceFile(declaration);
        if (file === undefined) throw new Error("Finalized constructor view has no exact source file.");
        let names = namesByFile.get(file);
        if (names === undefined) {
          names = new Set<string>();
          const collect = (node: Node): void => {
            const name = context.names.nameForDeclaration(node);
            if (name !== undefined) names!.add(name);
            const slot = context.projectTypes.memberSlotName(node, "static");
            if (slot !== undefined) names!.add(slot);
            ast.forEachChild(node, child => { if (child !== undefined) collect(child); });
          };
          collect(file);
          namesByFile.set(file, names);
        }
        const identifier = callable ? rustSnakeCaseIdentifier : rustScreamingSnakeIdentifier;
        const base = identifier(`${context.names.nameForDeclaration(declaration)}_${purpose}`);
        let selected = base;
        let suffix = 2;
        while (names.has(selected)) selected = `${base}_${suffix++}`;
        names.add(selected);
        return selected;
      };
      for (const [declaration, requestsForClass] of requests) {
        const views = [...requestsForClass.entries()].sort(([left], [right]) => left.localeCompare(right))
          .map(([, view]) => Object.freeze({ ...view, storageName: allocate(declaration, "constructor_view"),
            ...(view.construction === undefined ? {} : { constructionName: allocate(declaration, "construct_value", true) }),
            fields: Object.freeze(view.fields.map(field => Object.freeze({ ...field,
              ...(field.callable === undefined ? {} : { forwarderName: allocate(declaration, `${field.targetName}_value`, true) }),
            }))),
          }));
        byDeclaration.set(declaration, Object.freeze({
          declaration, identityName: allocate(declaration, "constructor_identity"), views: Object.freeze(views),
        }));
      }
      return Object.freeze({
        forDeclaration: (declaration: Node) => byDeclaration.get(declaration),
        viewFor(declaration: Node, carrier: TargetTypeRef) {
          return byDeclaration.get(declaration)?.views.find(view => rustTargetTypeRefEquals(view.carrier, carrier));
        },
      });
    },
  };
}

export function resolveRustClassValue(
  walk: RustFactWalk,
  expression: Node,
  expected: TargetTypeRef | undefined,
): TargetTypeRef | undefined {
  const existing = walk.context.facts.getFact(expression, rustClassValueFactKey);
  if (existing !== undefined) return existing.carrier;
  const { ast } = walk.context;
  const declaration = walk.context.source.navigation.sourceReferenceFor(expression)?.declaration;
  if (declaration === undefined || ast.kindName(declaration) !== "KindClassDeclaration") return undefined;
  const semantics = walk.context.semanticsFor(expression);
  const sourceType = semantics.types.expressionType(expression);
  const contextual = semantics.types.contextualValueSelection(expression);
  const destinationType = contextual.kind === "selected" ? contextual.type : undefined;
  const carrier = expected ?? (destinationType === undefined ? undefined : resolveRustTargetTypeRef(
    destinationType, rustResolutionContext(walk, expression), walk.operationOptions));
  const shape = carrier === undefined ? undefined : walk.sourceTypes.structuralObjectForCarrier(carrier);
  if (sourceType === undefined || destinationType === undefined || carrier === undefined || shape === undefined) return undefined;
  const reject = (): undefined => {
    appendRustDiagnostic(walk, "RUST_CLASS_VALUE_NOT_CLOSED",
      "Class constructor values require exact same-component construct/static-member correspondence and closed structural storage.",
      expression, ["target.capability=rust.class-value.static-storage"]);
    return undefined;
  };
  const owner = rustStructuralObjectCarrierValue(carrier)?.ownerFileName;
  const component = (file: string) => walk.context.sourcePackages.packages.find(entry => entry.sourceFiles.includes(file))?.componentId;
  const declarationFile = ast.getSourceFile(declaration);
  if (shape.storage !== "structural-object" || owner === undefined ||
    component(owner) === undefined || component(owner) !== component(ast.getFileName(declarationFile)) ||
    ast.parent(declaration) !== declarationFile) return reject();
  const correspondence = semantics.types.structuralMembers(sourceType, destinationType);
  if (correspondence.kind !== "available" || correspondence.destination.calls.length !== 0 ||
    correspondence.destination.constructs.length !== (shape.construction === undefined ? 0 : 1) || correspondence.destination.indexes.length !== 0 ||
    correspondence.members.length !== shape.fields.length) return reject();
  const construction = shape.construction === undefined || correspondence.source.constructs.length !== 1
    ? undefined : selectRustClassValueCallable(walk, declaration, correspondence.source.constructs[0]!,
      correspondence.destination.constructs[0]!, shape.construction.carrier, true, semantics);
  if (shape.construction !== undefined && construction === undefined) return reject();
  const fields: RustClassValueView["fields"][number][] = [];
  for (const field of shape.fields) {
    const pair = correspondence.members.find(pair => field.symbols.includes(pair.destination.property.symbol));
    if (pair?.kind !== "present" ||
      field.presence !== "required" || pair.source.declarations.length !== 1) return reject();
    const sourceDeclaration = pair.source.declarations[0]!;
    if (ast.parent(sourceDeclaration) !== declaration) return reject();
    if (field.method === true && pair.source.read === "method") {
      if (shape.construction === undefined) return reject();
      const sourceSignatures = semantics.types.callSignatures(pair.source.property.type);
      const targetSignatures = semantics.types.callSignatures(pair.destination.property.type);
      const callable = sourceSignatures.length === 1 && targetSignatures.length === 1
        ? selectRustClassValueCallable(walk, declaration, sourceSignatures[0]!, targetSignatures[0]!, field.resultCarrier, false, semantics) : undefined;
      if (callable === undefined) return reject();
      fields.push({ declaration: sourceDeclaration, fileName: ast.getFileName(ast.getSourceFile(sourceDeclaration)),
        targetName: callable.targetName, storageIndex: field.storageIndex, writable: false, callable });
      continue;
    }
    if (field.method === true || pair.source.read !== "property") return reject();
    const storage = rustProjectStaticFieldStorage(sourceDeclaration, ast,
      walk.context.projectTypes.memberSlotName(sourceDeclaration, "static"));
    const fieldType = Node_Type(ast, sourceDeclaration);
    const fieldCarrier = walk.context.facts.getRuntimeCarrierFact(sourceDeclaration)?.carrier ?? resolveRustTargetTypeRef(
      fieldType ?? pair.source.property.type, rustResolutionContext(walk, sourceDeclaration), walk.operationOptions);
    if (storage === undefined || !rustTargetTypeRefEquals(fieldCarrier, field.resultCarrier)) return reject();
    if (!walk.sourceTypes.registerStructuralFieldImplementation({ carrier, storageIndex: field.storageIndex, kind: "accessor" })) return reject();
    fields.push({ ...storage, storageIndex: field.storageIndex, writable: !field.readonly });
  }
  if (!walk.context.classValues.record({ declaration, carrier, fields, ...(construction === undefined ? {} : { construction }) })) return reject();
  walk.context.facts.set(expression, rustClassValueFactKey, { declaration, carrier });
  return setCarrierFact(walk, expression, carrier);
}

function classValueCallablesEqual(left: RustClassValueCallable | undefined, right: RustClassValueCallable | undefined): boolean {
  if (left === undefined || right === undefined) return left === right;
  const { declaration: leftDeclaration, ...leftContract } = left;
  const { declaration: rightDeclaration, ...rightContract } = right;
  return leftDeclaration === rightDeclaration && closedMetadataEquals(leftContract, rightContract);
}
