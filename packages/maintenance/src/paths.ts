import { realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";

export const physicalPath = (path: string): string => {
  let existingPath = resolve(path);
  const missingSegments: string[] = [];
  while (true) {
    try {
      return resolve(realpathSync(existingPath), ...missingSegments);
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
        throw error;
      }
      const parent = dirname(existingPath);
      if (parent === existingPath) {
        throw error;
      }
      missingSegments.unshift(basename(existingPath));
      existingPath = parent;
    }
  }
};

export const isPhysicalPathOutside = (base: string, candidate: string): boolean => {
  if (!isAbsolute(candidate)) {
    return false;
  }
  const fromBase = relative(physicalPath(base), physicalPath(candidate));
  return fromBase !== "" && (fromBase.startsWith("..") || isAbsolute(fromBase));
};
