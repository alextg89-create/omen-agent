/**
 * Supabase Client Configuration - Secret API Key Authentication
 *
 * AUTHENTICATION METHOD: Supabase Secret API Key
 * - Uses SUPABASE_SECRET_API_KEY (not a JWT, not service_role)
 * - No JWT decoding or role validation
 * - Let Supabase JS client handle authentication internally
 *
 * Environment Variables Required:
 * - SUPABASE_URL: Your Supabase project URL
 * - SUPABASE_SECRET_API_KEY: Secret API key from Supabase dashboard
 *
 * Feature Flag: OMEN_USE_SUPABASE (default: false)
 */

import { createClient } from '@supabase/supabase-js';
import { fileURLToPath } from 'url';
import path from 'path';

// ============================================================================
// [BOOT] SINGLE CLIENT ENFORCEMENT - RUNTIME INTEGRITY GUARD
// ============================================================================
const __filename = fileURLToPath(import.meta.url);
const AUTHORIZED_CLIENT_FILE = __filename;
const AUTHORIZED_CLIENT_DIR = path.dirname(__filename);

console.error("[BOOT][SUPABASE CLIENT AUTHORITY]", {
  authorizedFile: AUTHORIZED_CLIENT_FILE,
  authorizedDir: AUTHORIZED_CLIENT_DIR,
  timestamp: new Date().toISOString(),
  pid: process.pid
});

// Track client creation - MUST be exactly 1
let _clientCreationCount = 0;
let _clientCreationStack = null;

// ============================================================================
// [BOOT][SUPABASE KEY MODE] - KEY RESOLUTION WITH FALLBACK
// ============================================================================
const hasSecret = !!process.env.SUPABASE_SECRET_API_KEY;
const hasServiceRole = !!process.env.SUPABASE_SERVICE_ROLE_KEY;

// Determine which key to use: prefer SECRET_API_KEY, fallback to SERVICE_ROLE_KEY
const RESOLVED_KEY_MODE = hasSecret ? "SECRET_API_KEY" : (hasServiceRole ? "SERVICE_ROLE_KEY" : "NONE");

console.error("[BOOT][SUPABASE KEY MODE]", {
  hasSecret,
  hasServiceRole,
  using: RESOLVED_KEY_MODE,
});

if (!hasSecret && !hasServiceRole) {
  console.error("[FATAL] No Supabase key found. Set SUPABASE_SECRET_API_KEY or SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}

// ============================================================================
// [BOOT] KEY SOURCE LOGGING
// ============================================================================
if (hasSecret) {
  console.log("[BOOT] Using SUPABASE_SECRET_API_KEY for authentication");
} else if (hasServiceRole) {
  console.log("[BOOT] Using SUPABASE_SERVICE_ROLE_KEY as fallback for authentication");
}
// ============================================================================

// ============================================================================
// ENVIRONMENT VALIDATION
// ============================================================================

const SUPABASE_ENABLED = process.env.OMEN_USE_SUPABASE === 'true';
const SUPABASE_URL = (process.env.SUPABASE_URL || '').trim();

// Resolve key: prefer SECRET_API_KEY, fallback to SERVICE_ROLE_KEY
const SUPABASE_SECRET_KEY = (
  process.env.SUPABASE_SECRET_API_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  ''
).trim();

// ============================================================================
// FAIL FAST: Missing ALL Supabase Keys
// ============================================================================

if (SUPABASE_ENABLED && !SUPABASE_SECRET_KEY) {
  console.error('='.repeat(80));
  console.error('[Supabase] ❌ FATAL: No Supabase key configured');
  console.error('[Supabase]');
  console.error('[Supabase] Set one of these environment variables:');
  console.error('[Supabase]   SUPABASE_SECRET_API_KEY (preferred)');
  console.error('[Supabase]   SUPABASE_SERVICE_ROLE_KEY (fallback)');
  console.error('='.repeat(80));
  process.exit(1);
}

if (SUPABASE_ENABLED && !SUPABASE_URL) {
  console.error('='.repeat(80));
  console.error('[Supabase] ❌ FATAL: SUPABASE_URL is not set');
  console.error('[Supabase] Set the environment variable to your Supabase project URL.');
  console.error('='.repeat(80));
  process.exit(1);
}

// Key fingerprint for logging (safe prefix only)
const KEY_FINGERPRINT = SUPABASE_SECRET_KEY
  ? `${SUPABASE_SECRET_KEY.substring(0, 8)}...${SUPABASE_SECRET_KEY.substring(SUPABASE_SECRET_KEY.length - 4)}`
  : 'NO_KEY';

// ============================================================================
// CLIENT STATE
// ============================================================================

let supabaseClient = null;
let connectionStatus = {
  enabled: SUPABASE_ENABLED,
  configured: false,
  connected: false,
  error: null
};

let CLIENT_CREATION_TIMESTAMP = null;

/**
 * Initialize Supabase client
 * Uses Secret API Key - no JWT validation, no custom fetch wrappers
 */
function initializeSupabase() {
  console.log('[Supabase] ========================================');
  console.log('[Supabase] INITIALIZATION');
  console.log('[Supabase] ========================================');

  if (!SUPABASE_ENABLED) {
    console.log('[Supabase] Feature flag disabled (OMEN_USE_SUPABASE=false)');
    connectionStatus.error = 'Feature flag disabled';
    return;
  }

  console.log(`[Supabase] URL: ${SUPABASE_URL}`);
  console.log(`[Supabase] Key fingerprint: ${KEY_FINGERPRINT}`);
  console.log(`[Supabase] Auth method: ${RESOLVED_KEY_MODE}`);

  try {
    // ========================================================================
    // SINGLE CLIENT ENFORCEMENT
    // ========================================================================
    _clientCreationCount++;
    _clientCreationStack = new Error().stack;

    if (_clientCreationCount > 1) {
      console.error("=".repeat(80));
      console.error("[FATAL] SECONDARY SUPABASE CLIENT INITIALIZED");
      console.error("[FATAL] Client creation count:", _clientCreationCount);
      console.error("[FATAL] This violates single-client integrity.");
      console.error("[FATAL] Stack trace:", _clientCreationStack);
      console.error("=".repeat(80));
      process.exit(1);
    }

    console.log("[Supabase] CLIENT CREATION #" + _clientCreationCount);
    console.log("[Supabase] Authorized file:", AUTHORIZED_CLIENT_FILE);
    console.log("[Supabase] Creation stack:", _clientCreationStack?.split('\n').slice(0, 5).join('\n'));

    // Create client with Secret API Key
    // Let Supabase JS client handle all authentication internally
    supabaseClient = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });

    CLIENT_CREATION_TIMESTAMP = new Date().toISOString();

    // ========================================================================
    // CONFIRM ZERO OTHER CLIENTS
    // ========================================================================
    console.log("[Supabase] ========================================");
    console.log("[Supabase] ✅ SINGLE CLIENT CONFIRMED");
    console.log("[Supabase] Total clients created: " + _clientCreationCount);
    console.log("[Supabase] Authorized file: " + AUTHORIZED_CLIENT_FILE);
    console.log("[Supabase] ========================================");

    connectionStatus.configured = true;
    connectionStatus.connected = true;
    connectionStatus.error = null;

    console.log('[Supabase] ========================================');
    console.log('[Supabase] ✅ CLIENT INITIALIZED');
    console.log('[Supabase] ========================================');
    console.log(`[Supabase] URL: ${SUPABASE_URL}`);
    console.log(`[Supabase] Created at: ${CLIENT_CREATION_TIMESTAMP}`);
    console.log('[Supabase] Authentication handled by Supabase JS client');
    console.log('[Supabase] ========================================');
  } catch (err) {
    console.error('[Supabase] ❌ Initialization failed:', err.message);
    connectionStatus.configured = true;
    connectionStatus.connected = false;
    connectionStatus.error = err.message;
  }
}

// Initialize on module load
initializeSupabase();

// ============================================================================
// EXPORTS
// ============================================================================

let _clientAccessCount = 0;

/**
 * Get execution context for tracing
 */
function getExecutionContext() {
  const stack = new Error().stack || '';

  let context = 'UNKNOWN';
  if (stack.includes('autoSyncOrders') || stack.includes('syncOrdersFromWebhooks')) {
    context = 'BACKGROUND_JOB:OrderSync';
  } else if (stack.includes('express') || stack.includes('router')) {
    context = 'HTTP_REQUEST';
  } else if (stack.includes('cron')) {
    context = 'CRON_JOB';
  } else if (stack.includes('getAuthoritativeInventory')) {
    context = 'INVENTORY_AUTHORITY';
  }

  return context;
}

/**
 * Get Supabase client instance
 *
 * CRASHES if client not initialized
 *
 * @returns {object} Supabase client
 */
export function getSupabaseClient() {
  _clientAccessCount++;

  if (!supabaseClient) {
    console.error('='.repeat(80));
    console.error('[Supabase] ❌ FATAL: getSupabaseClient() called but client is NULL');
    console.error('[Supabase] Connection status:', JSON.stringify(connectionStatus, null, 2));
    console.error('='.repeat(80));
    throw new Error('FATAL: Supabase client is NULL. Check SUPABASE_SECRET_API_KEY in .env');
  }

  // Log periodic access
  if (_clientAccessCount <= 3 || _clientAccessCount % 20 === 0) {
    const context = getExecutionContext();
    console.log(`[Supabase] 🔍 Access #${_clientAccessCount} | Context: ${context}`);
  }

  return supabaseClient;
}

/**
 * Check if Supabase is available
 */
export function isSupabaseAvailable() {
  return connectionStatus.enabled &&
         connectionStatus.connected &&
         supabaseClient !== null;
}

/**
 * Get connection status for diagnostics
 */
export function getConnectionStatus() {
  return {
    ...connectionStatus,
    keyFingerprint: KEY_FINGERPRINT,
    createdAt: CLIENT_CREATION_TIMESTAMP,
    accessCount: _clientAccessCount,
    authMethod: 'Secret API Key'
  };
}

/**
 * Test connection by querying a table
 */
export async function testConnection(tableName = 'orders') {
  if (!isSupabaseAvailable()) {
    return {
      ok: false,
      error: connectionStatus.error || 'Supabase not available'
    };
  }

  try {
    const client = getSupabaseClient();

    console.log(`[Supabase] Testing connection to table: ${tableName}`);

    const { data, error } = await client
      .from(tableName)
      .select('*')
      .limit(1);

    if (error) {
      console.error(`[Supabase] ❌ Test query failed: ${error.message}`);
      console.error(`[Supabase] Error code: ${error.code}`);
      console.error(`[Supabase] Error details:`, error);
      return { ok: false, error: error.message, code: error.code };
    }

    console.log(`[Supabase] ✅ Connection test passed (table: ${tableName})`);
    return { ok: true, rowCount: data?.length || 0 };
  } catch (err) {
    console.error('[Supabase] ❌ Test connection error:', err.message);
    return { ok: false, error: err.message };
  }
}

/**
 * Ensure initialization is complete (for async compatibility)
 */
export async function ensureInitialized() {
  // Initialization is synchronous now, but keep this for API compatibility
  return Promise.resolve();
}
