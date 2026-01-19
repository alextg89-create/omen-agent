/**
 * Supabase Client Configuration
 *
 * READ-ONLY client for querying order events and inventory state
 *
 * Environment Variables Required:
 * - SUPABASE_URL: Your Supabase project URL
 * - SUPABASE_SERVICE_KEY: Service role key (server-side only)
 *
 * Feature Flag: OMEN_USE_SUPABASE (default: false)
 */

import { createClient } from '@supabase/supabase-js';

// Feature flag - must be explicitly enabled
const SUPABASE_ENABLED = process.env.OMEN_USE_SUPABASE === 'true';

// Environment validation
// CRITICAL: .trim() removes newlines/whitespace that cause "invalid header value" errors
const SUPABASE_URL = (process.env.SUPABASE_URL || '').trim();
const SUPABASE_SERVICE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '').trim();

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
 */
function initializeSupabase() {
  if (!SUPABASE_ENABLED) {
    console.log('[Supabase] Feature flag disabled (OMEN_USE_SUPABASE=false)');
    connectionStatus.error = 'Feature flag disabled';
    return;
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.warn('[Supabase] Missing credentials - falling back to local storage');
    console.warn('[Supabase] Set SUPABASE_URL and SUPABASE_SERVICE_KEY to enable');
    connectionStatus.configured = false;
    connectionStatus.error = 'Missing credentials';
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

    console.log('[Supabase] Client initialized successfully');
    console.log(`[Supabase] URL: ${SUPABASE_URL}`);
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
