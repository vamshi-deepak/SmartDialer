import { app, seedDemo, logger } from "./app.js";
import { connectMongo } from "./persistence.js";
import { store } from "./runtime.js";

const port = Number(process.env.PORT ?? 3001);
if (process.env.MONGODB_URI) {
  try {
    await connectMongo(process.env.MONGODB_URI);
    logger.info("MongoDB audit persistence connected; in-memory store remains authoritative for this prototype");
  } catch (error) {
    logger.error({ err: error }, "MongoDB connection failed; refusing to start with persistence configured");
    process.exit(1);
  }
}
const demo = seedDemo();
const server = app.listen(port, () => logger.info({ port, campaignId: demo.id }, "SmartDialer API listening"));
process.on("SIGINT", () => server.close(() => process.exit(0)));
process.on("SIGTERM", () => server.close(() => process.exit(0)));