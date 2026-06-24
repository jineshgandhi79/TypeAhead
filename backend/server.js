const express = require('express');
const mongoose = require('mongoose');
const redis = require('redis');
const cors = require('cors');
const dotenv = require('dotenv');
const ConsistentHashRing = require('./consistentHash');
const Query = require('./models/Query');
const preload = require('./preload');

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 5000;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/typeahead';

// Parse Redis Nodes
const redisNodesEnv = process.env.REDIS_NODES || '127.0.0.1:6379,127.0.0.1:6380,127.0.0.1:6381';
const redisNodes = redisNodesEnv.split(',').map(n => n.trim());

// Global System Variables
const SERVER_START_TIME = Date.now();

// Metrics
let totalSuggestRequests = 0;
let totalSuggestCacheHits = 0;
let totalSuggestCacheMisses = 0;
let rawSearchWrites = 0;
let dbSearchWrites = 0;

// Batch Write Buffer
const batchBuffer = new Map(); // query -> { count: number }
const BATCH_SIZE = parseInt(process.env.BATCH_SIZE || '100', 10);
const BATCH_FLUSH_INTERVAL = parseInt(process.env.BATCH_FLUSH_INTERVAL || '5000', 10);
let isFlushing = false;

// Consistent Hash Ring and Connections
let ring;
const redisClients = {};

// Helper to escape regex special characters
function escapeRegex(text) {
  return text.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&");
}

/**
 * Connect to databases, preload dataset, and establish Redis clients
 */
async function initializeDatabases() {
  try {
    // 1. Connect MongoDB
    console.log('Connecting to MongoDB...');
    await mongoose.connect(MONGO_URI);
    console.log('Connected to MongoDB.');

    // 2. Preload Data if empty
    await preload();

    // 3. Connect Redis Clients
    console.log('Connecting to Redis nodes...');
    for (const node of redisNodes) {
      // Connect to redis://host:port
      const url = node.startsWith('redis://') ? node : `redis://${node}`;
      const client = redis.createClient({ url });
      client.on('error', (err) => console.error(`Redis node [${node}] error:`, err));
      await client.connect();
      redisClients[node] = client;
      console.log(`Connected to Redis node: ${node}`);
    }

    // 4. Build Consistent Hash Ring
    ring = new ConsistentHashRing(redisNodes);
    console.log('Consistent Hash Ring built successfully.');
  } catch (error) {
    console.error('Initialization failed:', error);
    process.exit(1);
  }
}

/**
 * Flush search buffer updates to MongoDB in bulk
 */
async function flushBatch() {
  if (isFlushing || batchBuffer.size === 0) return;
  isFlushing = true;

  const bufferCopy = new Map(batchBuffer);
  batchBuffer.clear();

  console.log(`Flushing batch of ${bufferCopy.size} unique queries to MongoDB...`);
  const operations = [];

  for (const [key, data] of bufferCopy.entries()) {
    operations.push({
      updateOne: {
        filter: { query_lowercase: key },
        update: {
          $inc: { count: data.count },
          $setOnInsert: { query: data.originalQuery }
        },
        upsert: true
      }
    });
  }

  try {
    const result = await Query.bulkWrite(operations);
    dbSearchWrites += operations.length;
    console.log(`Bulk update successful. Upserted/Updated: ${result.upsertedCount + result.modifiedCount} records.`);

    // Invalidate affected cache prefixes
    console.log(`Invalidating cache for affected query prefixes...`);
    for (const q of bufferCopy.keys()) {
      const lowercase = q.toLowerCase();
      // Invalidate keys for all prefix lengths up to 10 characters
      for (let len = 1; len <= Math.min(lowercase.length, 10); len++) {
        const prefix = lowercase.substring(0, len);
        const cacheKey = prefix;

        const cacheNode = ring.getNode(cacheKey);

        if (cacheNode && redisClients[cacheNode]) {
          await redisClients[cacheNode].del(cacheKey).catch(() => {});
        }
      }

      // Also invalidate empty prefix (trending searches) cache
      const trendingKey = '__trending__';
      const nodeTrend = ring.getNode(trendingKey);

      if (nodeTrend && redisClients[nodeTrend]) {
        await redisClients[nodeTrend].del(trendingKey).catch(() => {});
      }
    }
  } catch (err) {
    console.error('Error during batch flush:', err);
    // Re-buffer the lost items if needed, or simply log the failure.
    // For simplicity, we log, keeping in mind the failure trade-offs.
  } finally {
    isFlushing = false;
  }
}

// Set periodic flush timer
setInterval(flushBatch, BATCH_FLUSH_INTERVAL);

/**
 * Helper to fetch top suggestions from DB
 * Uses index scan and Node.js-based combined score calculation for speed.
 */
async function getSuggestionsFromDB(prefix) {
  // Define search filter
  const filter = prefix 
    ? { query_lowercase: { $regex: '^' + escapeRegex(prefix) } } 
    : {};

  // Sort strictly by overall count DESC
  // Index-covered for prefix queries: { query_lowercase: 1, count: -1 }
  const results = await Query.find(filter)
    .sort({ count: -1 })
    .limit(10)
    .lean();

  return results.map(r => ({
    query: r.query,
    count: r.count
  }));
}

/* ==========================================================================
   APIs
   ========================================================================== */

/**
 * GET /suggest?q=<prefix>&mode=<basic|enhanced>
 * Returns up to 10 prefix-matching suggestions.
 */
app.get('/suggest', async (req, res) => {
  totalSuggestRequests++;
  const prefix = (req.query.q || '').trim().toLowerCase();

  // Define cache key
  const cacheKey = prefix ? prefix : '__trending__';

  try {
    // 1. Determine cache node
    const node = ring.getNode(cacheKey);
    if (!node || !redisClients[node]) {
      // No cache ring available, fallback directly to DB
      totalSuggestCacheMisses++;
      const suggestions = await getSuggestionsFromDB(prefix);
      return res.json(suggestions);
    }

    // 2. Fetch from Cache
    const cachedData = await redisClients[node].get(cacheKey);
    if (cachedData) {
      totalSuggestCacheHits++;
      return res.json(JSON.parse(cachedData));
    }

    // 3. Cache Miss - Query DB
    totalSuggestCacheMisses++;
    const suggestions = await getSuggestionsFromDB(prefix);

    // 4. Store in Cache with TTL of 60 seconds (1 minute freshness)
    await redisClients[node].set(cacheKey, JSON.stringify(suggestions), {
      EX: 60
    });

    return res.json(suggestions);
  } catch (error) {
    console.error('Suggest API Error:', error);
    // Graceful recovery: return empty suggestions or query DB if possible
    try {
      const suggestions = await getSuggestionsFromDB(prefix);
      return res.json(suggestions);
    } catch (e) {
      return res.status(500).json({ error: 'Failed to retrieve suggestions' });
    }
  }
});

/**
 * POST /search
 * Submits a query search (buffers it in the batch writer).
 */
app.post('/search', async (req, res) => {
  const { query } = req.body;
  if (!query || typeof query !== 'string' || !query.trim()) {
    return res.status(400).json({ error: 'Query must be a non-empty string.' });
  }

  const q = query.trim();
  const key = q.toLowerCase();
  rawSearchWrites++;

  // Add to buffer
  let bufferItem = batchBuffer.get(key);
  if (!bufferItem) {
    bufferItem = { count: 0, originalQuery: q };
    batchBuffer.set(key, bufferItem);
  }

  bufferItem.count += 1;

  // Calculate total currently buffered clicks
  let totalBufferedCount = 0;
  for (const item of batchBuffer.values()) {
    totalBufferedCount += item.count;
  }

  // Trigger flush immediately if buffer reaches limit
  if (totalBufferedCount >= BATCH_SIZE) {
    console.log(`Buffer limit (${BATCH_SIZE}) reached. Flushing immediately.`);
    flushBatch().catch(err => console.error("Immediate flush error:", err));
  }

  // Return standard dummy response
  return res.json({ message: "Searched" });
});

/**
 * GET /cache/debug?prefix=<prefix>
 * Debug cache routing: shows node assignment and hit/miss status.
 */
app.get('/cache/debug', async (req, res) => {
  const prefix = (req.query.prefix || '').trim().toLowerCase();
  const cacheKey = prefix ? prefix : '__trending__';

  try {
    const assignedNode = ring.getNode(cacheKey);
    let hit = false;

    if (assignedNode && redisClients[assignedNode]) {
      const val = await redisClients[assignedNode].exists(cacheKey);
      hit = (val === 1);
    }

    return res.json({
      prefix,
      cacheKey,
      assignedNode,
      status: hit ? 'HIT' : 'MISS',
      ringNodes: redisNodes,
      replicaCount: ring.replicaCount
    });
  } catch (error) {
    console.error('Debug API Error:', error);
    return res.status(500).json({ error: error.message });
  }
});

/**
 * GET /metrics
 * Fetch system performance data
 */
app.get('/metrics', (req, res) => {
  const cacheHitRate = totalSuggestRequests > 0
    ? ((totalSuggestCacheHits / totalSuggestRequests) * 100).toFixed(2) + '%'
    : '0.00%';

  const writeReduction = rawSearchWrites > 0
    ? ((1 - (dbSearchWrites / rawSearchWrites)) * 100).toFixed(2) + '%'
    : '0.00%';

  // Count size of current buffer
  let totalBufferedCount = 0;
  for (const item of batchBuffer.values()) {
    totalBufferedCount += item.count;
  }

  res.json({
    totalSuggestRequests,
    totalSuggestCacheHits,
    totalSuggestCacheMisses,
    cacheHitRate,
    rawSearchWrites,
    dbSearchWrites,
    writeReduction,
    bufferSize: batchBuffer.size,
    bufferedSearchIncrements: totalBufferedCount,
    uptimeSeconds: Math.floor((Date.now() - SERVER_START_TIME) / 1000)
  });
});

/* ==========================================================================
   Startup
   ========================================================================== */

initializeDatabases().then(() => {
  app.listen(PORT, () => {
    console.log(`Backend server is running on port ${PORT}`);
  });
});
