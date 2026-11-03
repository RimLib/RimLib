export const defaultReadTimeoutMs = 10_000;
export const maxIpcTextLength = 32_768;
export const millisecondsPerSecond = 1_000;
export const millisecondsPerDay = 86_400_000;
export const bytesPerMiB = 1024 * 1024;

export const modListLimits = Object.freeze({
  maxFileBytes: 2 * bytesPerMiB,
  maxEntries: 10_000,
  maxPackageIdLength: 256,
  maxVersionLength: 256,
});

export const xmlLimits = Object.freeze({ maxFileBytes: 10 * bytesPerMiB });

export const steamLimits = Object.freeze({
  metadataBatchSize: 100,
  metadataTimeoutMs: 15_000,
  workshopDiscoveryTimeoutMs: 15_000,
  activeMetadataTimeoutMs: 25_000,
  subscriptionTimeoutMs: 30_000,
  subscriptionCacheMs: 5_000,
  aboutCacheEntries: 10_000,
  localMetadataReadConcurrency: 16,
  installedMetadataCacheMs: 10_000,
});
