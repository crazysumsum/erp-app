// The mandatory developer suite always executes the full index population.
// The pilot invokes indexCapacity.js directly and cannot satisfy this suite.
process.env.INDEX_CAPACITY_ROWS="25000000";
await import("./indexCapacity.js");
