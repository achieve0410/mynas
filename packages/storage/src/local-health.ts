import { statfs } from "node:fs/promises";

import type { BackendHealth } from "./adapter";

export const filesystemIdentity = (device: number, inode: number): string => `${device}:${inode}`;

export const localBackendHealth = async (
  root: string,
  filesystemIdentity: string,
): Promise<BackendHealth> => {
  const filesystem = await statfs(root, { bigint: true });
  return {
    availableBytes: Number(filesystem.bavail * filesystem.bsize),
    capacityBytes: Number(filesystem.blocks * filesystem.bsize),
    filesystemIdentity,
    status: "healthy",
  };
};
