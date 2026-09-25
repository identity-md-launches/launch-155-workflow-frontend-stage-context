import { createRoot } from "react-dom/client";
import { useEffect, useState } from "react";
import { loadDeployment, errorMessage, type Deployment } from "./config";
import { App } from "./App";
import "./styles.css";

function Boot() {
  const [deployment, setDeployment] = useState<Deployment>();
  const [error, setError] = useState("");
  useEffect(() => {
    loadDeployment()
      .then(setDeployment)
      .catch((e) => setError(errorMessage(e)));
  }, []);
  if (!deployment)
    return (
      <main className="boot">
        <a className="brand" href="./">
          ◯ NOOP
        </a>
        <h1>{error ? "Deployment unavailable" : "Verifying deployment…"}</h1>
        <p role={error ? "alert" : "status"}>
          {error || "Loading the attested contract interfaces."}
        </p>
        {error && (
          <button onClick={() => location.reload()}>Retry Loading</button>
        )}
      </main>
    );
  return <App config={deployment} />;
}
createRoot(document.getElementById("root")!).render(<Boot />);
