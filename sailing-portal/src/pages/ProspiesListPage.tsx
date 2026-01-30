import { useNavigate } from "react-router-dom";
import { useUserRole } from "../auth/useUserRole";
import { collection, onSnapshot, orderBy, query } from "firebase/firestore";
import { useEffect, useState } from "react";
import { db } from "../app/firebase";

type ProspieRow = {
  id: string;
  email?: string;
  name?: string;
  createdAt?: unknown;
};

export default function ProspiesListPage() {
  // ✅ Hooks FIRST (always called, every render)
  const navigate = useNavigate();
  const { loading, positions } = useUserRole();
  const isRecruitmentChair = positions.includes("recruitment_chair");

  const [prospies, setProspies] = useState<ProspieRow[]>([]);
  const [prospiesLoading, setProspiesLoading] = useState(true);
  const [prospiesError, setProspiesError] = useState<string | null>(null);

  // ✅ Effects can still run, but we gate the *work* inside the effect
  useEffect(() => {
    // Don’t query until auth is resolved AND user is authorized
    if (loading) return;
    if (!isRecruitmentChair) return;

    const q = query(collection(db, "prospies"), orderBy("createdAt", "desc"));

    const unsub = onSnapshot(
      q,
      (snap) => {
        const rows: ProspieRow[] = snap.docs.map((d) => {
          const data = d.data() as Omit<ProspieRow, "id">;
          return { id: d.id, ...data };
        });

        setProspies(rows);
        setProspiesLoading(false);
        setProspiesError(null);
      },
      (err) => {
        console.error("onSnapshot error:", err);
        setProspiesError(err.message ?? "Unknown error");
        setProspiesLoading(false);
      }
    );

    return () => unsub();
  }, [loading, isRecruitmentChair]);

  // ✅ Now early returns are safe because all hooks already ran
  if (loading) return <div className="p-6">Loading…</div>;

  if (!isRecruitmentChair) {
    return (
      <div className="min-h-screen p-6">
        <div className="mx-auto max-w-md rounded-2xl bg-white p-6 text-center shadow">
          <h1 className="text-xl font-semibold text-red-600">Access denied</h1>
          <p className="mt-2 text-slate-600">
            You don’t have permission to view this page.
          </p>
          <button
            onClick={() => navigate("/member/recruitment")}
            className="mt-4 rounded-lg bg-black px-4 py-2 text-sm font-semibold text-white"
          >
            Back to recruitment
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen p-6">
      <div className="mx-auto max-w-5xl rounded-2xl bg-white p-6 shadow">
        <h1 className="text-2xl font-bold">Prospies</h1>
        <p className="mt-2 text-slate-600">All checked-in prospies.</p>

        {prospiesError && (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {prospiesError}
          </div>
        )}

        {prospiesLoading ? (
          <div className="mt-4 text-slate-600">Loading prospies…</div>
        ) : prospies.length === 0 ? (
          <div className="mt-4 rounded-lg bg-slate-50 p-4 text-slate-700">
            No prospies found yet.
          </div>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b">
                  <th className="py-2 pr-4">Name</th>
                  <th className="py-2 pr-4">Email</th>
                  <th className="py-2 pr-4">UID</th>
                </tr>
              </thead>
              <tbody>
                {prospies.map((p) => (
                  <tr key={p.id} className="border-b">
                    <td className="py-2 pr-4 text-black">
                        {p.name ?? "—"}
                        </td>

                        <td className="py-2 pr-4 text-black">
                        {p.email ?? "—"}
                        </td>

                        <td className="py-2 pr-4 font-mono text-xs text-slate-700">
                        {p.id}
                        </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}


