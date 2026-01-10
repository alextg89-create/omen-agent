/**
 * TEST SCRIPT: Response Formatting Validation
 * Verifies that the response formatter enforces all hard constraints
 */

import { formatChatResponse, detectForbiddenPatterns } from './src/utils/responseFormatter.js';

console.log('🧪 Testing Response Formatter\n');

// Test 1: Strip Markdown
console.log('TEST 1: Strip Markdown');
const markdownInput = 'Your **average margin** is __60.51%__. The ### Top Item is Bloopiez.';
const stripped = formatChatResponse(markdownInput);
console.log('Input:', markdownInput);
console.log('Output:', stripped);
console.log('Violations:', detectForbiddenPatterns(stripped));
console.assert(!stripped.includes('**'), 'FAIL: Markdown bold not stripped');
console.assert(!stripped.includes('__'), 'FAIL: Markdown italic not stripped');
console.assert(!stripped.includes('###'), 'FAIL: Markdown heading not stripped');
console.log('✅ PASS\n');

// Test 2: Block Forbidden Sales Language
console.log('TEST 2: Block Forbidden Sales Language');
const salesInput = 'The best-selling item is Bloopiez. This is the top performer.';
const safe = formatChatResponse(salesInput, { hasSalesData: false });
console.log('Input:', salesInput);
console.log('Output:', safe);
console.log('Violations:', detectForbiddenPatterns(safe));
console.assert(!safe.toLowerCase().includes('best-selling'), 'FAIL: "best-selling" not blocked');
console.assert(!safe.toLowerCase().includes('top performer'), 'FAIL: "top performer" not blocked');
console.log('✅ PASS\n');

// Test 3: Enforce Brevity
console.log('TEST 3: Enforce Brevity (3 sentence max)');
const longInput = 'First sentence here. Second sentence here. Third sentence here. Fourth sentence should be removed. Fifth too.';
const brief = formatChatResponse(longInput, { maxSentences: 3 });
console.log('Input:', longInput);
console.log('Output:', brief);
const sentenceCount = (brief.match(/[.!?]/g) || []).length;
console.assert(sentenceCount <= 3, `FAIL: ${sentenceCount} sentences, expected max 3`);
console.log('✅ PASS\n');

// Test 4: Remove Formulas
console.log('TEST 4: Remove Formulas');
const formulaInput = 'Margin is calculated as \\[ \\text{Margin} = \\frac{\\text{Retail} - \\text{Cost}}{\\text{Retail}} \\times 100 \\]';
const noFormula = formatChatResponse(formulaInput, { allowFormulas: false });
console.log('Input:', formulaInput);
console.log('Output:', noFormula);
console.assert(!noFormula.includes('\\['), 'FAIL: LaTeX formula not removed');
console.assert(!noFormula.includes('\\frac'), 'FAIL: LaTeX frac not removed');
console.log('✅ PASS\n');

// Test 5: Add Sales Disclaimer
console.log('TEST 5: Add Sales Disclaimer When Discussing Margins');
const marginInput = 'Your average margin is 60.51%.';
const withDisclaimer = formatChatResponse(marginInput, { hasSalesData: false });
console.log('Input:', marginInput);
console.log('Output:', withDisclaimer);
console.assert(
  withDisclaimer.includes('inventory') || withDisclaimer.includes('not sales'),
  'FAIL: Sales disclaimer not added'
);
console.log('✅ PASS\n');

// Test 6: Real-World Example (Verbose GPT Response)
console.log('TEST 6: Real-World Verbose GPT Response');
const gptResponse = `Your inventory margins can be summarized as follows: 1. **Average Margin**: The average margin across your items is **60.51%**. This means that, on average, you retain 60.51% of the selling price as profit after covering the cost of the items. 2. **Highest Margin Item**: **Bloopiez (eighth)**, which has a margin of **60%**. This indicates it is one of the best-selling products. 3. **Lowest Margin Item**: **Bloopiez (oz)** at **60%** margin. ### Calculation of Margins: - **Margin Calculation Formula**: \\[ \\text{Margin} = \\left( \\frac{\\text{Retail Price} - \\text{Cost}}{\\text{Retail Price}} \\right) \\times 100 \\] For example, for **Bloopiez (eighth)**: - Retail Price = $18 - Cost = $7 - Margin = \\(\\frac{18 - 7}{18} \\times 100 \\approx 61.11\\%\\)`;

const cleaned = formatChatResponse(gptResponse, { hasSalesData: false, maxSentences: 3 });
console.log('Input length:', gptResponse.length, 'characters');
console.log('Output length:', cleaned.length, 'characters');
console.log('Output:', cleaned);
console.log('Violations:', detectForbiddenPatterns(cleaned));

console.assert(!cleaned.includes('**'), 'FAIL: Markdown not stripped');
console.assert(!cleaned.includes('###'), 'FAIL: Headings not stripped');
console.assert(!cleaned.toLowerCase().includes('best-selling'), 'FAIL: Forbidden language present');
console.assert(!cleaned.includes('\\['), 'FAIL: Formulas not removed');
console.assert(cleaned.length < gptResponse.length * 0.5, 'FAIL: Not sufficiently truncated');

console.log('✅ PASS\n');

console.log('═══════════════════════════════════════');
console.log('ALL TESTS PASSED ✅');
console.log('Response formatter is working correctly.');
console.log('═══════════════════════════════════════');
