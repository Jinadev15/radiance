// Shared MongoDB Memory Server bootstrap for backend tests.
//
// Real mongoose models and real MongoDB semantics (unique indexes, atomic
// findOneAndUpdate, aggregation) matter for this app's bugs — the session
// numbering race and the unique-index change in particular are exactly the
// kind of thing an in-memory mock would fail to catch. mongodb-memory-server
// runs a real mongod binary, just an ephemeral one.
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-not-for-production-use-only';
process.env.NATIONAL_ID_HMAC_SECRET = process.env.NATIONAL_ID_HMAC_SECRET || 'test-national-id-hmac-secret-32chars!!';
process.env.APP_TIMEZONE = process.env.APP_TIMEZONE || 'Asia/Kolkata';

const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

let mongod = null;

async function start() {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
}

async function stop() {
  await mongoose.disconnect();
  if (mongod) await mongod.stop();
}

async function reset() {
  const collections = mongoose.connection.collections;
  for (const key of Object.keys(collections)) {
    await collections[key].deleteMany({});
  }
}

// Mongoose builds a model's indexes asynchronously in the background after
// the model is registered — `Model.create()` does not wait for that build to
// finish. A test that asserts a unique-index rejection right after requiring
// the model can run before the index actually exists in MongoDB, and would
// then wrongly see the "duplicate" write succeed. Call this with every model
// a test relies on unique/compound-index behaviour for.
async function ensureIndexes(...models) {
  await Promise.all(models.map(m => m.init()));
}

module.exports = { start, stop, reset, ensureIndexes, mongoose };
