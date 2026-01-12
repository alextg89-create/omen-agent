/**
 * TEST CHAT INTELLIGENCE LAYER
 * Verify the insight-driven responses work
 */

import { generateInsightResponse } from './src/utils/chatIntelligence.js';

console.log('🔍 TESTING CHAT INTELLIGENCE LAYER\n');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

// Mock data structure (matching what OMEN generates)
const recommendations = {
  promotions: [
    {
      name: 'Bloopiez (28 G)',
      reason: 'High velocity product moving 0.86 units/day with healthy margin',
      confidence: 0.8,
      triggeringMetrics: {
        margin: 60.0,
        quantity: 28,
        velocity: 0.86
      }
    },
    {
      name: 'Tangerine Cookies (28 G)',
      reason: 'Steady seller with good margin',
      confidence: 0.6,
      triggeringMetrics: {
        margin: 60.1,
        quantity: 4,
        velocity: 0.07
      }
    }
  ],
  inventory: [
    {
      name: 'Blue Nerdz (14 G)',
      action: 'REORDER_SOON',
      triggeringMetrics: {
        margin: 60.2,
        quantity: 2
      }
    }
  ]
};

const metrics = {
  averageMargin: 60.19,
  highestMarginItem: {
    name: 'Bloopiez (28 G)',
    margin: 61.1
  },
  lowestMarginItem: {
    name: 'Some Product (1 G)',
    margin: 58.5
  },
  itemsWithPricing: 195
};

// Test questions
const questions = [
  "What's my highest margin product?",
  "What should I promote this week?",
  "Show me low stock items",
  "What are my margins?"
];

console.log('📝 Testing insight responses:\n');

questions.forEach((question, i) => {
  console.log(`${i + 1}. Question: "${question}"`);
  const response = generateInsightResponse(question, recommendations, metrics);

  if (response) {
    console.log(`   ✓ Intelligence layer responded:`);
    console.log(`   "${response.substring(0, 200)}${response.length > 200 ? '...' : ''}"`);
  } else {
    console.log(`   ⚠️  No intelligence match - would use LLM`);
  }
  console.log('');
});

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('✅ CHAT INTELLIGENCE LAYER TEST COMPLETE');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
