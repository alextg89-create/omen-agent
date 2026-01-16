/**
 * Verify daily vs weekly queries against orders_agg
 */
import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function verify() {
  // Daily: last 24 hours
  const dailyEnd = new Date();
  const dailyStart = new Date();
  dailyStart.setDate(dailyStart.getDate() - 1);

  // Weekly: last 7 days
  const weeklyEnd = new Date();
  const weeklyStart = new Date();
  weeklyStart.setDate(weeklyStart.getDate() - 7);

  console.log('=== DAILY (last 24h) ===');
  console.log('Range:', dailyStart.toISOString(), 'to', dailyEnd.toISOString());
  const { data: daily } = await supabase
    .from('orders_agg')
    .select('order_id, created_at, item_count, total_revenue, total_profit')
    .gte('created_at', dailyStart.toISOString())
    .lte('created_at', dailyEnd.toISOString());

  const dailyRevenue = (daily || []).reduce((s, o) => s + o.total_revenue, 0);
  const dailyProfit = (daily || []).reduce((s, o) => s + o.total_profit, 0);
  console.log('Orders:', daily?.length || 0);
  console.log('Revenue: $' + dailyRevenue.toFixed(2));
  console.log('Profit: $' + dailyProfit.toFixed(2));

  console.log('');
  console.log('=== WEEKLY (last 7d) ===');
  console.log('Range:', weeklyStart.toISOString(), 'to', weeklyEnd.toISOString());
  const { data: weekly } = await supabase
    .from('orders_agg')
    .select('order_id, created_at, item_count, total_revenue, total_profit')
    .gte('created_at', weeklyStart.toISOString())
    .lte('created_at', weeklyEnd.toISOString());

  const weeklyRevenue = (weekly || []).reduce((s, o) => s + o.total_revenue, 0);
  const weeklyProfit = (weekly || []).reduce((s, o) => s + o.total_profit, 0);
  console.log('Orders:', weekly?.length || 0);
  console.log('Revenue: $' + weeklyRevenue.toFixed(2));
  console.log('Profit: $' + weeklyProfit.toFixed(2));

  console.log('');
  console.log('=== VERIFICATION ===');
  const dailyCount = daily?.length || 0;
  const weeklyCount = weekly?.length || 0;
  console.log('Daily orders:', dailyCount);
  console.log('Weekly orders:', weeklyCount);

  if (dailyCount === weeklyCount && weeklyCount > 0) {
    console.log('Note: Same count - all orders may be within last 24h');
  } else if (weeklyCount > dailyCount) {
    console.log('PASS: Weekly has more orders than daily');
  } else {
    console.log('Note: No orders yet or data issue');
  }
}

verify().catch(console.error);
