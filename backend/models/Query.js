const mongoose = require('mongoose');

const QuerySchema = new mongoose.Schema({
  query: {
    type: String,
    required: true,
  },
  query_lowercase: {
    type: String,
    required: true,
    unique: true,
    index: true,
  },
  count: {
    type: Number,
    required: true,
    default: 0,
    index: true,
  }
});

// Compound index for fast, index-covered prefix matching and sorting
QuerySchema.index({ query_lowercase: 1, count: -1 });

module.exports = mongoose.model('Query', QuerySchema);

