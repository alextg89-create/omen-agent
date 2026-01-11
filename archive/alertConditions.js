/**
 * Alert System
 *
 * Defines alert trigger conditions and severity levels
 * Converts signals into actionable alerts
 *
 * ALERT vs SIGNAL:
 * - Signal: Raw detection (e.g., "stock depleting in 3 days")
 * - Alert: Actionable notification with severity and channels
 *
 * DESIGN:
 * - Declarative alert rules
 * - Severity-based routing
 * - Channel preferences per severity
 */

import { computeVelocityDelta } from "./snapshotAnalysis.js";

/**
 * Alert Severity Levels
 *
 * Defines priority, visual indicators, and default channels
 */
export const ALERT_SEVERITY = {
  CRITICAL: {
    level: "critical",
    priority: 1,
    color: "#dc3545",
    icon: "🚨",
    requiresAcknowledgment: true,
    defaultChannels: ["email", "sms", "slack"],
  },
  HIGH: {
    level: "high",
    priority: 2,
    color: "#ff9800",
    icon: "⚠️",
    requiresAcknowledgment: false,
    defaultChannels: ["email", "slack"],
  },
  MEDIUM: {
    level: "medium",
    priority: 3,
    color: "#2196f3",
    icon: "ℹ️",
    requiresAcknowledgment: false,
    defaultChannels: ["slack"],
  },
  LOW: {
    level: "low",
    priority: 4,
    color: "#28a745",
    icon: "📊",
    requiresAcknowledgment: false,
    defaultChannels: [],
  },
};

/**
 * Alert Condition Definitions
 *
 * Maps business rules to alert generation
 */
export const ALERT_CONDITIONS = {
  // Stock Depletion Alerts
  CRITICAL_STOCK_ALERT: {
    condition: (item) => item.depletion?.daysUntilDepletion <= 3 && item.depletion?.daysUntilDepletion > 0,
    severity: "CRITICAL",
    message: (item) =>
      `${item.sku} (${item.unit}) will run out in ${item.depletion.daysUntilDepletion} day${item.depletion.daysUntilDepletion > 1 ? "s" : ""}`,
    action: "Reorder immediately",
  },

  URGENT_STOCK_ALERT: {
    condition: (item) =>
      item.depletion?.daysUntilDepletion > 3 && item.depletion?.daysUntilDepletion <= 7,
    severity: "HIGH",
    message: (item) =>
      `${item.sku} (${item.unit}) has ${item.depletion.daysUntilDepletion} days of stock remaining`,
    action: "Plan reorder soon",
  },

  // Zero Sales Alerts
  STAGNANT_ALERT: {
    condition: (item) =>
      item.velocity?.totalUnitsSold === 0 &&
      item.quantityOnHand > 10 &&
      item.velocity?.observationDays >= 30,
    severity: "HIGH",
    message: (item) =>
      `${item.sku} (${item.unit}) has no sales in ${item.velocity.observationDays} days with ${item.quantityOnHand} units in stock`,
    action: "Consider promotion or discount",
  },

  // Acceleration Alerts
  ACCELERATING_SALES_ALERT: {
    condition: (item, history) => {
      if (!item.velocity || !history.previousVelocity) return false;
      const delta = computeVelocityDelta(item.velocity, history.previousVelocity);
      return delta.pattern === "accelerating";
    },
    severity: "MEDIUM",
    message: (item, history) => {
      const delta = computeVelocityDelta(item.velocity, history.previousVelocity);
      return `${item.sku} (${item.unit}) sales accelerating: ${delta.percent.toFixed(1)}% increase`;
    },
    action: "Monitor stock levels - may need to increase inventory",
  },

  // Deceleration Alerts
  DECELERATING_SALES_ALERT: {
    condition: (item, history) => {
      if (!item.velocity || !history.previousVelocity) return false;
      const delta = computeVelocityDelta(item.velocity, history.previousVelocity);
      return delta.pattern === "decelerating";
    },
    severity: "MEDIUM",
    message: (item, history) => {
      const delta = computeVelocityDelta(item.velocity, history.previousVelocity);
      return `${item.sku} (${item.unit}) sales slowing: ${Math.abs(delta.percent).toFixed(1)}% decrease`;
    },
    action: "Consider promotion to boost sales",
  },

  // Margin Health Alerts
  MARGIN_DECLINE_ALERT: {
    condition: (item, history) => history.marginTrend?.trend === "decreasing",
    severity: "MEDIUM",
    message: (item) => `${item.sku} (${item.unit}) margin is declining over time`,
    action: "Review pricing strategy and cost structure",
  },

  // Aging Inventory
  AGING_INVENTORY_ALERT: {
    condition: (item) =>
      item.quantityOnHand > 15 &&
      item.velocity?.totalUnitsSold === 0 &&
      item.velocity?.observationDays >= 30,
    severity: "HIGH",
    message: (item) =>
      `${item.sku} (${item.unit}) has ${item.quantityOnHand} units with no sales in ${item.velocity.observationDays} days - aging risk`,
    action: "Urgent: Promote or discount to clear inventory",
  },
};

/**
 * Evaluate all alert conditions
 *
 * @param {Array<object>} inventoryWithVelocity - Inventory items with velocity
 * @param {object} historicalData - Historical data by SKU
 * @returns {Array<object>} - Triggered alerts
 */
export function evaluateAlerts(inventoryWithVelocity, historicalData = {}) {
  const alerts = [];

  for (const item of inventoryWithVelocity) {
    const itemHistory = historicalData[item.sku] || {};

    for (const [alertType, config] of Object.entries(ALERT_CONDITIONS)) {
      if (config.condition(item, itemHistory)) {
        const severityLevel = ALERT_SEVERITY[config.severity];

        alerts.push({
          alertType,
          severity: severityLevel.level,
          priority: severityLevel.priority,
          sku: item.sku,
          unit: item.unit,
          message: config.message(item, itemHistory),
          action: config.action,
          timestamp: new Date().toISOString(),
          acknowledged: false,
          icon: severityLevel.icon,
          color: severityLevel.color,
          channels: severityLevel.defaultChannels,
          requiresAcknowledgment: severityLevel.requiresAcknowledgment,
        });
      }
    }
  }

  // Sort by priority (lowest number = highest priority)
  return alerts.sort((a, b) => a.priority - b.priority);
}

/**
 * Filter alerts by severity
 *
 * @param {Array<object>} alerts
 * @param {string|Array<string>} severities
 * @returns {Array<object>}
 */
export function filterAlertsBySeverity(alerts, severities) {
  const severityArray = Array.isArray(severities) ? severities : [severities];
  return alerts.filter((a) => severityArray.includes(a.severity));
}

/**
 * Get unacknowledged alerts
 *
 * @param {Array<object>} alerts
 * @returns {Array<object>}
 */
export function getUnacknowledgedAlerts(alerts) {
  return alerts.filter((a) => !a.acknowledged && a.requiresAcknowledgment);
}

/**
 * Acknowledge alert
 *
 * @param {object} alert
 * @param {string} acknowledgedBy - User who acknowledged
 * @returns {object} - Updated alert
 */
export function acknowledgeAlert(alert, acknowledgedBy = "system") {
  return {
    ...alert,
    acknowledged: true,
    acknowledgedAt: new Date().toISOString(),
    acknowledgedBy,
  };
}

/**
 * Format alert for email
 *
 * @param {object} alert
 * @returns {string}
 */
export function formatAlertForEmail(alert) {
  const severityLabel = alert.severity.toUpperCase();
  const requiresAck = alert.requiresAcknowledgment ? " [REQUIRES ACKNOWLEDGMENT]" : "";

  return `
${alert.icon} ${severityLabel} ALERT${requiresAck}

Product: ${alert.sku} (${alert.unit})
Issue: ${alert.message}
Action: ${alert.action}

Time: ${new Date(alert.timestamp).toLocaleString()}
  `.trim();
}

/**
 * Format alert for Slack
 *
 * @param {object} alert
 * @returns {object} - Slack message format
 */
export function formatAlertForSlack(alert) {
  return {
    attachments: [
      {
        color: alert.color,
        title: `${alert.icon} ${alert.severity.toUpperCase()} Alert`,
        text: alert.message,
        fields: [
          {
            title: "Product",
            value: `${alert.sku} (${alert.unit})`,
            short: true,
          },
          {
            title: "Action",
            value: alert.action,
            short: true,
          },
        ],
        footer: "OMEN Intelligence",
        ts: Math.floor(new Date(alert.timestamp).getTime() / 1000),
      },
    ],
  };
}

/**
 * Get alert summary
 *
 * @param {Array<object>} alerts
 * @returns {object}
 */
export function getAlertSummary(alerts) {
  const summary = {
    total: alerts.length,
    bySeverity: {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
    },
    requiresAcknowledgment: 0,
    unacknowledged: 0,
  };

  for (const alert of alerts) {
    summary.bySeverity[alert.severity] = (summary.bySeverity[alert.severity] || 0) + 1;

    if (alert.requiresAcknowledgment) {
      summary.requiresAcknowledgment += 1;
      if (!alert.acknowledged) {
        summary.unacknowledged += 1;
      }
    }
  }

  return summary;
}

/**
 * Deduplicate alerts (same SKU + alert type)
 *
 * Keeps only the most recent alert per SKU+type
 *
 * @param {Array<object>} alerts
 * @returns {Array<object>}
 */
export function deduplicateAlerts(alerts) {
  const seen = new Map();

  for (const alert of alerts) {
    const key = `${alert.sku}:${alert.unit}:${alert.alertType}`;

    if (!seen.has(key) || alert.timestamp > seen.get(key).timestamp) {
      seen.set(key, alert);
    }
  }

  return Array.from(seen.values()).sort((a, b) => a.priority - b.priority);
}

/**
 * USAGE EXAMPLES:
 *
 * 1. Evaluate alerts:
 *    const alerts = evaluateAlerts(inventoryWithVelocity, historicalData);
 *
 * 2. Get critical alerts only:
 *    const critical = filterAlertsBySeverity(alerts, 'critical');
 *
 * 3. Format for email:
 *    const emailBody = alerts.map(formatAlertForEmail).join('\n\n');
 *
 * 4. Get unacknowledged:
 *    const needsAck = getUnacknowledgedAlerts(alerts);
 */
