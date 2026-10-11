const { storageBucket } = require("./firebaseAdmin");

// App-level soft limit — NOT a Firebase/Blaze billing cap, just how much of
// the bucket this app lets itself use before refusing uploads. Override via
// env var if you want a different budget.
const DEFAULT_LIMIT_BYTES = 10 * 1024 * 1024 * 1024; // 10 GiB

function getLimitBytes() {
  const fromEnv = Number(process.env.APP_STORAGE_LIMIT_BYTES);
  return Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : DEFAULT_LIMIT_BYTES;
}

/**
 * Pure calculation — no network calls — so it's unit-testable without any
 * live credentials. `usedBytes` is whatever the caller already summed up
 * from a real file listing.
 */
function computeUsage(usedBytes, limitBytes = getLimitBytes(), extraBytes = 0) {
  const projectedBytes = usedBytes + extraBytes;
  const availableBytes = Math.max(limitBytes - usedBytes, 0);
  const percent = limitBytes > 0 ? Math.min(100, Math.round((usedBytes / limitBytes) * 100)) : 0;
  const projectedPercent = limitBytes > 0 ? Math.min(100, Math.round((projectedBytes / limitBytes) * 100)) : 0;
  return {
    usedBytes,
    limitBytes,
    availableBytes,
    percent,
    warnAt80: projectedPercent >= 80,
    fitsExtra: extraBytes === 0 || projectedBytes <= limitBytes,
    projectedPercent,
  };
}

/**
 * Lists every object in the bucket (paginated) and sums real sizes — "no
 * uses valores simulados". Admin SDK's getFiles() already covers the whole
 * bucket in one call (no manual folder recursion needed, unlike some other
 * storage SDKs).
 */
async function getRealUsedBytes() {
  const bucket = storageBucket();
  let usedBytes = 0;
  let pageToken;
  do {
    const [files, nextQuery] = await bucket.getFiles({ maxResults: 1000, pageToken });
    for (const file of files) {
      usedBytes += Number(file.metadata?.size || 0);
    }
    pageToken = nextQuery?.pageToken;
  } while (pageToken);
  return usedBytes;
}

module.exports = { computeUsage, getRealUsedBytes, getLimitBytes, DEFAULT_LIMIT_BYTES };
