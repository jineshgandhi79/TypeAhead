const crypto = require('crypto');

class ConsistentHashRing {
  /**
   * @param {string[]} nodes Physical node identifiers (e.g. ['redis-1:6379', 'redis-2:6379'])
   * @param {number} replicaCount Number of virtual nodes per physical node
   */
  constructor(nodes, replicaCount = 100) {
    this.nodes = nodes;
    this.replicaCount = replicaCount;
    this.ring = {}; // Map of hash -> physical node
    this.sortedKeys = []; // Sorted array of virtual node hashes

    this._buildRing();
  }

  /**
   * Generates a 32-bit unsigned integer hash for a string key using MD5
   * @param {string} key 
   * @returns {number}
   */
  _hash(key) {
    const hash = crypto.createHash('md5').update(key).digest();
    // Read the first 4 bytes as a 32-bit unsigned integer
    return hash.readUInt32BE(0);
  }

  /**
   * Builds the ring with virtual nodes
   */
  _buildRing() {
    this.ring = {};
    const keys = [];

    for (const node of this.nodes) {
      for (let i = 0; i < this.replicaCount; i++) {
        // e.g. "redis-1:6379#0", "redis-1:6379#1"
        const replicaKey = `${node}#${i}`;
        const hash = this._hash(replicaKey);
        this.ring[hash] = node;
        keys.push(hash);
      }
    }

    // Sort hashes ascending
    keys.sort((a, b) => a - b);
    this.sortedKeys = keys;
  }

  /**
   * Gets the physical node responsible for the given key
   * @param {string} key 
   * @returns {string|null}
   */
  getNode(key) {
    if (this.sortedKeys.length === 0) {
      return null;
    }

    const hash = this._hash(key);
    
    // Binary search to find the first virtual node hash >= key's hash
    let low = 0;
    let high = this.sortedKeys.length - 1;
    let index = 0;

    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      if (this.sortedKeys[mid] >= hash) {
        index = mid;
        high = mid - 1; // Look for a closer/smaller hash that is still >= hash
      } else {
        low = mid + 1;
      }
    }

    // Wrap around if the key's hash is larger than all virtual nodes
    if (this.sortedKeys[index] < hash) {
      index = 0;
    }

    const nodeHash = this.sortedKeys[index];
    return this.ring[nodeHash];
  }

  /**
   * Returns details of virtual node positions for debugging/visualization
   * @returns {Array<{hash: number, node: string}>}
   */
  getRingDistribution() {
    return this.sortedKeys.map(hash => ({
      hash,
      node: this.ring[hash]
    }));
  }
}

module.exports = ConsistentHashRing;
