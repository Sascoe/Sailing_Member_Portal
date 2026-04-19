import { doc, onSnapshot } from "firebase/firestore";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { db } from "../app/firebase";

type GlobalSettings = {
  recruitmentEnabled?: boolean;
};

export default function MemberHome() {
  const [recruitmentEnabled, setRecruitmentEnabled] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const ref = doc(db, "settings", "global");
    const unsub = onSnapshot(ref, (snap) => {
      const data = (snap.data() as GlobalSettings) ?? {};
      setRecruitmentEnabled(Boolean(data.recruitmentEnabled));
      setLoading(false);
    });
    return () => unsub();
  }, []);

  return (
    <div className="min-h-screen p-6 bg-white">
      <div className="mx-auto max-w-3xl space-y-6">
        <h1 className="text-2xl font-bold text-center text-purple-600">Member Home</h1>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-2xl bg-white p-5 shadow-lg border border-slate-200">
            <div className="text-lg font-semibold text-purple-700">Recruitment</div>
            <div className="mt-1 text-sm text-slate-600">
              Queue, interviews, notes, and packets.
            </div>

            {loading ? (
              <div className="mt-4 text-sm text-slate-500">Loading…</div>
            ) : recruitmentEnabled ? (
              <Link
                to="/member/recruitment"
                className="mt-4 inline-block rounded-lg bg-purple-600 hover:bg-purple-700 px-4 py-2 font-semibold text-white"
              >
                Open
              </Link>
            ) : (
              <button
                disabled
                className="mt-4 inline-block rounded-lg bg-slate-200 px-4 py-2 font-semibold text-slate-600"
              >
                Closed
              </button>
            )}
          </div>

          <div className="rounded-2xl bg-white p-5 shadow-lg border border-slate-200">
            <div className="text-lg font-semibold text-purple-700">Team</div>
            <div className="mt-1 text-sm text-slate-600">
              Rosters, practice schedule, attendance (later).
            </div>
            <button
              disabled
              className="mt-4 inline-block rounded-lg bg-slate-200 px-4 py-2 font-semibold text-slate-600"
            >
              Coming soon
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
