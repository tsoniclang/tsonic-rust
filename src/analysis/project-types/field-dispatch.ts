import type {
  AstReader,
  Node,
} from "@tsonic/tsts";
import type { SourceFileSemantics } from "@tsonic/target-api/source";
import type {
  RustProjectTypeDefinition,
  RustProjectTypePolicy,
} from "./type-policy.js";
import { rustProjectObjectLayout } from "./object-layout.js";
import { rustProjectMemberIsPrivate } from "./member-privacy.js";

export interface RustProjectFieldDispatchRole {
  readonly selfMode: "ref" | "rc";
  readonly fallible: boolean;
}

export interface RustProjectFieldDispatchPlan {
  readonly declaration: Node;
  readonly readonly: boolean;
  readonly read: RustProjectFieldDispatchRole;
  readonly write?: RustProjectFieldDispatchRole;
}

export type RustProjectFieldImplementation =
  | {
      readonly kind: "stored";
      readonly declaration: Node;
    }
  | {
      readonly kind: "accessor";
      readonly getter: Node;
      readonly setter?: Node;
    };

export interface RustProjectFieldDispatchQueries {
  planFor(declaration: Node): RustProjectFieldDispatchPlan | undefined;
  implementationFor(
    concrete: RustProjectTypeDefinition,
    contractDeclaration: Node,
  ): RustProjectFieldImplementation | undefined;
}

export interface RustProjectFieldDispatchPlanRegistry
  extends RustProjectFieldDispatchQueries {
  recordObjectLiteralAccessor(
    declarations: readonly Node[],
    role: "get" | "set",
  ): void;
  initialize(input: {
    readonly ast: AstReader;
    readonly projectTypes: RustProjectTypePolicy;
    semanticsFor(node: Node): SourceFileSemantics;
  }): void;
  seal(): RustProjectFieldDispatchQueries;
}

interface PendingAccessorRoles {
  read: boolean;
  write: boolean;
}

export function createRustProjectFieldDispatchPlanRegistry(): RustProjectFieldDispatchPlanRegistry {
  const pending = new Map<Node, PendingAccessorRoles>();
  let plans: WeakMap<Node, RustProjectFieldDispatchPlan> | undefined;
  let implementations: WeakMap<
    RustProjectTypeDefinition,
    WeakMap<Node, RustProjectFieldImplementation>
  > | undefined;
  const requirePlans = (): WeakMap<Node, RustProjectFieldDispatchPlan> => {
    if (plans === undefined) {
      throw new Error("Rust project field dispatch plan was read before source analysis initialized it.");
    }
    return plans;
  };
  const requireImplementations = (): WeakMap<
    RustProjectTypeDefinition,
    WeakMap<Node, RustProjectFieldImplementation>
  > => {
    if (implementations === undefined) {
      throw new Error("Rust project field implementations were read before source analysis initialized them.");
    }
    return implementations;
  };
  const registry: RustProjectFieldDispatchPlanRegistry = {
    recordObjectLiteralAccessor(declarations, role) {
      if (plans !== undefined) {
        throw new Error("Rust project object-literal accessor roles cannot be recorded after initialization.");
      }
      for (const declaration of declarations) {
        const current = pending.get(declaration) ?? { read: false, write: false };
        pending.set(declaration, {
          read: current.read || role === "get",
          write: current.write || role === "set",
        });
      }
    },
    initialize(input) {
      if (plans !== undefined || implementations !== undefined) {
        throw new Error("Rust project field dispatch plan can be initialized only once.");
      }
      const nextPlans = new WeakMap<Node, RustProjectFieldDispatchPlan>();
      const nextImplementations = new WeakMap<
        RustProjectTypeDefinition,
        WeakMap<Node, RustProjectFieldImplementation>
      >();
      for (const definition of input.projectTypes.definitions) {
        for (const field of input.projectTypes.externalBaseForDefinition(definition)?.fields ?? []) {
          nextPlans.set(field.declaration, Object.freeze({
            declaration: field.declaration,
            readonly: false,
            read: Object.freeze({ selfMode: "ref", fallible: false }),
            write: Object.freeze({ selfMode: "ref", fallible: false }),
          }));
        }
        const layout = rustProjectObjectLayout(definition.declaration, input.ast);
        if (layout === undefined) {
          continue;
        }
        for (const field of layout.fields) {
          const objectLiteralRoles = pending.get(field.declaration);
          let accessorRead = objectLiteralRoles?.read === true;
          let accessorWrite = objectLiteralRoles?.write === true;
          for (const concrete of input.projectTypes.concreteClassesFor(definition)) {
            const implementation = resolveFieldImplementation(
              concrete,
              field.declaration,
              input,
            );
            if (implementation === undefined) {
              continue;
            }
            let byContract = nextImplementations.get(concrete);
            if (byContract === undefined) {
              byContract = new WeakMap<Node, RustProjectFieldImplementation>();
              nextImplementations.set(concrete, byContract);
            }
            byContract.set(field.declaration, implementation);
            if (implementation.kind === "accessor") {
              accessorRead = true;
              accessorWrite ||= implementation.setter !== undefined;
            }
          }
          const readonly = input.ast.hasModifierKind(field.declaration, "readonly");
          nextPlans.set(field.declaration, Object.freeze({
            declaration: field.declaration,
            readonly,
            read: Object.freeze({
              selfMode: accessorRead ? "rc" : "ref",
              fallible: accessorRead,
            }),
            ...(readonly
              ? {}
              : {
                  write: Object.freeze({
                    selfMode: accessorWrite ? "rc" as const : "ref" as const,
                    fallible: accessorWrite,
                  }),
                }),
          }));
        }
      }
      plans = nextPlans;
      implementations = nextImplementations;
    },
    seal() {
      requirePlans();
      requireImplementations();
      return Object.freeze({
        planFor: registry.planFor,
        implementationFor: registry.implementationFor,
      });
    },
    planFor(declaration) {
      return requirePlans().get(declaration);
    },
    implementationFor(concrete, contractDeclaration) {
      return requireImplementations().get(concrete)?.get(contractDeclaration);
    },
  };
  return Object.freeze(registry);
}

function resolveFieldImplementation(
  concrete: RustProjectTypeDefinition,
  contractDeclaration: Node,
  input: {
    readonly ast: AstReader;
    readonly projectTypes: RustProjectTypePolicy;
    semanticsFor(node: Node): SourceFileSemantics;
  },
): RustProjectFieldImplementation | undefined {
  if (rustProjectMemberIsPrivate(input.ast, contractDeclaration)) {
    const owner = input.projectTypes.definitionContainingDeclaration(contractDeclaration);
    if (owner?.kind !== "class") {
      return undefined;
    }
    const lineage = input.projectTypes.classLineage(concrete);
    return lineage?.includes(owner) === true
      ? Object.freeze({ kind: "stored", declaration: contractDeclaration })
      : undefined;
  }
  const selected = input.projectTypes.memberImplementation(concrete, contractDeclaration);
  if (selected.kind !== "resolved") {
    return undefined;
  }
  const declaration = selected.implementation.declaration;
  const kind = input.ast.kindName(declaration);
  if (kind === "KindPropertyDeclaration" || kind === "KindPropertySignature") {
    return Object.freeze({ kind: "stored", declaration });
  }
  if (kind !== "KindGetAccessor" && kind !== "KindSetAccessor") {
    return undefined;
  }
  const declarations = input.semanticsFor(declaration)
    .declarations.symbolDeclarations(selected.implementation.symbol);
  const getters = declarations.filter((candidate) =>
    input.ast.kindName(candidate) === "KindGetAccessor");
  const setters = declarations.filter((candidate) =>
    input.ast.kindName(candidate) === "KindSetAccessor");
  if (getters.length !== 1 || setters.length > 1) {
    return undefined;
  }
  return Object.freeze({
    kind: "accessor",
    getter: getters[0]!,
    ...(setters.length === 0 ? {} : { setter: setters[0]! }),
  });
}
