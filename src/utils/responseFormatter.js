/**
 * RESPONSE FORMATTING LAYER
 * Single source of truth for all user-facing text
 * Enforces hard constraints on output quality and accuracy
 */

// FORBIDDEN PATTERNS
const MARKDOWN_PATTERN = /(\*\*|__|###|```)/g;
const FORBIDDEN_WORDS_WITHOUT_SALES = [
  'best-selling', 'best selling', 'bestselling',
  'top-selling', 'top selling', 'topselling',
  'top performer', 'top-performer',
  'highest performing', 'best performing'
];

/**
 * Strip markdown formatting from text
 */
function stripMarkdown(text) {
  if (!text) return '';

  return text
    .replace(/\*\*([^*]+)\*\*/g, '$1')  // **bold** -> bold
    .replace(/__([^_]+)__/g, '$1')      // __bold__ -> bold
    .replace(/###\s+/g, '')              // ### heading -> heading
    .replace(/```[^`]*```/g, '')         // ```code``` -> remove
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // [link](url) -> link
    .replace(/\\\[/g, '')                // \[ math -> remove
    .replace(/\\\]/g, '')                // \] math -> remove
    .replace(/\$\$/g, '');               // $$ math -> remove
}

/**
 * Validate response doesn't claim sales performance without data
 */
function validateSalesLanguage(text, hasSalesData = false) {
  if (hasSalesData) return text; // Sales data exists, no restrictions
  if (!text) return '';

  const lowerText = text.toLowerCase();
  const violations = FORBIDDEN_WORDS_WITHOUT_SALES.filter(word =>
    lowerText.includes(word)
  );

  if (violations.length > 0) {
    console.warn(`[ResponseFormatter] Blocked forbidden language: ${violations.join(', ')}`);
    // Replace with safe alternatives
    return text
      .replace(/best-selling|best selling|bestselling/gi, 'highest margin')
      .replace(/top-selling|top selling|topselling/gi, 'highest margin')
      .replace(/top performer|top-performer/gi, 'highest margin item')
      .replace(/highest performing|best performing/gi, 'highest margin');
  }

  return text;
}

/**
 * Enforce length limits for chat responses
 */
function enforceBrevity(text, maxSentences = 3) {
  if (!text) return '';

  const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];

  if (sentences.length <= maxSentences) return text;

  // Truncate to max sentences
  return sentences.slice(0, maxSentences).join(' ').trim();
}

/**
 * Remove calculation formulas from text
 */
function removeFormulas(text) {
  if (!text) return '';

  return text
    .replace(/\\\[.*?\\\]/gs, '')        // LaTeX block math
    .replace(/\$\$.*?\$\$/gs, '')         // Inline math
    .replace(/\\text\{[^}]*\}/g, '')      // \text{} commands
    .replace(/\\frac\{[^}]*\}\{[^}]*\}/g, '') // \frac{}{} commands
    .replace(/\\left|\\right/g, '')       // \left \right
    .replace(/times 100/g, '× 100')       // Clean up remnants
    .trim();
}

/**
 * MAIN EXPORT: Format chat response
 * @param {string} text - Raw LLM response
 * @param {object} options - Formatting options
 * @returns {string} Formatted response
 */
export function formatChatResponse(text, options = {}) {
  const {
    hasSalesData = false,
    maxSentences = 3,
    allowFormulas = false
  } = options;

  if (!text) return '';

  let formatted = text;

  // 1. Strip markdown FIRST (most critical)
  formatted = stripMarkdown(formatted);

  // 2. Remove formulas unless explicitly allowed
  if (!allowFormulas) {
    formatted = removeFormulas(formatted);
  }

  // 3. Validate sales language
  formatted = validateSalesLanguage(formatted, hasSalesData);

  // 4. Enforce brevity
  formatted = enforceBrevity(formatted, maxSentences);

  // 5. Add data disclaimer if discussing margins without sales data
  if (!hasSalesData && formatted.toLowerCase().includes('margin')) {
    // Only add if not already present
    const hasDisclaimer =
      formatted.includes('based on') ||
      formatted.includes('inventory only') ||
      formatted.includes('not sales');

    if (!hasDisclaimer) {
      formatted += ' (Based on current inventory margins only, not sales performance.)';
    }
  }

  // 6. Clean up whitespace
  formatted = formatted
    .replace(/\s+/g, ' ')  // Multiple spaces -> single space
    .replace(/\s+\./g, '.') // Space before period
    .replace(/\s+,/g, ',')  // Space before comma
    .trim();

  return formatted;
}

/**
 * Format email section text
 * Emails allow basic structure but no markdown
 */
export function formatEmailSection(text) {
  if (!text) return '';
  return stripMarkdown(text);
}

/**
 * Validate snapshot doesn't claim "no changes" when recommendations exist
 */
export function validateSnapshotSummary(summary, recommendations) {
  if (!summary || !recommendations) return summary;

  const hasRecommendations =
    (recommendations.promotions && recommendations.promotions.length > 0) ||
    (recommendations.pricing && recommendations.pricing.length > 0) ||
    (recommendations.inventory && recommendations.inventory.length > 0);

  if (hasRecommendations && summary.toLowerCase().includes('no significant changes')) {
    console.error('[ResponseFormatter] INVALID: Snapshot claims no changes but has recommendations');

    const total =
      (recommendations.promotions?.length || 0) +
      (recommendations.pricing?.length || 0) +
      (recommendations.inventory?.length || 0);

    return `${total} recommendations identified`;
  }

  return summary;
}

/**
 * Validate forbidden patterns in text (for testing/monitoring)
 */
export function detectForbiddenPatterns(text) {
  if (!text) return [];

  const violations = [];

  // Check for markdown
  if (text.match(/\*\*/)) violations.push('markdown_bold');
  if (text.match(/__/)) violations.push('markdown_italic');
  if (text.match(/###/)) violations.push('markdown_heading');
  if (text.match(/```/)) violations.push('markdown_code');

  // Check for sales language without qualifier
  const lowerText = text.toLowerCase();
  FORBIDDEN_WORDS_WITHOUT_SALES.forEach(word => {
    if (lowerText.includes(word)) {
      violations.push(`forbidden_word:${word}`);
    }
  });

  // Check for formulas
  if (text.match(/\\\[|\\\]/)) violations.push('latex_formula');
  if (text.match(/\$\$/)) violations.push('math_formula');

  return violations;
}
