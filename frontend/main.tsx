import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import FlowCompareWorkspace from "../app/components/FlowCompareWorkspace";
import "../app/globals.css";

const root = document.getElementById("flowcompare-root");

if (!root) {
  throw new Error("A area principal do FlowCompare nao foi encontrada.");
}

createRoot(root).render(
  <StrictMode>
    <FlowCompareWorkspace />
  </StrictMode>,
);
