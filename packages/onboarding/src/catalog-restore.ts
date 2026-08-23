import { chmod, lstat, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { z } from "zod";

import { AuthService } from "../../auth/src/auth";
import { openCatalogDatabase } from "../../database/src/catalog";
import {
  backupCatalog,
  CatalogOperationError,
  type CatalogOperationResult,
  stageCatalogForRestore,
} from "../../database/src/catalog-backup";

const restoreCatalogWithOwnerSchema = z.object({
  dataDir: z.string().min(1),
  input: z.string().min(1),
  password: z.string().min(12),
  username: z.string().trim().min(1),
});

export type RestoreCatalogWithOwnerOptions = z.input<typeof restoreCatalogWithOwnerSchema>;

const targetArtifactExists = async (path: string): Promise<boolean> => {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
};

const assertEmptyCatalogTarget = async (targetPath: string): Promise<void> => {
  for (const artifact of [targetPath, `${targetPath}-wal`, `${targetPath}-shm`] as const) {
    if (await targetArtifactExists(artifact)) {
      throw new CatalogOperationError("catalog_exists", `catalog already exists at ${targetPath}`);
    }
  }
};

const assertTargetPathHasNoSymlinks = async (targetDirectory: string): Promise<void> => {
  let currentPath = targetDirectory;
  while (true) {
    try {
      const metadata = await lstat(currentPath);
      if (metadata.isSymbolicLink()) {
        throw new CatalogOperationError(
          "operation_failed",
          "catalog restore target path must not include symbolic links",
        );
      }
    } catch (error) {
      if (error instanceof CatalogOperationError) {
        throw error;
      }
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
        throw error;
      }
    }

    const parentPath = dirname(currentPath);
    if (parentPath === currentPath) {
      return;
    }
    currentPath = parentPath;
  }
};

export const restoreCatalogWithOwner = async (
  options: RestoreCatalogWithOwnerOptions,
): Promise<CatalogOperationResult> => {
  const input = restoreCatalogWithOwnerSchema.parse(options);
  const targetDirectory = resolve(input.dataDir);
  const targetPath = join(targetDirectory, "mynas.sqlite");
  await assertTargetPathHasNoSymlinks(targetDirectory);
  await assertEmptyCatalogTarget(targetPath);
  const stagingDirectory = await mkdtemp(join(tmpdir(), "mynas-catalog-restore-"));

  try {
    await stageCatalogForRestore(stagingDirectory, input.input);
    const database = await openCatalogDatabase(stagingDirectory);
    try {
      database.query("DELETE FROM users").run();
      await new AuthService(database).setupOwner(input.username, input.password, "127.0.0.1");
    } finally {
      database.close();
    }

    await mkdir(targetDirectory, { mode: 0o700, recursive: true });
    await assertTargetPathHasNoSymlinks(targetDirectory);
    await chmod(targetDirectory, 0o700);
    await assertEmptyCatalogTarget(targetPath);
    try {
      return await backupCatalog(stagingDirectory, targetPath);
    } catch (error) {
      if (error instanceof CatalogOperationError && error.code === "backup_destination_exists") {
        throw new CatalogOperationError(
          "catalog_exists",
          `catalog already exists at ${targetPath}`,
          { cause: error },
        );
      }
      throw error;
    }
  } finally {
    await rm(stagingDirectory, { force: true, recursive: true });
  }
};
