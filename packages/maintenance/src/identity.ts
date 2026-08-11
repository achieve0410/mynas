import type { Database } from "bun:sqlite";

const ownerIdPattern = /^[0-9a-f]{32}$/;

const parseOwnerId = (ownerId: string): string => {
  if (!ownerIdPattern.test(ownerId)) {
    throw new Error("maintenance identity is invalid");
  }
  return ownerId;
};

export const getMaintenanceOwnerId = (database: Database): string => {
  const query = database.query<{ readonly owner_id: string }, []>(
    "SELECT owner_id FROM maintenance_identity WHERE id = 1",
  );
  const existing = query.get();
  if (existing !== null) {
    return parseOwnerId(existing.owner_id);
  }
  const generated = crypto.randomUUID().replaceAll("-", "");
  database
    .query("INSERT OR IGNORE INTO maintenance_identity (id, owner_id) VALUES (1, ?)")
    .run(generated);
  const stored = query.get();
  if (stored === null) {
    throw new Error("maintenance identity was not persisted");
  }
  return parseOwnerId(stored.owner_id);
};
