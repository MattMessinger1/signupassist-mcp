import "dotenv/config";
import { lookupLocalProvider, googlePlacesSearch } from "../mcp_server/utils/providerSearch";

(async () => {
  try {
    console.log("🧪 Testing Hybrid Provider Search with Caching...\n");

    // Test 1: Local provider lookup
    console.log("1️⃣ Testing local provider lookup:");
    const localResult = await lookupLocalProvider("Blackhawk Ski Club");
    console.log("Local lookup result:", localResult);

    // Test 2: Google Places API (first call - should hit API)
    console.log("\n2️⃣ Testing Google Places API (first call):");
    const googleResult1 = await googlePlacesSearch("YMCA", "Madison WI");
    console.log("Google API result (first call):", googleResult1);

    // Test 3: Google Places API (second call - should use cache)
    console.log("\n3️⃣ Testing Google Places API (second call - should be cached):");
    const googleResult2 = await googlePlacesSearch("YMCA", "Madison WI");
    console.log("Google API result (second call):", googleResult2);

    console.log("\n✅ Hybrid search test completed successfully.");
    console.log("\n📝 Check logs above for:");
    console.log("   - First Google query → '🌍 Falling back to Google Places API...'");
    console.log("   - Local match → '✅ Found provider locally'");
  } catch (error: any) {
    console.error("❌ Hybrid search test failed:", error.message);
  }
})();
