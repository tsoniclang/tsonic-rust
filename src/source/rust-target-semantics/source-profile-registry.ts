import type { AstReader, Node, SourceFile } from "@tsonic/tsts";
import {
  normalizeTargetSourceProfileSegment,
  tsonicSourceProfileVirtualDirectory,
} from "@tsonic/target-api";
import {
  rustJsSourceProfileOwnerId,
  rustSourceProfileOwnerId,
} from "./source-profile-declarations.js";

export type RustSourceProfileKind = "native" | "js";

export interface RustSourceProfileRegistry {
  registerSourceFile(sourceFile: SourceFile, ast: AstReader, jsEnabled: boolean): void;
  profileForNode(node: Node, ast: AstReader): RustSourceProfileKind | undefined;
}

export function createRustSourceProfileRegistry(): RustSourceProfileRegistry {
  const candidates = new Map<RustSourceProfileKind, Set<SourceFile>>();
  return {
    registerSourceFile(sourceFile, ast, jsEnabled) {
      const profile = sourceProfileForFileName(ast.getFileName(sourceFile), jsEnabled);
      if (profile !== undefined) {
        const files = candidates.get(profile) ?? new Set<SourceFile>();
        files.add(sourceFile);
        candidates.set(profile, files);
      }
    },
    profileForNode(node, ast) {
      const sourceFile = ast.getSourceFile(node);
      if (sourceFile === undefined) {
        return undefined;
      }
      for (const [profile, files] of candidates) {
        if (files.size === 1 && files.has(sourceFile)) {
          return profile;
        }
      }
      return undefined;
    },
  };
}

function sourceProfileForFileName(
  fileName: string,
  jsEnabled: boolean,
): RustSourceProfileKind | undefined {
  const directory = `/${tsonicSourceProfileVirtualDirectory}/`;
  const nativeOwner = normalizeTargetSourceProfileSegment(rustSourceProfileOwnerId);
  const jsOwner = normalizeTargetSourceProfileSegment(rustJsSourceProfileOwnerId);
  if (!jsEnabled && fileName.endsWith(`${directory}${nativeOwner}/rust-globals.d.ts`)) {
    return "native";
  }
  if (jsEnabled && (
    fileName.endsWith(`${directory}${nativeOwner}/js-globals.d.ts`) ||
    fileName.endsWith(`${directory}${jsOwner}/js-globals.d.ts`)
  )) {
    return "js";
  }
  return undefined;
}
