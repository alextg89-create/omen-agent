/**
 * Supabase Client Configuration
 *
 * READ-ONLY client for querying order events and inventory state
 *
 * Environment Variables Required:
 * - SUPABASE_URL: Your Supabase project URL
 * - SUPABASE_SERVICE_ROLE_KEY: Service role key (server-side only)
 *
 * Feature Flag: OMEN_USE_SUPABASE (default: false)
 */

import { createClient } from '@supabase/supabase-js';

// Feature flag - must be explicitly enabled
const SUPABASE_ENABLED = process.env.OMEN_USE_SUPABASE === 'true';

// Environment validation
// CRITICAL: .trim() removes newlines/whitespace that cause "invalid header value" errors
const SUPABASE_URL = (process.env.SUPABASE_URL || '').trim();

// EXPLICIT: Use ONLY SUPABASE_SERVICE_ROLE_KEY - no fallbacks that could pick up wrong key
const SUPABASE_SERVICE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

/**
 * Decode JWT payload and validate it's a service_role key
 * HARD FAIL if not service_role - prevents silent auth failures in production
 */
function validateServiceRoleKey(key) {
  if (!key) return { valid: false, error: 'No key provided' };

  try {
    const parts = key.split('.');
    if (parts.length !== 3) {
      return { valid: false, error: 'Invalid JWT format' };
    }

    const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());

    const result = {
      valid: payload.role === 'service_role',
      role: payload.role,
      ref: payload.ref,
      error: payload.role !== 'service_role' ? `Expected role=service_role, got role=${payload.role}` : null
    };

    // Log key info (without exposing the key itself)
    console.log('[Supabase] JWT Validation:', {
      role: payload.role,
      ref: payload.ref,
      valid: result.valid
    });

    return result;
  } catch (err) {
    return { valid: false, error: `JWT decode failed: ${err.message}` };
  }
}

let supabaseClient = null;
let connectionStatus = {
  enabled: SUPABASE_ENABLED,
  configured: false,
  connected: false,
  error: null
};

/**
 * Initialize Supabase client
 * Only creates client if feature flag is enabled AND credentials exist
 * HARD FAILS if key is not service_role
 */
function initializeSupabase() {
  if (!SUPABASE_ENABLED) {
    console.log('[Supabase] Feature flag disabled (OMEN_USE_SUPABASE=false)');
    connectionStatus.error = 'Feature flag disabled';
    return;
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.warn('[Supabase] Missing credentials');
    console.warn('[Supabase] Required: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
    connectionStatus.configured = false;
    connectionStatus.error = 'Missing credentials';
    return;
  }

  // CRITICAL: Validate the key is actually service_role BEFORE creating client
  const keyValidation = validateServiceRoleKey(SUPABASE_SERVICE_KEY);
  if (!keyValidation.valid) {
    console.error('[Supabase] ❌ FATAL: Invalid service role key');
    console.error('[Supabase] Error:', keyValidation.error);
    console.error('[Supabase] The SUPABASE_SERVICE_ROLE_KEY env var must contain a service_role JWT');
    connectionStatus.configured = false;
    connectionStatus.connected = false;
    connectionStatus.error = `Invalid key: ${keyValidation.error}`;
    return;
  }

  // Verify project ref matches URL
  const urlRef = SUPABASE_URL.match(/\/\/([^.]+)\./)?.[1];
  if (urlRef && keyValidation.ref !== urlRef) {
    console.error('[Supabase] ❌ FATAL: Key/URL project mismatch');
    console.error(`[Supabase] URL ref: ${urlRef}, Key ref: ${keyValidation.ref}`);
    connectionStatus.configured = false;
    connectionStatus.connected = false;
    connectionStatus.error = 'Key/URL project mismatch';
    return;
  }

  try {
    supabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });

    connectionStatus.configured = true;
    connectionStatus.connected = true;
    connectionStatus.error = null;

    console.log('[Supabase] ✅ Client initialized successfully');
    console.log(`[Supabase] URL: ${SUPABASE_URL}`);
    console.log(`[Supabase] Role: ${keyValidation.role}`);
    console.log(`[Supabase] Project: ${keyValidation.ref}`);
  } catch (err) {
    console.error('[Supabase] Initialization failed:', err.message);
    connectionStatus.configured = true;
    connectionStatus.connected = false;
    connectionStatus.error = err.message;
  }
}

// Initialize on module load
initializeSupabase();

/**
 * Get Supabase client instance
 * Returns null if not configured/connected
 */
export function getSupabaseClient() {
  return supabaseClient;
}

/**
 * Check if Supabase is available
 */
export function isSupabaseAvailable() {
  return connectionStatus.enabled && connectionStatus.connected && supabaseClient !== null;
}

/**
 * Get connection status for diagnostics
 */
export function getConnectionStatus() {
  return { ...connectionStatus };
}

/**
 * Test connection by querying a table
 * Returns { ok: boolean, error?: string }
 */
export async function testConnection(tableName = 'orders') {
  if (!isSupabaseAvailable()) {
    return {
      ok: false,
      error: connectionStatus.error || 'Supabase not available'
    };
  }

  try {
    const { data, error } = await supabaseClient
      .from(tableName)
      .select('*')
      .limit(1);

    if (error) {
      console.warn(`[Supabase] Test query failed: ${error.message}`);
      return { ok: false, error: error.message };
    }

    console.log(`[Supabase] Connection test passed (table: ${tableName})`);
    return { ok: true };
  } catch (err) {
    console.error('[Supabase] Test connection error:', err.message);
    return { ok: false, error: err.message };
  }
}
