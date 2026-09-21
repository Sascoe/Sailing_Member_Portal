import { collection, doc, onSnapshot } from "firebase/firestore";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { db } from "../app/firebase";

type GlobalSettings = {
  recruitment?: {
    isOpen?: boolean;
  };
};

type MemberRow = {
  uid: string;
  firstName: string;
  lastName: string;
  photoUrl?: string;
  gradYear?: number;
};

function MemberSidebar() {
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, "members"), (snap) => {
      const rows: MemberRow[] = snap.docs.map((d) => {
        const data = d.data() as any;
        return {
          uid: d.id,
          firstName: data.firstName ?? "",
          lastName: data.lastName ?? "",
          photoUrl: data.photoUrl,
          gradYear: data.gradYear,
        };
      });

      rows.sort((a, b) => {
        const byLast = a.lastName.localeCompare(b.lastName);
        if (byLast !== 0) return byLast;
        return a.firstName.localeCompare(b.firstName);
      });

      setMembers(rows);
      setLoading(false);
    });
    return () => unsub();
  }, []);

  return (
    <div
      className={`fixed right-0 top-0 z-40 h-full ${isOpen ? "w-72" : "w-4"}`}
      onMouseEnter={() => setIsOpen(true)}
      onMouseLeave={() => setIsOpen(false)}
    >
      {/* Indicator tab, only meaningful while the panel is closed */}
      <div
        className={`absolute right-2 top-4 rounded-full bg-purple-600 px-3 py-1.5 text-xs font-semibold text-white shadow-lg transition-opacity duration-200 ${
          isOpen ? "pointer-events-none opacity-0" : "opacity-100"
        }`}
      >
        Members
      </div>

      {/* Sliding panel */}
      <aside
        className={`absolute right-0 top-0 h-full w-72 transform border-l border-slate-200 bg-white p-5 shadow-lg transition-transform duration-300 ease-out ${
          isOpen ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <h2 className="text-lg font-semibold text-purple-700">Members</h2>

        {loading ? (
          <div className="mt-3 text-sm text-slate-500">Loading…</div>
        ) : members.length === 0 ? (
          <div className="mt-3 text-sm text-slate-500">No members yet.</div>
        ) : (
          <div className="mt-3 max-h-[calc(100vh-6rem)] space-y-3 overflow-y-auto pr-1">
            {members.map((m) => (
              <div key={m.uid} className="flex items-center gap-3">
                {m.photoUrl ? (
                  <img
                    src={m.photoUrl}
                    alt={`${m.firstName} ${m.lastName}`}
                    className="h-10 w-10 shrink-0 rounded-full object-cover"
                  />
                ) : (
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs text-slate-500">
                    —
                  </div>
                )}
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-slate-900">
                    {m.firstName} {m.lastName}
                  </div>
                  <div className="text-xs text-slate-500">{m.gradYear ?? "—"}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </aside>
    </div>
  );
}

export default function MemberHome() {
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const ref = doc(db, "settings", "global");
    const unsub = onSnapshot(ref, (snap) => {
      const data = (snap.data() as GlobalSettings) ?? {};
      setIsOpen(data.recruitment?.isOpen ?? true);
      setLoading(false);
    });
    return () => unsub();
  }, []);

  return (
    <div className="min-h-screen p-6 bg-white">
      <div className="mx-auto max-w-6xl">
        <h1 className="text-2xl font-bold text-center text-purple-600">Member Home</h1>

        <div className="mt-6 rounded-2xl bg-white p-8 shadow-lg border border-slate-200 text-center">
          <div className="text-2xl font-semibold text-purple-700">Recruitment</div>
          <div className="mt-2 text-slate-600">
          </div>

          {loading ? (
            <div className="mt-6 text-sm text-slate-500">Loading…</div>
          ) : isOpen ? (
            <Link
              to="/member/recruitment"
              className=""
            >
              Open
            </Link>
          ) : (
            <button
              disabled
              className="mt-6 inline-block rounded-lg bg-slate-200 px-6 py-3 text-lg font-semibold text-slate-600"
            >
              Closed
            </button>
          )}
        </div>
      </div>

      <MemberSidebar />
    </div>
  );
}
