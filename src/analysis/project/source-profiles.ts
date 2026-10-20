import type { AstReader, Node, SourceFile } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";
import { readRustSourceProfileErrorContract } from "../../source/profiles/error-declarations.js";
import { isTsonicSourceProfileDeclarationPath } from "@tsonic/target-api/provider";
import { rustJsSourceProfileOwnerId, rustSourceProfileOwnerId } from "../../source/profiles/declarations.js";
import type { RustSourceProfileKind, RustSourceProfileRegistry } from "../../policy/types/model/source-profile.js";

export function createRustSourceProfileRegistry(
  source: TargetSourceProgram,
  jsEnabled: boolean,
): RustSourceProfileRegistry {
  const { ast, sourceFiles } = source;
  const sourceFileByProfile = new Map<RustSourceProfileKind, SourceFile>();
  const ambiguousProfiles = new Set<RustSourceProfileKind>();
  for (const sourceFile of sourceFiles) {
    const profile = sourceProfileForFileName(ast.getFileName(sourceFile), jsEnabled);
    if (profile === undefined || ambiguousProfiles.has(profile)) {
      continue;
    }
    const existing = sourceFileByProfile.get(profile);
    if (existing !== undefined && existing !== sourceFile) {
      sourceFileByProfile.delete(profile);
      ambiguousProfiles.add(profile);
      continue;
    }
    sourceFileByProfile.set(profile, sourceFile);
  }
  const profiles = new WeakMap([...sourceFileByProfile].map(([profile, file]) => [file, profile] as const));
  const errorContracts = new Map([...sourceFileByProfile.values()].flatMap(file => {
    const contract = readRustSourceProfileErrorContract(source, file);
    return contract === undefined ? [] : [[contract.value, contract] as const];
  }));
  return Object.freeze({
    errorForDeclaration: (declaration: Node) => errorContracts.get(declaration),
    profileForNode(node: Node, nodeAst: AstReader) {
      const sourceFile = nodeAst.getSourceFile(node);
      if (sourceFile === undefined) {
        return undefined;
      }
      return profiles.get(sourceFile);
    },
  });
}

function sourceProfileForFileName(
  fileName: string,
  jsEnabled: boolean,
): RustSourceProfileKind | undefined {
  const normalizedFileName = fileName.split("\\").join("/");
  const nativeOwner = isTsonicSourceProfileDeclarationPath(
    normalizedFileName,
    rustSourceProfileOwnerId,
  );
  if (!jsEnabled && nativeOwner && normalizedFileName.endsWith("/rust-globals.d.ts")) {
    return "native";
  }
  if (jsEnabled && normalizedFileName.endsWith("/js-globals.d.ts") && (
    nativeOwner || isTsonicSourceProfileDeclarationPath(
      normalizedFileName,
      rustJsSourceProfileOwnerId,
    )
  )) {
    return "js";
  }
  return undefined;
}
