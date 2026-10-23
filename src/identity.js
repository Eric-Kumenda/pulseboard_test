// Works out "who am I?" for this container instance.
//
// On Cloud Run every instance can ask the metadata server for its unique ID.
// Locally there is no metadata server, so we fall back to a random ID.
// K_REVISION and K_SERVICE are environment variables Cloud Run sets for us.

const crypto = require('node:crypto');

const METADATA_URL =
  'http://metadata.google.internal/computeMetadata/v1/instance/id';

async function fetchInstanceId() {
  try {
    const res = await fetch(METADATA_URL, {
      headers: { 'Metadata-Flavor': 'Google' },
      signal: AbortSignal.timeout(800),
    });
    if (res.ok) return (await res.text()).trim();
  } catch {
    // Not on Google Cloud (or the metadata server is slow): use a random ID.
  }
  return 'local-' + crypto.randomBytes(6).toString('hex');
}

async function getIdentity() {
  const fullId = await fetchInstanceId();
  return {
    // The full instance ID is very long. The last 6 characters are enough
    // to tell instances apart on screen.
    id: fullId.slice(-6),
    fullId,
    revision: process.env.K_REVISION || 'local-dev',
    service: process.env.K_SERVICE || 'pulseboard',
    startedAt: Date.now(),
    onCloudRun: Boolean(process.env.K_REVISION),
  };
}

module.exports = { getIdentity };
