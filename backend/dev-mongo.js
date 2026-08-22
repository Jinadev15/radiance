// Local dev convenience: runs an embedded MongoDB on the standard port (27017)
// so `mongodb://localhost:27017/radiance` behaves like a real local install —
// data persists for as long as this process stays running, and every other
// script/service in this repo (backend, create-admin.js) can connect to it
// normally without knowing it's in-memory. Not for production use.
const { MongoMemoryServer } = require('mongodb-memory-server');

async function main() {
  const mongod = await MongoMemoryServer.create({
    instance: { port: 27017, dbName: 'radiance' },
  });
  console.log(`Dev MongoDB running at ${mongod.getUri()}`);
  process.on('SIGINT', async () => { await mongod.stop(); process.exit(0); });
}

main().catch(err => {
  console.error('Failed to start dev MongoDB:', err.message);
  process.exit(1);
});
