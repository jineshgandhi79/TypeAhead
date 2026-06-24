const fs = require('fs');
const path = require('path');
const readline = require('readline');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const Query = require('./models/Query');

dotenv.config();

const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/typeahead';
const PRELOAD_LIMIT = parseInt(process.env.PRELOAD_LIMIT || '150000', 10);

// Paths to check for the dataset
const DATASET_PATHS = [
  path.join(__dirname, 'dataset'),       // Mapped in Docker at /app/dataset
  path.join(__dirname, '..', 'dataset'), // Local running
];

async function preload() {
  const shouldManageConnection = mongoose.connection.readyState === 0;
  try {
    if (shouldManageConnection) {
      console.log('Connecting to MongoDB...');
      await mongoose.connect(MONGO_URI);
      console.log('Connected to MongoDB.');
    } else {
      console.log('Using existing MongoDB connection.');
    }

    // Drop database to ensure clean rebuild of unique indexes and data
    console.log('Dropping existing database for clean preload...');
    await mongoose.connection.db.dropDatabase();
    console.log('Database dropped.');

    // Prepopulate seen set to deduplicate preloaded queries case-insensitively
    const seen = new Set([
      'apple iphone 15',
      'chatgpt openai',
      'antigravity ai',
      'mern stack tutorial',
      'consistent hashing',
      'distributed cache system'
    ]);

    // Find the dataset file
    let datasetPath = null;
    for (const p of DATASET_PATHS) {
      if (fs.existsSync(p)) {
        datasetPath = p;
        break;
      }
    }

    if (!datasetPath) {
      console.error('Dataset file not found! Paths checked:');
      DATASET_PATHS.forEach(p => console.error(` - ${p}`));
      process.exit(1);
    }

    console.log(`Reading dataset from: ${datasetPath}`);
    console.log(`Preload limit: ${PRELOAD_LIMIT} queries.`);

    const fileStream = fs.createReadStream(datasetPath);
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity,
    });

    let linesProcessed = 0;
    let queriesInserted = 0;
    let isHeader = true;
    let batch = [];
    const BATCH_SIZE = 10000;
    const SAMPLE_STEP = 80; // Sample every 80th line to span the entire alphabet

    for await (const line of rl) {
      linesProcessed++;

      if (isHeader) {
        isHeader = false;
        continue;
      }

      if (linesProcessed % SAMPLE_STEP !== 0) {
        continue;
      }

      // Convert underscores to spaces, ignore all special characters, collapse spacing
      const cleaned = line.replace(/_/g, ' ').replace(/[^a-zA-Z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
      
      // Ensure the query starts with an English letter or number to skip leading symbols
      const startsWithAlphanumeric = /^[a-zA-Z0-9]/.test(cleaned);
      if (!cleaned || cleaned.length < 3 || !startsWithAlphanumeric) {
        continue;
      }

      const lowercaseCleaned = cleaned.toLowerCase();
      if (seen.has(lowercaseCleaned)) {
        continue;
      }
      seen.add(lowercaseCleaned);

      // Generate random count between 10 and 100,000
      const randomCount = Math.floor(Math.random() * (100000 - 10 + 1)) + 10;

      batch.push({
        query: cleaned,
        query_lowercase: lowercaseCleaned,
        count: randomCount,
      });

      if (batch.length >= BATCH_SIZE) {
        await Query.insertMany(batch, { ordered: false });
        queriesInserted += batch.length;
        console.log(`Inserted ${queriesInserted}/${PRELOAD_LIMIT} queries...`);
        batch = [];

        if (queriesInserted >= PRELOAD_LIMIT) {
          rl.close();
          break;
        }
      }
    }

    // Insert remaining items in the batch
    if (batch.length > 0 && queriesInserted < PRELOAD_LIMIT) {
      const remainingLimit = PRELOAD_LIMIT - queriesInserted;
      const sliceToInsert = batch.slice(0, remainingLimit);
      await Query.insertMany(sliceToInsert, { ordered: false });
      queriesInserted += sliceToInsert.length;
      console.log(`Inserted final batch. Total queries inserted: ${queriesInserted}`);
    }

    // Insert custom test queries to demonstrate basic vs. enhanced rankings
    console.log('Inserting custom test queries for demonstration...');
    const customQueries = [
      {
        query: 'Apple iPhone 15',
        query_lowercase: 'apple iphone 15',
        count: 85000,
      },
      {
        query: 'ChatGPT OpenAI',
        query_lowercase: 'chatgpt openai',
        count: 95000,
      },
      {
        query: 'Antigravity AI',
        query_lowercase: 'antigravity ai',
        count: 150, // Low overall count
      },
      {
        query: 'MERN Stack Tutorial',
        query_lowercase: 'mern stack tutorial',
        count: 80, // Low overall count
      },
      {
        query: 'Consistent Hashing',
        query_lowercase: 'consistent hashing',
        count: 12000,
      },
      {
        query: 'Distributed Cache System',
        query_lowercase: 'distributed cache system',
        count: 200,
      }
    ];

    for (const q of customQueries) {
      // Upsert so that we update if they already exist or insert if they don't
      await Query.updateOne(
        { query: q.query },
        { $set: q },
        { upsert: true }
      );
    }
    console.log('Custom test queries preloaded successfully.');

    console.log('Data preloading completed successfully!');
  } catch (error) {
    console.error('Error during data preloading:', error);
  } finally {
    if (shouldManageConnection) {
      await mongoose.connection.close();
      console.log('MongoDB connection closed.');
    }
  }
}

// Run preload if this script is executed directly
if (require.main === module) {
  preload();
}

module.exports = preload;
