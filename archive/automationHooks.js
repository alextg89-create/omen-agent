/**
 * Automation Hook Registry
 *
 * Maps signal types to potential automation actions
 * External systems can subscribe to these hooks
 *
 * DESIGN PHILOSOPHY:
 * - Hooks are declarative (what to do, not how)
 * - System emits events, external integrations consume
 * - No hardcoded email/Slack/etc. in core engine
 * - Flexible configuration per hook
 *
 * EXAMPLES:
 * - Send email when CRITICAL_DEPLETION fires
 * - Post to Slack when AGING_STOCK detected
 * - Create purchase order when URGENT_REORDER triggered
 */

/**
 * Hook Types (Actions that can be automated)
 */
export const HOOK_TYPES = {
  // Alert hooks
  SEND_EMAIL: "SEND_EMAIL",
  SEND_SLACK: "SEND_SLACK",
  SEND_SMS: "SEND_SMS",
  SEND_WEBHOOK: "SEND_WEBHOOK",

  // Action hooks
  CREATE_PURCHASE_ORDER: "CREATE_PURCHASE_ORDER",
  UPDATE_WEBSITE_PRICE: "UPDATE_WEBSITE_PRICE",
  MARK_AS_FEATURED: "MARK_AS_FEATURED",
  TRIGGER_PROMOTION: "TRIGGER_PROMOTION",

  // Logging hooks
  LOG_TO_ANALYTICS: "LOG_TO_ANALYTICS",
  RECORD_METRIC: "RECORD_METRIC",
  CREATE_TASK: "CREATE_TASK",
};

/**
 * Hook Configuration Schema
 *
 * Defines WHEN and WHAT to trigger
 */
export const HookConfigSchema = {
  hookId: "string", // Unique identifier
  enabled: "boolean", // Is this hook active?

  // Trigger conditions
  signalType: "string", // CRITICAL_DEPLETION, etc. (null = any)
  severity: "string", // critical, high, medium, low (null = any)

  // Action
  hookType: "string", // SEND_EMAIL, etc.
  config: "object", // Hook-specific configuration

  // Filtering
  minConfidence: "string", // Only trigger for high-confidence signals
  cooldownMinutes: "number", // Prevent spam (e.g., max 1 alert per hour)

  // Metadata
  createdAt: "ISODate",
  updatedAt: "ISODate",
};

/**
 * Evaluate hooks for detected signals
 *
 * Does NOT execute actions - just identifies what SHOULD happen
 *
 * @param {Array<object>} signals - Detected signals
 * @param {Array<object>} hookConfigs - Active hook configurations
 * @returns {Array<object>} - Triggered hooks (ready for execution)
 */
export function evaluateHooks(signals, hookConfigs) {
  const triggeredHooks = [];

  for (const signal of signals) {
    for (const hook of hookConfigs) {
      // Check if hook applies to this signal
      if (!hook.enabled) continue;
      if (hook.signalType && hook.signalType !== signal.type) continue;
      if (hook.severity && hook.severity !== signal.severity) continue;
      if (hook.minConfidence && !meetsConfidence(signal.confidence, hook.minConfidence))
        continue;

      // Check cooldown (prevent spam)
      if (hook.cooldownMinutes && isInCooldown(hook, signal)) continue;

      // Hook should trigger
      triggeredHooks.push({
        hookId: hook.hookId,
        hookType: hook.hookType,
        signal,
        config: hook.config,
        timestamp: new Date().toISOString(),
      });
    }
  }

  return triggeredHooks;
}

/**
 * Check if confidence level meets threshold
 *
 * @param {string} signalConfidence - Signal's confidence
 * @param {string} requiredConfidence - Required minimum
 * @returns {boolean}
 */
function meetsConfidence(signalConfidence, requiredConfidence) {
  const levels = { low: 1, medium: 2, high: 3 };
  return levels[signalConfidence] >= levels[requiredConfidence];
}

/**
 * Check if hook is in cooldown period
 *
 * NOTE: This is a stub - requires state storage to track last execution
 *
 * @param {object} hook
 * @param {object} signal
 * @returns {boolean}
 */
function isInCooldown(hook, signal) {
  // TODO: Implement cooldown tracking
  // Would require state storage:
  // - Store last execution time per hook+signal combination
  // - Check if current time < lastExecution + cooldownMinutes
  // For now, return false (no cooldown)
  return false;
}

/**
 * Default hook configurations (examples)
 *
 * These are templates - actual hooks would be configured per store
 */
export const DEFAULT_HOOKS = [
  {
    hookId: "critical-depletion-email",
    enabled: false, // Off by default
    signalType: "CRITICAL_DEPLETION",
    severity: "critical",
    hookType: "SEND_EMAIL",
    minConfidence: "medium",
    cooldownMinutes: 60,
    config: {
      recipient: "manager@example.com",
      subject: "Critical Stock Alert: {{sku}}",
      template: "critical-depletion",
    },
  },
  {
    hookId: "aging-stock-slack",
    enabled: false,
    signalType: "AGING_STOCK",
    severity: "high",
    hookType: "SEND_SLACK",
    minConfidence: "high",
    cooldownMinutes: 360, // 6 hours
    config: {
      channel: "#inventory-alerts",
      template: "aging-stock",
    },
  },
  {
    hookId: "urgent-reorder-task",
    enabled: false,
    signalType: "URGENT_REORDER",
    severity: "high",
    hookType: "CREATE_TASK",
    minConfidence: "medium",
    cooldownMinutes: 1440, // 24 hours
    config: {
      taskTitle: "Reorder: {{sku}} ({{unit}})",
      assignTo: "purchasing",
      priority: "high",
    },
  },
  {
    hookId: "price-opportunity-webhook",
    enabled: false,
    signalType: "PRICE_OPPORTUNITY",
    severity: "medium",
    hookType: "SEND_WEBHOOK",
    minConfidence: "medium",
    cooldownMinutes: 720, // 12 hours
    config: {
      url: "https://example.com/webhooks/pricing",
      method: "POST",
    },
  },
];

/**
 * Hook execution layer (STUB - not implemented)
 *
 * This would be implemented by integration layer, NOT core engine
 *
 * @param {Array<object>} triggeredHooks
 * @returns {Promise<Array<object>>} - Execution results
 */
export async function executeHooks(triggeredHooks) {
  const results = [];

  for (const hook of triggeredHooks) {
    try {
      // This is where external integrations would be called
      switch (hook.hookType) {
        case HOOK_TYPES.SEND_EMAIL:
          // await sendEmail(hook.config, hook.signal);
          results.push({
            hookId: hook.hookId,
            status: "not_implemented",
            message: "Email sending not implemented yet",
          });
          break;

        case HOOK_TYPES.SEND_SLACK:
          // await postToSlack(hook.config, hook.signal);
          results.push({
            hookId: hook.hookId,
            status: "not_implemented",
            message: "Slack integration not implemented yet",
          });
          break;

        case HOOK_TYPES.SEND_WEBHOOK:
          // await sendWebhook(hook.config, hook.signal);
          results.push({
            hookId: hook.hookId,
            status: "not_implemented",
            message: "Webhook sending not implemented yet",
          });
          break;

        case HOOK_TYPES.CREATE_TASK:
          // await createTask(hook.config, hook.signal);
          results.push({
            hookId: hook.hookId,
            status: "not_implemented",
            message: "Task creation not implemented yet",
          });
          break;

        default:
          results.push({
            hookId: hook.hookId,
            status: "unknown_type",
            message: `Unknown hook type: ${hook.hookType}`,
          });
      }
    } catch (error) {
      results.push({
        hookId: hook.hookId,
        status: "error",
        message: error.message,
      });
    }
  }

  return results;
}

/**
 * Template variable substitution
 *
 * Replace {{variable}} placeholders with signal data
 *
 * @param {string} template - Template string
 * @param {object} signal - Signal data
 * @returns {string} - Rendered string
 */
export function renderTemplate(template, signal) {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    return signal[key] !== undefined ? signal[key] : match;
  });
}

/**
 * Validate hook configuration
 *
 * @param {object} hookConfig
 * @returns {object} - { valid: boolean, errors: string[] }
 */
export function validateHookConfig(hookConfig) {
  const errors = [];

  // Required fields
  if (!hookConfig.hookId) errors.push("hookId is required");
  if (hookConfig.enabled === undefined) errors.push("enabled is required");
  if (!hookConfig.hookType) errors.push("hookType is required");
  if (!hookConfig.config) errors.push("config is required");

  // Valid hook type
  if (hookConfig.hookType && !Object.values(HOOK_TYPES).includes(hookConfig.hookType)) {
    errors.push(`Invalid hookType: ${hookConfig.hookType}`);
  }

  // Valid severity (if specified)
  if (
    hookConfig.severity &&
    !["critical", "high", "medium", "low"].includes(hookConfig.severity)
  ) {
    errors.push(`Invalid severity: ${hookConfig.severity}`);
  }

  // Valid confidence (if specified)
  if (
    hookConfig.minConfidence &&
    !["low", "medium", "high"].includes(hookConfig.minConfidence)
  ) {
    errors.push(`Invalid minConfidence: ${hookConfig.minConfidence}`);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Create hook from template
 *
 * @param {string} templateName - Name of default hook template
 * @param {object} overrides - Configuration overrides
 * @returns {object} - Hook configuration
 */
export function createHookFromTemplate(templateName, overrides = {}) {
  const template = DEFAULT_HOOKS.find((h) => h.hookId === templateName);
  if (!template) {
    throw new Error(`Hook template not found: ${templateName}`);
  }

  return {
    ...template,
    ...overrides,
    hookId: overrides.hookId || `${templateName}-${Date.now()}`,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

/**
 * USAGE EXAMPLES:
 *
 * 1. Evaluate which hooks should trigger:
 *    const triggered = evaluateHooks(signals, activeHooks);
 *
 * 2. Execute triggered hooks:
 *    const results = await executeHooks(triggered);
 *
 * 3. Create custom hook:
 *    const hook = createHookFromTemplate('critical-depletion-email', {
 *      enabled: true,
 *      config: { recipient: 'custom@example.com' }
 *    });
 *
 * 4. Render template:
 *    const subject = renderTemplate('Alert: {{sku}} ({{unit}})', signal);
 */
