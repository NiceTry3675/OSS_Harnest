import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import { ProjectProvider } from "./state";
import { loadSharedProviders } from "./lib/llm";
import "./styles.css";

// 관리자 공유 키 여부를 미리 캐시해 둔다 — 렌더를 막지 않는다.
// 위저드에서도 다시 불러오므로, 늦게 끝나도 실제 사용 시점엔 채워져 있다.
void loadSharedProviders();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <ProjectProvider>
        <App />
      </ProjectProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
