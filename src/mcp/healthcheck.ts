/**
 * MCP Backend Health Check
 * 
 * Verifies that the frontend is connected to the correct production MCP backend.
 * This runs on app startup to catch configuration issues early.
 */

export async function verifyMCPConnection() {
  const url = import.meta.env.VITE_MCP_BASE_URL;
  
  if (!url) {
    console.error("🚨 VITE_MCP_BASE_URL is not configured");
    return;
  }

  try {
    const res = await fetch(`${url}/health`, { 
      method: "GET",
      // Add a timeout to fail fast
      signal: AbortSignal.timeout(5000)
    });
    
    if (res.status !== 200) {
      throw new Error(`Unexpected status ${res.status}`);
    }
    
    console.log("✅ MCP backend connected:", url);
  } catch (err) {
    console.error("🚨 MCP backend unreachable:", err);
    
    // Show alert in development only to avoid disrupting production users
    if (import.meta.env.DEV) {
      alert("🚨 MCP backend unreachable at " + url + "\n\nCheck console for details.");
    }
  }
}
