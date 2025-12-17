const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;

if(!SUPABASE_SERVICE_ROLE_KEY){
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is not defined');
}

if(!SUPABASE_URL){
    throw new Error('SUPABASE_URL is not defined');
}

console.log('SUPABASE_SERVICE_ROLE_KEY:', SUPABASE_SERVICE_ROLE_KEY);
console.log('SUPABASE_URL:', SUPABASE_URL);


// Initialize Client
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// Just a regular function (No ': WhaleAlert' type annotation)
async function saveWhaleAlert(alert) { 
  try {
    const { data, error } = await supabase
      .from('whale_alerts')
      .insert([
        {
          transaction_hash: alert.transaction_hash,
          market_question: alert.market_question,
          market_slug: alert.market_slug,
          outcome_label: alert.outcome_label,
          amount_usd: alert.amount_usd,
          token_price: alert.token_price,
          price_impact_percent: alert.price_impact_percent,
          sender_address: alert.sender_address,
          market_image: alert.market_image,
          liquidity: alert.liquidity,
        }
      ])
      .select();

    if (error) {
        if (error.code === '23505') {
            console.log(`⚠️ Skipped duplicate: ${alert.transaction_hash.slice(0, 6)}...`);
            return false;
        }
        console.error("❌ Supabase Insert Error:", error.message);
        return false;
    }

    console.log(`✅ Saved to DB: ${alert.market_question.slice(0, 30)}...`);
    return true;

  } catch (err) {
    console.error("❌ Unexpected DB Error:", err);
    return false;
  }
}

module.exports = { saveWhaleAlert };