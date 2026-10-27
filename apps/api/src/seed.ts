import { seedDemo } from "./runtime.js";

const campaign = seedDemo();
console.log(JSON.stringify({ campaignId: campaign.id, name: campaign.name }, null, 2));