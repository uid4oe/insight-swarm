import { createRoot } from "react-dom/client";
import "./styles.css";
import { App } from "./App";

const rootParams = document.getElementById("root");
if (rootParams) {
	createRoot(rootParams).render(<App />);
}
