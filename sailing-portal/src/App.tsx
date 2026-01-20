import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import SignupPage from "./pages/SignupPage";
import LoginPage from "./pages/LoginPage";
import ProspieHome from "./pages/ProspieHome";
import { useUserRole } from "./auth/useUserRole";

function AppHome() {
  const { role, loading } = useUserRole();

  if (loading) return <div className="p-6">Loading…</div>;

  if (role === "chair") return <Navigate to="/chair" replace />;
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
        <Route path="/member" element={<div className="p-6">Member Home</div>} />
        <Route path="/chair" element={<div className="p-6">Chair Home</div>} />

        <Route path="*" element={<Navigate to="/app" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
