import "dotenv/config";
import { googlePlacesSearch } from "../mcp_server/utils/providerSearch";

(async () => {
  try {
    console.log("🧪 Testing Google Places API...");

    const examples = [
      { name: "YMCA Madison" },
      { name: "Blackhawk Ski Club", location: "Middleton WI" },
      { name: "Boys and Girls Club", location: "Madison WI" },
    ];

    for (const { name, location } of examples) {
      console.log(`\n🔍 Searching for: ${name}${location ? " (" + location + ")" : ""}`);
      const results = await googlePlacesSearch(name, location);
      console.log("Results:", results);
    }

    console.log("\n✅ Google API test completed successfully.");
  } catch (error: any) {
    console.error("❌ Google API test failed:", error.message);
  }
})();
