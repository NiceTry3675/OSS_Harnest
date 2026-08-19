import { Route, Routes } from "react-router-dom";
import { HomePage } from "@/pages/HomePage";
import { InterviewPage } from "@/pages/InterviewPage";
import { CriteriaPage } from "@/pages/CriteriaPage";
import { RunPage } from "@/pages/RunPage";
import { ResultPage } from "@/pages/ResultPage";

export function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/interview" element={<InterviewPage />} />
      <Route path="/criteria" element={<CriteriaPage />} />
      <Route path="/run" element={<RunPage />} />
      <Route path="/result" element={<ResultPage />} />
    </Routes>
  );
}
