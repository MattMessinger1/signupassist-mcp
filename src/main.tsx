import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { verifyMCPConnection } from "./mcp/healthcheck";

// Verify MCP backend connection on startup
verifyMCPConnection();

createRoot(document.getElementById("root")!).render(<App />);
