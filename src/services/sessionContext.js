/**
 * OMEN Session Context Service
 *
 * Maintains conversation state per session for executive analyst behavior.
 * Tracks what was discussed, when, and what recommendations were given.
 *
 * EXECUTIVE ANALYST RULES:
 * - Follow-ups reference prior answers ("As I mentioned about [SKU]...")
 * - Never reset to generic responses mid-conversation
 * - Track confidence basis and explain WHY when low
 * - Always provide best-action guidance even with low confidence
 */

// In-memory session store (use Redis in production)
const sessions = new Map();

// Session TTL: 30 minutes of inactivity
const SESSION_TTL_MS = 30 * 60 * 1000;

/**
 * Session context structure
 * @typedef {object} SessionContext
 * @property {string} sessionId - Unique session identifier
 * @property {number} createdAt - Timestamp when session started
 * @property {number} lastActivityAt - Timestamp of last activity
 * @property {number} messageCount - Total messages in session
 * @property {object} lastDiscussed - Most recently discussed entities
 * @property {string[]} topicsDiscussed - All topics touched in session
 * @property {object[]} recommendationHistory - Recommendations given
 * @property {object} confidenceBasis - Why confidence is what it is
 */

/**
 * Create a new session context
 * @param {string} sessionId
 * @returns {SessionContext}
 */
function createSession(sessionId) {
  const now = Date.now();
  return {
    sessionId,
    createdAt: now,
    lastActivityAt: now,
    messageCount: 0,
    lastDiscussed: {
      sku: null,          // Last SKU mentioned/discussed
      skuContext: null,   // Why that SKU was discussed (promotion, reorder, etc.)
      timeframe: null,    // Last timeframe referenced (daily, weekly, monthly)
      topic: null,        // Last topic (promotion, margin, stock, velocity)
      metric: null,       // Last metric discussed (margin %, revenue, velocity)
      actionType: null,   // Last recommendation type (PROMOTE, REORDER, DISCOUNT)
    },
    topicsDiscussed: [],
    recommendationHistory: [],
    confidenceBasis: {
      dataSource: null,       // 'snapshot', 'live', 'stale'
      dataAge: null,          // Hours since last sync
      orderCount: null,       // Orders backing the analysis
      coveragePercent: null,  // % of SKUs with cost data
      limitations: [],        // What's missing
    },
    pendingFollowUp: null,  // Expected follow-up topic
  };
}

/**
 * Get or create a session
 * @param {string} sessionId
 * @returns {SessionContext}
 */
export function getSession(sessionId) {
  if (!sessionId) {
    sessionId = `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  let session = sessions.get(sessionId);

  if (!session) {
    session = createSession(sessionId);
    sessions.set(sessionId, session);
    console.log(`[SessionContext] New session created: ${sessionId}`);
  } else {
    // Check if session is expired
    const age = Date.now() - session.lastActivityAt;
    if (age > SESSION_TTL_MS) {
      console.log(`[SessionContext] Session expired, creating new: ${sessionId}`);
      session = createSession(sessionId);
      sessions.set(sessionId, session);
    }
  }

  return session;
}

/**
 * Update session with new message context
 * @param {string} sessionId
 * @param {object} update
 */
export function updateSession(sessionId, update) {
  const session = getSession(sessionId);
  session.lastActivityAt = Date.now();
  session.messageCount++;

  // Update last discussed entities
  if (update.sku) {
    session.lastDiscussed.sku = update.sku;
    session.lastDiscussed.skuContext = update.skuContext || null;
  }
  if (update.timeframe) {
    session.lastDiscussed.timeframe = update.timeframe;
  }
  if (update.topic) {
    session.lastDiscussed.topic = update.topic;
    if (!session.topicsDiscussed.includes(update.topic)) {
      session.topicsDiscussed.push(update.topic);
    }
  }
  if (update.metric) {
    session.lastDiscussed.metric = update.metric;
  }
  if (update.actionType) {
    session.lastDiscussed.actionType = update.actionType;
  }

  // Update confidence basis
  if (update.confidenceBasis) {
    session.confidenceBasis = {
      ...session.confidenceBasis,
      ...update.confidenceBasis,
    };
  }

  // Track recommendation if given
  if (update.recommendation) {
    session.recommendationHistory.push({
      timestamp: Date.now(),
      ...update.recommendation,
    });
    // Keep only last 10 recommendations
    if (session.recommendationHistory.length > 10) {
      session.recommendationHistory = session.recommendationHistory.slice(-10);
    }
  }

  // Set expected follow-up
  if (update.pendingFollowUp !== undefined) {
    session.pendingFollowUp = update.pendingFollowUp;
  }

  sessions.set(sessionId, session);
  return session;
}

/**
 * Extract entities from user message for session tracking
 * @param {string} message
 * @param {object} context - Current chat context (inventory, snapshots)
 * @returns {object} Extracted entities
 */
export function extractEntitiesFromMessage(message, context = {}) {
  const lower = message.toLowerCase();
  const extracted = {};

  // Detect timeframe references
  if (lower.includes('today') || lower.includes('daily')) {
    extracted.timeframe = 'daily';
  } else if (lower.includes('week') || lower.includes('weekly') || lower.includes('7 day')) {
    extracted.timeframe = 'weekly';
  } else if (lower.includes('month') || lower.includes('monthly') || lower.includes('30 day')) {
    extracted.timeframe = 'monthly';
  }

  // Detect topic
  if (lower.includes('promot') || lower.includes('feature') || lower.includes('highlight') || lower.includes('push')) {
    extracted.topic = 'promotion';
  } else if (lower.includes('margin') || lower.includes('profit')) {
    extracted.topic = 'margin';
  } else if (lower.includes('stock') || lower.includes('reorder') || lower.includes('inventory') || lower.includes('running low') || lower.includes('out of')) {
    extracted.topic = 'stock';
  } else if (lower.includes('velocity') || lower.includes('moving') || lower.includes('selling') || lower.includes('fast') || lower.includes('slow')) {
    extracted.topic = 'velocity';
  } else if (lower.includes('revenue') || lower.includes('sales') || lower.includes('orders')) {
    extracted.topic = 'revenue';
  }

  // Detect action type
  if (lower.includes('discount') || lower.includes('sale') || lower.includes('% off')) {
    extracted.actionType = 'DISCOUNT';
  } else if (lower.includes('promot') || lower.includes('feature') || lower.includes('push')) {
    extracted.actionType = 'PROMOTE';
  } else if (lower.includes('reorder') || lower.includes('order more') || lower.includes('restock')) {
    extracted.actionType = 'REORDER';
  } else if (lower.includes('bundle') || lower.includes('pair')) {
    extracted.actionType = 'BUNDLE';
  }

  // Try to extract SKU from message (look for quoted names or known patterns)
  // This is enhanced by checking against actual inventory
  if (context.inventory) {
    const inventory = context.inventory;
    for (const item of inventory) {
      const name = item.name || item.sku || '';
      if (name && lower.includes(name.toLowerCase())) {
        extracted.sku = item.sku || item.name;
        extracted.skuContext = extracted.topic || 'mentioned';
        break;
      }
    }
  }

  return extracted;
}

/**
 * Check if message is a follow-up based on session context
 * @param {string} message
 * @param {SessionContext} session
 * @returns {object} Follow-up analysis
 */
export function analyzeFollowUp(message, session) {
  const lower = message.toLowerCase();

  // Strong follow-up indicators
  const strongFollowUp = [
    /^(what about|how about|and|also|tell me more|more about)/i,
    /^(that|this|it|those|these|the same)\b/i,
    /^(why|how come|explain|elaborate)/i,
    /^(what if|instead|alternatively)/i,
    /^(other|different|another|more)\b/i,
  ];

  // Check for pronoun references (these REQUIRE prior context)
  const pronouns = /\b(it|that|this|they|them|the one|which one|same|aforementioned)\b/i;

  const isStrongFollowUp = strongFollowUp.some(p => p.test(lower));
  const hasPronounRef = pronouns.test(lower);

  // Determine follow-up confidence
  let isFollowUp = false;
  let followUpType = null;
  let referencedEntity = null;

  if (isStrongFollowUp || hasPronounRef) {
    isFollowUp = true;

    // What are they following up on?
    if (lower.includes('promot') || lower.includes('feature') || session.lastDiscussed.topic === 'promotion') {
      followUpType = 'promotion_drill_down';
      referencedEntity = session.lastDiscussed.sku;
    } else if (lower.includes('why') && session.lastDiscussed.sku) {
      followUpType = 'explanation';
      referencedEntity = session.lastDiscussed.sku;
    } else if (lower.includes('different') || lower.includes('other') || lower.includes('alternative')) {
      followUpType = 'alternatives';
      referencedEntity = session.lastDiscussed.topic;
    } else if (hasPronounRef && session.lastDiscussed.sku) {
      followUpType = 'sku_reference';
      referencedEntity = session.lastDiscussed.sku;
    } else if (session.pendingFollowUp) {
      followUpType = session.pendingFollowUp;
      referencedEntity = session.lastDiscussed.sku || session.lastDiscussed.topic;
    }
  }

  return {
    isFollowUp,
    followUpType,
    referencedEntity,
    priorTopic: session.lastDiscussed.topic,
    priorSku: session.lastDiscussed.sku,
    priorTimeframe: session.lastDiscussed.timeframe,
    messageCount: session.messageCount,
  };
}

/**
 * Build confidence explanation when confidence is not high
 * @param {SessionContext} session
 * @param {string} confidenceLevel - 'high', 'medium', 'low'
 * @returns {string} Human-readable explanation
 */
export function buildConfidenceExplanation(session, confidenceLevel) {
  const basis = session.confidenceBasis;
  const parts = [];

  if (confidenceLevel === 'high') {
    return null; // High confidence doesn't need explanation
  }

  // Explain WHY confidence is not high
  if (basis.dataAge && basis.dataAge > 24) {
    parts.push(`data is ${Math.round(basis.dataAge)} hours old`);
  }

  if (basis.orderCount === 0) {
    parts.push('no order data in this period');
  } else if (basis.orderCount && basis.orderCount < 10) {
    parts.push(`only ${basis.orderCount} orders to analyze`);
  }

  if (basis.coveragePercent && basis.coveragePercent < 50) {
    parts.push(`only ${basis.coveragePercent}% of SKUs have cost data`);
  }

  if (basis.limitations && basis.limitations.length > 0) {
    parts.push(...basis.limitations.slice(0, 2));
  }

  if (parts.length === 0) {
    return null;
  }

  return `(${confidenceLevel.charAt(0).toUpperCase() + confidenceLevel.slice(1)} confidence: ${parts.join(', ')})`;
}

/**
 * Generate best-action guidance regardless of confidence
 * This ensures OMEN always provides actionable advice
 * @param {string} topic
 * @param {SessionContext} session
 * @param {object} context
 * @returns {string}
 */
export function generateBestActionGuidance(topic, session, context = {}) {
  const basis = session.confidenceBasis;

  // Even with low confidence, provide directional guidance
  const guidance = {
    promotion: {
      low: "Focus on your best-selling items from last month — they have proven demand even if recent data is limited.",
      medium: "Prioritize items with both margin headroom and recent movement. Watch for 3 days and adjust.",
      high: "Execute the recommendation. Track daily depletion to confirm momentum.",
    },
    stock: {
      low: "Check your top 5 sellers manually and reorder anything under 10 units. This beats waiting for better data.",
      medium: "Prioritize reorders by revenue risk — items that sell fastest when in stock get restocked first.",
      high: "Execute reorders now. Lead time means every day of delay is lost sales.",
    },
    margin: {
      low: "Review your cost file for accuracy — margin insights are only as good as your cost data.",
      medium: "Test price increases on slow movers first — less risk, and it validates your margin assumptions.",
      high: "Adjust pricing on flagged items. Monitor velocity for 1 week to confirm no demand drop.",
    },
    velocity: {
      low: "Compare against your gut feel — what SHOULD be selling? If data conflicts, investigate inventory counts.",
      medium: "Trust the direction, not the exact numbers. Acceleration matters more than absolute velocity.",
      high: "React to momentum changes within 48 hours — velocity spikes fade fast.",
    },
    revenue: {
      low: "Check your order source (Wix) directly to validate reported numbers before acting.",
      medium: "Focus on the trend direction rather than exact dollars. Up/down matters more than precise amounts.",
      high: "Revenue signals are clean. Dig into SKU-level drivers for actionable insight.",
    },
  };

  const topicGuidance = guidance[topic] || guidance.promotion;
  const level = basis.orderCount > 20 ? 'high' : (basis.orderCount > 5 ? 'medium' : 'low');

  return topicGuidance[level] || topicGuidance.medium;
}

/**
 * Generate context-aware opening for follow-up responses
 * @param {object} followUpAnalysis
 * @param {SessionContext} session
 * @returns {string}
 */
export function generateFollowUpOpening(followUpAnalysis, session) {
  const { followUpType, referencedEntity, priorTopic, priorSku } = followUpAnalysis;

  if (followUpType === 'explanation' && priorSku) {
    return `About ${priorSku} — `;
  }

  if (followUpType === 'alternatives' && priorTopic) {
    return `Beyond what I mentioned — `;
  }

  if (followUpType === 'sku_reference' && priorSku) {
    return `For ${priorSku}: `;
  }

  if (followUpType === 'promotion_drill_down' && priorSku) {
    return `Drilling into ${priorSku}'s promotion potential — `;
  }

  if (priorTopic && session.messageCount > 1) {
    return `Continuing on ${priorTopic} — `;
  }

  return '';
}

/**
 * Clean up expired sessions (call periodically)
 */
export function cleanupSessions() {
  const now = Date.now();
  let cleaned = 0;

  for (const [sessionId, session] of sessions.entries()) {
    if (now - session.lastActivityAt > SESSION_TTL_MS) {
      sessions.delete(sessionId);
      cleaned++;
    }
  }

  if (cleaned > 0) {
    console.log(`[SessionContext] Cleaned up ${cleaned} expired sessions`);
  }
}

// Cleanup every 10 minutes
setInterval(cleanupSessions, 10 * 60 * 1000);

/**
 * Get session stats (for debugging)
 */
export function getSessionStats() {
  return {
    activeSessions: sessions.size,
    sessions: Array.from(sessions.values()).map(s => ({
      id: s.sessionId,
      messageCount: s.messageCount,
      lastTopic: s.lastDiscussed.topic,
      lastSku: s.lastDiscussed.sku,
      age: Math.round((Date.now() - s.createdAt) / 1000 / 60) + ' min',
    })),
  };
}

export default {
  getSession,
  updateSession,
  extractEntitiesFromMessage,
  analyzeFollowUp,
  buildConfidenceExplanation,
  generateBestActionGuidance,
  generateFollowUpOpening,
  cleanupSessions,
  getSessionStats,
};
