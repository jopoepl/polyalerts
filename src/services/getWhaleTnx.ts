require('dotenv').config();
const { ethers } = require("ethers");
const axios = require("axios");
const WebSocket = require("ws");
const { saveWhaleAlert } = require('./supabase'); // Adjust path as needed'

const POLYGON_RPC_WSS_URL=process.env.POLYGON_RPC_WSS_URL;

console.log('POLYGON_RPC_WSS_URL:', POLYGON_RPC_WSS_URL);





if(!POLYGON_RPC_WSS_URL){
    throw new Error('POLYGON_RPC_WSS_URL is not defined');
}



// --- CONFIGURATION ---
const WHALE_THRESHOLD = 1000;

const CONTRACTS = [
    "0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E", // Binary
    "0xC5d563A36AE78145C45a50134d48A1215220f80a"  // NegRisk
];

const ABI = [
  "event OrderFilled(bytes32 indexed orderHash, address indexed maker, address indexed taker, uint256 makerAssetId, uint256 takerAssetId, uint256 makerAmountFilled, uint256 takerAmountFilled, uint256 feePaid)"
];

const priceCache = new Map();
const marketCache = new Map();

// --- HELPER 1: PRE-LOAD PRICES ---
async function preLoadPrices() {
    console.log("⏳ Pre-loading prices...");
    try {
        const { data } = await axios.get("https://gamma-api.polymarket.com/markets?limit=100&active=true&closed=false&order=volume");
        data.forEach(m => {
             if (m.clobTokenIds && m.outcomePrices) {
                const ids = JSON.parse(m.clobTokenIds);
                const prices = JSON.parse(m.outcomePrices);
                ids.forEach((id, idx) => priceCache.set(id.toString(), Number(prices[idx])));
             }
        });
        console.log(`✅ Cached ${priceCache.size} prices.`);
    } catch (e) { console.log("⚠️ Pre-load skipped."); }
}

// --- HELPER 2: GET DETAILED MARKET METADATA ---
async function getMarketDetails(tokenId) {
    if (marketCache.has(tokenId)) return marketCache.get(tokenId);
    
    try {
        const { data } = await axios.get(`https://gamma-api.polymarket.com/markets?clob_token_ids=${tokenId}`);
        if (data.length > 0) {
            const m = data[0];
            const ids = JSON.parse(m.clobTokenIds);
            const idx = ids.findIndex(id => id.toString() === tokenId.toString());
            
            // 1. Get the Raw Label (e.g., "50+ bps decrease" or "Yes")
            let rawLabel = idx !== -1 ? JSON.parse(m.outcomes)[idx] : "Unknown";

            // 2. FORCE THE [YES] / [NO] TAG BASED ON INDEX
            // Index 0 = YES, Index 1 = NO
            const side = idx === 0 ? "[YES]" : "[NO]";
            
            // 3. Construct the Full Name
            // Result: "50+ bps decrease [YES]" or "Michelle Obama [YES]"
            let fullName = `${rawLabel} ${side}`;
            
            if (m.groupItemTitle && m.groupItemTitle !== rawLabel) {
                // For Group markets (e.g. Elections)
                fullName = `${m.groupItemTitle} ${side}`; 
            }

            const res = { 
                question: m.question, 
                outcome: fullName,            
                slug: m.slug,                 
                liquidity: m.liquidity,       
                image: m.icon || m.image,     
                outcomePrices: JSON.parse(m.outcomePrices) 
            };
            
            marketCache.set(tokenId, res);
            return res;
        }
    } catch (e) { return null; }
    return null;
}

// --- MAIN LISTENER ---
async function startListener() {
    await preLoadPrices();

    console.log(`\n🐋 Whale Watcher Running...`);
    console.log(`   - Mode: WebSocket (Streaming)`);
    console.log(`   - Threshold: $${WHALE_THRESHOLD}`);

    let provider;
    let ws;

    function connect() {
        ws = new WebSocket(POLYGON_RPC_WSS_URL);

        ws.on("open", () => { console.log("✅ WebSocket Connected!"); });
        ws.on("close", (code) => { 
            console.log(`⚠️ WebSocket Closed (${code}). Reconnecting...`);
            setTimeout(connect, 3000); 
        });
        ws.on("error", (err) => {
            console.error("❌ WebSocket Error:", err.message);
            ws.terminate();
        });

        provider = new ethers.WebSocketProvider(ws);
        const iface = new ethers.Interface(ABI);
        const filter = { topics: [ethers.id("OrderFilled(bytes32,address,address,uint256,uint256,uint256,uint256,uint256)")] };

        provider.on(filter, async (log) => {
            try {
                if (!CONTRACTS.includes(log.address)) return;
                const parsed = iface.parseLog(log);
                if (!parsed || parsed.args.taker !== log.address) return;

                const { makerAssetId, takerAssetId, makerAmountFilled, takerAmountFilled } = parsed.args;
                let usdcValue = 0, tokenAmount = 0, tokenId = "", action = "";

                // --- LOGIC FIX: BUY/SELL INVERSION FOR SUMMARY EVENTS ---
                if (makerAssetId.toString() === "0") { 
                    // Maker (Whale) GAVE USDC -> BUYING Token
                    usdcValue = Number(makerAmountFilled) / 1e6;
                    tokenAmount = Number(takerAmountFilled) / 1e6;
                    tokenId = takerAssetId.toString();
                    action = "BUY 🟢"; 
                } 
                else if (takerAssetId.toString() === "0") { 
                    // Taker (Exchange) GAVE USDC -> SELLING Token
                    usdcValue = Number(takerAmountFilled) / 1e6;
                    tokenAmount = Number(makerAmountFilled) / 1e6;
                    tokenId = makerAssetId.toString();
                    action = "SELL 🔴"; 
                } 
                else return; // Ignore non-USDC trades

                // --- CALCULATIONS ---
                const executionPrice = usdcValue / tokenAmount;
                const prevPrice = priceCache.get(tokenId) || executionPrice;
                const percentChange = ((executionPrice - prevPrice) / prevPrice) * 100;
                
                priceCache.set(tokenId, executionPrice);

                if (usdcValue < WHALE_THRESHOLD) return;

                // --- DATA FETCHING ---
                const details = await getMarketDetails(tokenId);
                const whaleAddress = '0x' + log.topics[2].slice(26);
                if (!details) return;
                const senderAddress = '0x' + log.topics[2].slice(26);
               
                const priceInCents = executionPrice * 100; // <--- FIX: Convert $0.99 to 99¢
                                const prevPriceInCents = prevPrice * 100;
                
                                console.log(`\n🚨 WHALE DETECTED! [${new Date().toLocaleTimeString()}]`);
                                console.log(`-----------------------------------------------`);
                                console.log(`❓ Market:    ${details.question}`);
                                console.log(`🔗 Slug:      ${details.slug}`);
                                console.log(`💧 Liquidity: $${Number(details.liquidity).toLocaleString()}`);
                                console.log(`🎯 Outcome:   ${details.outcome}`); // Now shows "(No)"
                                console.log(`💰 Trade:     $${usdcValue.toFixed(0)} ${action}`);
                                console.log(`📉 Impact:    ${prevPriceInCents.toFixed(1)}¢ ➔ ${priceInCents.toFixed(1)}¢`); // Now shows correct cents
                                console.log(`🏠 Address:   ${whaleAddress}`);

                                
                                if (Math.abs(percentChange) > 1.5) {
                                    console.log(`🌊 MOVE:      ${percentChange > 0 ? "+" : ""}${percentChange.toFixed(2)}% (Big Fluctuation!)`);
                                } else {
                                    console.log(`〰️ Move:      ${percentChange > 0 ? "+" : ""}${percentChange.toFixed(2)}%`);
                                }
                                console.log(`🔗 Tx:        https://polygonscan.com/tx/${log.transactionHash}`);
                                
                                const alertData = {
                                    transaction_hash: log.transactionHash,
                                    market_question: details.question,
                                    market_slug: details.slug,
                                    outcome_label: details.outcome,
                                    amount_usd: usdcValue,
                                    token_price: executionPrice, // Raw price (e.g. 0.99)
                                    price_impact_percent: percentChange,
                                    market_image: details.image,
                                    liquidity: Number(details.liquidity),
                                    sender_address: senderAddress,
                                };
                                
                                saveWhaleAlert(alertData);


                // TODO: Insert into Supabase here using 'details' object
            } catch (err) {
                console.error("Processing Error:", err.message);
            }
        });
    }

    connect();
}





startListener();