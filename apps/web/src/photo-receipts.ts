import { z } from "zod";

import type { PhotoChecksumMatch } from "./schemas";

const DATABASE_NAME = "mynas.photo-upload-receipts";
const OBJECT_STORE = "receipts";
const receiptSchema = z
  .object({
    checksum: z.string().regex(/^[a-f0-9]{64}$/),
    key: z.string().min(1),
    lastModified: z.number().int().nonnegative(),
    path: z.string().min(1),
    photoId: z.string().uuid(),
    size: z.number().int().nonnegative(),
    version: z.literal(1),
  })
  .strict();

export type PhotoReceiptSource = {
  readonly file: File;
  readonly path: string;
};

export type PhotoUploadReceipt = z.infer<typeof receiptSchema>;

export const photoReceiptKey = ({ file, path }: PhotoReceiptSource): string =>
  JSON.stringify([path, file.size, file.lastModified]);

const requestResult = <Value>(request: IDBRequest<Value>): Promise<Value> =>
  new Promise<Value>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });

const transactionDone = (transaction: IDBTransaction): Promise<void> =>
  new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("IndexedDB transaction failed"));
  });

const openDatabase = (): Promise<IDBDatabase> =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(OBJECT_STORE)) {
        request.result.createObjectStore(OBJECT_STORE, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed"));
  });

export const loadPhotoReceipts = async (): Promise<ReadonlyMap<string, PhotoUploadReceipt>> => {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(OBJECT_STORE, "readonly");
    const request = transaction.objectStore(OBJECT_STORE).getAll();
    const [values] = await Promise.all([requestResult(request), transactionDone(transaction)]);
    const receipts = z.array(receiptSchema).parse(values);
    return new Map(receipts.map((receipt) => [receipt.key, receipt]));
  } finally {
    database.close();
  }
};

export const savePhotoReceipt = async (
  source: PhotoReceiptSource,
  photo: PhotoChecksumMatch,
): Promise<void> => {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(OBJECT_STORE, "readwrite");
    transaction.objectStore(OBJECT_STORE).put(
      receiptSchema.parse({
        checksum: photo.checksum,
        key: photoReceiptKey(source),
        lastModified: source.file.lastModified,
        path: source.path,
        photoId: photo.id,
        size: source.file.size,
        version: 1,
      }),
    );
    await transactionDone(transaction);
  } finally {
    database.close();
  }
};
