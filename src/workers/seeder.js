// src/workers/seeder.js
const { PrismaClient } = require('@prisma/client');
const axios = require('axios');

const prisma = new PrismaClient();

// --- CONFIGURATION ---
const CONFIG = {
  BATCH_SIZE: 10,          // How many markets to fetch?
  MAX_HISTORY_DAYS: 180,   // Safety cap: Don't fetch more than 6 months of data
  RATE_LIMIT_DELAY: 1000,  // 1 second delay between CLOB calls
  GAMMA_API: "https://gamma-api.polymarket.com",
  CLOB_API: "https://clob.polymarket.com"
};

/**
 * 1. MAIN MARKET FETCH
 * Fetches the top X active markets by volume from Gamma.
 */
async function fetchMarketsFromGamma() {
  try {
    const url = `${CONFIG.GAMMA_API}/events?limit=${CONFIG.BATCH_SIZE}&active=true&closed=false&order=volume&ascending=false`;
    console.log(`📡 Fetching top ${CONFIG.BATCH_SIZE} markets from Gamma...`);
    
    const response = await axios.get(url);
    return response.data; // Returns array of Events
  } catch (error) {
    console.error("❌ Error fetching markets from Gamma:", error.message);
    return [];
  }
}

/**
 * 2. PRICE HISTORY HELPER
 * Fetches hourly price candles from a specific start date.
 * Handles the "ISO String -> Unix Timestamp" conversion automatically.
 */
async function fetchPriceHistory(tokenId, marketStartDate) {
  try {
    const now = Math.floor(Date.now() / 1000);
    
    // LOGIC: Determine the start timestamp
    // If marketStartDate is provided, use it. Otherwise default to 30 days ago.
    let startTs;
    if (marketStartDate) {
      startTs = Math.floor(new Date(marketStartDate).getTime() / 1000);
    } else {
      startTs = now - (30 * 24 * 60 * 60);
    }

    // SAFETY CAP: If start date is too old (e.g. 2 years ago), clip it.
    const safeLimitTs = now - (CONFIG.MAX_HISTORY_DAYS * 24 * 60 * 60);
    if (startTs < safeLimitTs) {
      console.log(`   ⚠️ Market is old. Capping history to ${CONFIG.MAX_HISTORY_DAYS} days.`);
      startTs = safeLimitTs;
    }

    // Call CLOB API
    const url = `${CONFIG.CLOB_API}/prices-history?market=${tokenId}&startTs=${startTs}&endTs=${now}&fidelity=60`;
    const response = await axios.get(url);
    
    return response.data.history || [];
  } catch (error) {
    console.error(`   ⚠️ Failed to fetch history for ${tokenId}:`, error.message);
    return [];
  }
}

/**
 * MAIN ORCHESTRATOR
 * Connects the two functions above.
 */
async function runSeeder() {
  console.log("🌱 Starting Seeder Process...");
  
  // Step A: Get the Markets
  const events = await fetchMarketsFromGamma();
  console.log(`🔎 Found ${events.length} events. Processing...`);

  for (const event of events) {
    const market = event.markets[0]; 
    const outcomeTokenId = market.clobTokenIds[0];
    
    console.log(`\nProcessing: "${market.question}"`);

    // Step B: Upsert Market Details
    await prisma.market.upsert({
      where: { id: outcomeTokenId },
      update: { active: true },
      create: {
        id: outcomeTokenId,
        question: market.question,
        slug: event.slug,
        image: event.image,
        active: true
      }
    });

    // Step C: Fetch History (Using Dynamic Start Date)
    // We try to use 'createdAt' first, then 'startDate'
    const marketStart = market.createdAt || event.startDate;
    const history = await fetchPriceHistory(outcomeTokenId, marketStart);

    // Step D: Save History
    if (history.length > 0) {
      console.log(`   📉 Saving ${history.length} candles...`);
      
      const priceData = history.map(point => ({
        marketId: outcomeTokenId,
        price: point.p,
        timestamp: point.t
      }));

      await prisma.priceHistory.createMany({
        data: priceData,
        skipDuplicates: true
      });
    }

    // Step E: Respect Rate Limits
    await new Promise(r => setTimeout(r, CONFIG.RATE_LIMIT_DELAY));
  }

  console.log("\n✅ Seeding Complete!");
}

// Run it
runSeeder()
  .catch(e => console.error(e))
  .finally(async () => {
    await prisma.$disconnect();
  });