import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import SignupPage from "./pages/SignupPage";
import LoginPage from "./pages/LoginPage";
import ProspieHome from "./pages/ProspieHome";
import MemberHome from "./pages/MemberHome";
import RecruitmentPage from "./pages/RecruitmentPage";
import { useUserRole } from "./auth/useUserRole";
import ProspiesListPage from "./pages/ProspiesListPage";
import Stage1SailingInterviewPage from "./pages/Stage1SailingInterviewPage";
import Stage1PersonalityInterviewPage from "./pages/Stage1PersonalityInterviewPage";
import RecruitmentRosterPage from "./pages/RecruitmentRosterPage"; 
import Stage2InterviewPage from "./pages/Stage2InterviewPage";
import Stage2NotesUploadPage from "./pages/Stage2NotesUploadPage";



function AppHome() {
  const { role, positions, loading } = useUserRole();

  if (loading) return <div className="p-6">Loading…</div>;

  if (role === "member") return <Navigate to="/member" replace />;
  if (role === "prospie") return <Navigate to="/prospie" replace />;

  return <Navigate to="/login" replace />;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/signup" element={<SignupPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/app" element={<AppHome />} />

        <Route path="/prospie" element={<ProspieHome />} />

        <Route path="/member" element={<MemberHome />} />
        <Route path="/member/recruitment" element={<RecruitmentPage />} />
        <Route path="/member/recruitment/prospies" element={<ProspiesListPage />} />
        
        <Route path="/chair" element={<div className="p-6">Chair Home</div>} />

        <Route path="*" element={<Navigate to="/app" replace />} />

        <Route path="/member/recruitment/stage1/sailing/:uid" element={<Stage1SailingInterviewPage />} />

        <Route path="/member/recruitment/stage1/personality/:uid" element={<Stage1PersonalityInterviewPage />} />

        <Route path="/member/recruitment/roster" element = {<RecruitmentRosterPage />} />

        <Route path="/member/recruitment/stage2/interview/:uid" element={<Stage2InterviewPage />} />

        <Route path="/member/recruitment/stage2/notes" element={<Stage2NotesUploadPage />} />

      </Routes>
    </BrowserRouter>
  );
}

