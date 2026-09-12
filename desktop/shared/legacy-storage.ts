export function copyLegacyStorage(storage: Pick<Storage, "length" | "key" | "getItem" | "setItem">): void {
  const marker = "shinbo.legacyStorageCopied.v1";
  if (storage.getItem(marker) !== null) return;
  const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index));
  for (const key of keys) {
    if (!key?.startsWith("emma.")) continue;
    const destination = `shinbo.${key.slice(5)}`;
    const value = storage.getItem(key);
    if (value !== null && storage.getItem(destination) === null) storage.setItem(destination, value);
  }
  storage.setItem(marker, "1");
}
