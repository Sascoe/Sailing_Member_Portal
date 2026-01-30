import { useUserRole } from "../auth/useUserRole";
import { useNavigate } from "react-router-dom";
import { collection, onSnapshot, orderBy, query, where } from "firebase/firestore";
import { useEffect, useState } from "react";
import { db } from "../app/firebase";

type QueueEntry = {
    uid?: string,
    name?: string;
    email?: string;
    status?: string;
    enqueuedAt?: unknown;
};

export default function RecruitmentPage() {
  const { positions } = useUserRole();
  const isRecruitmentChair = positions.includes("recruitment_chair");
  const navigate = useNavigate();

  const [queue, setQueue] = useState<QueueEntry[]>([]);
  const [queueLoading, setQueueLoading] = useState(true);
  const [queueError, setQueueError] = useState<string | null>(null);

  useEffect(() => {
    const q = query(
      collection(db, "stage1Queue"),
      where("status", "==", "waiting"),
      orderBy("enqueuedAt", "asc")
    );

    const unsub = onSnapshot(
      q,
      (snap) => {
        const rows: QueueEntry[] = snap.docs.map((d) => {
          const data = d.data() as Omit<QueueEntry, "uid">;
          return { uid: d.id, ...data };
        });
        setQueue(rows);
        setQueueLoading(false);
        setQueueError(null);
      },
      (err) => {
        console.error("stage1Queue onSnapshot error:", err);
        setQueueError(err.message ?? "Unknown error");
        setQueueLoading(false);
      }
    );

    return () => unsub();
  }, []);

  return (
    <div className="min-h-screen p-6">
      <div className="mx-auto max-w-3xl space-y-6 rounded-2xl bg-white p-6 shadow">
        <div className="space-y-2">
          <h1 className="text-2xl font-bold text-slate-900">Recruitment</h1>
          <p className="text-slate-700">
            Stage 1 queue is live (waiting list below). Next we’ll add “Pull next”.
          </p>
        </div>

        {/* Stage 1 Queue (Waiting) */}
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-900">Stage 1 Queue (Waiting)</h2>

            {/* We'll wire this in Step C (transaction claim) */}
            <button
              disabled
              className="rounded-lg bg-slate-300 px-4 py-2 text-sm font-semibold text-slate-600"
            >
              Pull next
            </button>
          </div>

          {queueError && (
            <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {queueError}
            </div>
          )}

          {queueLoading ? (
            <div className="mt-3 text-slate-600">Loading queue…</div>
          ) : queue.length === 0 ? (
            <div className="mt-3 rounded-lg bg-slate-50 p-3 text-slate-700">
              No one is waiting right now.
            </div>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full border-collapse text-left text-sm text-slate-900">
                <thead>
                  <tr className="border-b">
                    <th className="py-2 pr-4">Name</th>
                    <th className="py-2 pr-4">Email</th>
                    <th className="py-2 pr-4">Status</th>
                  </tr>
                </thead>
                <tbody>
                    {queue.map((q) => (
                        <tr key={q.uid} className="border-b">
                        <td className="py-2 pr-4">
                            {q.name ?? "—"}
                        </td>

                        <td className="py-2 pr-4">
                            {q.email ?? "—"}
                        </td>

                        <td className="py-2 pr-4">
                            {q.status ?? "waiting"}
                        </td>
                        </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Recruitment Chair Controls */}
        {isRecruitmentChair && (
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="text-lg font-semibold text-slate-900">
              Recruitment Chair Controls
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              Additional tools available to recruitment chairs.
            </p>

            <div className="mt-4 flex flex-wrap gap-3">
              <button
                className="rounded-lg bg-black px-4 py-2 text-sm font-semibold text-white"
                onClick={() => navigate("/member/recruitment/prospies")}
              >
                See prospies
              </button>

              <button
                disabled
                className="rounded-lg bg-slate-300 px-4 py-2 text-sm font-semibold text-slate-600"
              >
                Close recruitment
              </button>

              <button
                disabled
                className="rounded-lg bg-slate-300 px-4 py-2 text-sm font-semibold text-slate-600"
              >
                Advance stage
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
