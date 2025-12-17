// this file interacts with the polymarket API, and handles all the logic related to it
// functions to add :
// getMarkets - https://gamma-api.polymarket.com/markets
// getEvents - https://gamma-api.polymarket.com/events
// getMarketById - https://gamma-api.polymarket.com/markets/{id}
// getMarketBySlug - https://gamma-api.polymarket.com/markets/slug/{slug}
// getMarketsByCategory - 
// getPriceHistory - https://clob.polymarket.com/prices-history
// 
// 
// Categories to focus on - first set -[{tagid, slugname}] ====> [{1, sports},{2, politics}, {21, crypto}, {120, finance}, {100265, geopolitics}, {1401, tech}, {1597, global-elections},  ]



const axios = require('axios'); 

const marketOptions = {
  method: 'GET',
  url: 'https://gamma-api.polymarket.com/markets',
  params: {
    limit: 100,
    liquidity_num_min: 10000,
    start_date_min: '2025-01-01T00:00:00Z',
    ascending: false,
    active: true
  }
};

const priceHistoryOptions = {
  method: 'GET',
  url: 'https://clob.polymarket.com/prices-history',
  params: {
    limit: 100,
    liquidity_num_min: 10000,
    start_date_min: '2025-01-01T00:00:00Z',
    ascending: false,
    active: true
  }
};

async function getMarkets() {
  try {
    const response = await axios(marketOptions);
    return response.data; 
  } catch (error) {
    console.error("API Error:", error);
    return []; 
  }
}

async function transformMarkets() {
  const markets = await getMarkets();
  if (!markets || markets.length === 0) {
    console.log("No markets found.");
    return [];
  }

  return markets.map((market) => ({            
    question: market.question,        
    slug: market.slug,              
    image: market.image,             
    active: market.active,            
    description: market.description,
    outcomes: market.outcomes,
    clobTokenIds: market.clobTokenIds, 
    startDate: market.startDate, 
    endDate: market.endDate,
    featured: market.featured,
    liquidity: Number(market.liquidity), 
    volume: Number(market.volume),
    createdAt: market.createdAt,      
    updatedAt: market.updatedAt,        
  }));
}

transformMarkets()
  .then(data => {
    console.log("First Transformed Market:", data[0]);
    console.log("Total Markets:", data.length);
  })
  .catch(err => console.error(err));

const transformedMarkets = transformMarkets();

console.log(transformedMarkets, "Check transformed markets")




// Price History Section

const options = {method: 'GET'};

fetch('https://clob.polymarket.com/prices-history', options)
  .then(res => res.json())
  .then(res => console.log(res))
  .catch(err => console.error(err));