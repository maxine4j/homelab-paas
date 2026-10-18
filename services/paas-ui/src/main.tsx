import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { checkHealth, type Health } from "./health";
import "./style.css";

function App() {
  const [health, setHealth] = useState<Health>("down");
  useEffect(() => {
    const controller = new AbortController();
    const refresh = async () => {
      const result = await checkHealth(controller.signal);
      if (!controller.signal.aborted) setHealth(result);
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 5000);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, []);

  return (
    <main>
      <p>Homelab PaaS</p>
      <h1>Hello world</h1>
      <p role="status" aria-live="polite">
        healthcheck: {health}
      </p>
    </main>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("Missing application root");
createRoot(root).render(<App />);
