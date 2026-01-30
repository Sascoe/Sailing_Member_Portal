import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import SignupPage from "./pages/SignupPage";
import LoginPage from "./pages/LoginPage";
import ProspieHome from "./pages/ProspieHome";
import MemberHome from "./pages/MemberHome";
import RecruitmentPage from "./pages/RecruitmentPage";
import { useUserRole } from "./auth/useUserRole";
import ProspiesListPage from "./pages/ProspiesListPage";

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
      </Routes>
    </BrowserRouter>
  );
}

