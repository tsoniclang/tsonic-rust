import type { AstReader, Node } from "@tsonic/tsts";
import type { SourceProgramNavigation } from "@tsonic/target-api/source";
import type { RustProjectTypePolicy } from "./type-policy.js";

export interface RustProjectMethodPropertyUsage {
  readonly declaration: Node;
  readonly readable: boolean;
  readonly writable: boolean;
}

export type RustProjectMethodPropertyRegistration =
  | { readonly kind: "accepted" }
  | { readonly kind: "rejected"; readonly reason: string };

export interface RustProjectMethodPropertyPlan {
  readonly usages: readonly RustProjectMethodPropertyUsage[];
  usageFor(declaration: Node): RustProjectMethodPropertyUsage | undefined;
}

export interface RustProjectMethodPropertyPlanRegistry
  extends RustProjectMethodPropertyPlan {
  record(
    declaration: Node,
    accessMode: "read" | "write" | "read-write",
  ): RustProjectMethodPropertyRegistration;
  initialize(input: {
    readonly ast: AstReader;
    readonly navigation: SourceProgramNavigation;
    readonly projectTypes: RustProjectTypePolicy;
  }): RustProjectMethodPropertyPlan;
  seal(): RustProjectMethodPropertyPlan;
}

interface PendingUsage {
  readonly declaration: Node;
  readable: boolean;
  writable: boolean;
}

export function createRustProjectMethodPropertyPlanRegistry(): RustProjectMethodPropertyPlanRegistry {
  const pending = new Map<Node, PendingUsage>();
  let current: RustProjectMethodPropertyPlan | undefined;
  const requireCurrent = (): RustProjectMethodPropertyPlan => {
    if (current === undefined) {
      throw new Error("Rust project method-property plan was read before source analysis initialized it.");
    }
    return current;
  };
  return Object.freeze({
    get usages() {
      return requireCurrent().usages;
    },
    record(
      declaration: Node,
      accessMode: "read" | "write" | "read-write",
    ) {
      if (current !== undefined) {
        throw new Error("Rust project method-property usage cannot be recorded after initialization.");
      }
      const existing = pending.get(declaration);
      const usage = existing ?? {
        declaration,
        readable: false,
        writable: false,
      };
      usage.readable ||= accessMode === "read" || accessMode === "read-write";
      usage.writable ||= accessMode === "write" || accessMode === "read-write";
      pending.set(declaration, usage);
      return { kind: "accepted" as const };
    },
    initialize(input: {
      readonly ast: AstReader;
      readonly navigation: SourceProgramNavigation;
      readonly projectTypes: RustProjectTypePolicy;
    }) {
      if (current !== undefined) {
        throw new Error("Rust project method-property plan can be initialized only once.");
      }
      const byDeclaration = new Map<Node, PendingUsage>();
      const merge = (
        declaration: Node,
        usage: Pick<RustProjectMethodPropertyUsage, "readable" | "writable">,
      ): void => {
        const existing = byDeclaration.get(declaration) ?? {
          declaration,
          readable: false,
          writable: false,
        };
        existing.readable ||= usage.readable;
        existing.writable ||= usage.writable;
        byDeclaration.set(declaration, existing);
      };
      for (const usage of pending.values()) {
        merge(usage.declaration, usage);
        const implementation = input.navigation.callableImplementation(usage.declaration);
        if (implementation.kind === "resolved") {
          merge(implementation.implementation.declaration, usage);
        }
        const owner = input.projectTypes.definitionContainingDeclaration(usage.declaration);
        if (owner === undefined) {
          continue;
        }
        for (const concrete of input.projectTypes.concreteClassesFor(owner)) {
          const selected = input.projectTypes.memberImplementation(
            concrete,
            usage.declaration,
          );
          if (selected.kind === "resolved") {
            merge(selected.implementation.declaration, usage);
          }
        }
      }
      let changed = true;
      while (changed) {
        changed = false;
        for (const definition of input.projectTypes.definitions) {
          for (const member of input.ast.members(definition.declaration)) {
            if (member === undefined || !isMethodDeclaration(member, input.ast)) {
              continue;
            }
            const implementation = input.navigation.callableImplementation(member);
            const canonical = implementation.kind === "resolved"
              ? implementation.implementation.declaration
              : member;
            const usage = byDeclaration.get(member) ?? byDeclaration.get(canonical);
            if (usage === undefined) {
              continue;
            }
            const beforeMember = byDeclaration.get(member);
            const beforeCanonical = byDeclaration.get(canonical);
            merge(member, usage);
            merge(canonical, usage);
            changed ||= beforeMember === undefined || beforeCanonical === undefined;
          }
        }
      }
      const usages = Object.freeze([...byDeclaration.values()].map((usage) =>
        Object.freeze({ ...usage })).sort((left, right) => {
        const leftFile = input.ast.getFileName(input.ast.getSourceFile(left.declaration));
        const rightFile = input.ast.getFileName(input.ast.getSourceFile(right.declaration));
        return leftFile.localeCompare(rightFile, "en") ||
          input.ast.pos(left.declaration) - input.ast.pos(right.declaration);
      }));
      const frozenByDeclaration = new Map(usages.map((usage) =>
        [usage.declaration, usage] as const));
      current = Object.freeze({
        usages,
        usageFor(declaration: Node) {
          return frozenByDeclaration.get(declaration);
        },
      });
      return current;
    },
    seal() {
      return requireCurrent();
    },
    usageFor(declaration: Node) {
      return requireCurrent().usageFor(declaration);
    },
  });
}

function isMethodDeclaration(declaration: Node, ast: AstReader): boolean {
  const kind = ast.kindName(declaration);
  return kind === "KindMethodDeclaration" || kind === "KindMethodSignature";
}
