import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useUserRole } from "../auth/useUserRole";
import { auth, db } from "../app/firebase";
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";

type QueueEntry = {
  uid: string;
  name?: string;
  email?: string;
  status?: string;
  enqueuedAt?: unknown;
  claimedBy?: string;
};

type RecruitmentSettings = {
  recruitment?: {
    isOpen?: boolean;
    activeStage?: string;
  };
};

function QueueTable({
  title,
  rows,
  loading,
  error,
  onClaim,
  claimingUid,
}: {
  title: string;
  rows: QueueEntry[];
  loading: boolean;
  error: string | null;
  onClaim: (uid: string) => void;
  claimingUid: string | null;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
      </div>

      {error && (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading ? (
        <div className="mt-3 text-slate-600">Loading…</div>
      ) : rows.length === 0 ? (
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
                <th className="py-2 pr-4"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.uid} className="border-b">
                  <td className="py-2 pr-4">{r.name ?? "—"}</td>
                  <td className="py-2 pr-4">{r.email ?? "—"}</td>
                  <td className="py-2 pr-4">{r.status ?? "waiting"}</td>
                  <td className="py-2 pr-0 text-right">
                    <button
                      onClick={() => onClaim(r.uid)}
                      disabled={claimingUid === r.uid}
                      className="rounded-lg bg-black px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
                    >
                      {claimingUid === r.uid ? "Claiming…" : "Claim"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function RecruitmentPage() {
  const { positions } = useUserRole();
  const isChair = positions.includes("recruitment_chair");
  const navigate = useNavigate();

  // --- Settings/global subscription (stage-aware) ---
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [isOpen, setIsOpen] = useState<boolean>(true);
  const [activeStage, setActiveStage] = useState<string>("stage1");
  const [settingsError, setSettingsError] = useState<string | null>(null);

  useEffect(() => {
    const ref = doc(db, "settings", "global");
    const unsub = onSnapshot(
      ref,
      (snap) => {
        const data = (snap.data() as RecruitmentSettings) ?? {};
        const rec = data.recruitment ?? {};
        setIsOpen(rec.isOpen ?? true);
        setActiveStage(rec.activeStage ?? "stage1");
        setSettingsLoading(false);
        setSettingsError(null);
      },
      (err) => {
        console.error("settings/global onSnapshot error:", err);
        setSettingsError(err.message ?? "Unknown error");
        setSettingsLoading(false);
      }
    );

    return () => unsub();
  }, []);

  // --- Stage 1 queues (two tables) ---
  const [sailingRows, setSailingRows] = useState<QueueEntry[]>([]);
  const [sailingLoading, setSailingLoading] = useState(true);
  const [sailingError, setSailingError] = useState<string | null>(null);

  const [personalityRows, setPersonalityRows] = useState<QueueEntry[]>([]);
  const [personalityLoading, setPersonalityLoading] = useState(true);
  const [personalityError, setPersonalityError] = useState<string | null>(null);

  useEffect(() => {
    if (activeStage !== "stage1") return;

    const sailingQ = query(
      collection(db, "stage1SailingQueue"),
      where("status", "==", "waiting"),
      orderBy("enqueuedAt", "asc")
    );

    const unsubSailing = onSnapshot(
      sailingQ,
      (snap) => {
        const rows: QueueEntry[] = snap.docs.map((d) => ({ uid: d.id, ...(d.data() as any) }));
        setSailingRows(rows);
        setSailingLoading(false);
        setSailingError(null);
      },
      (err) => {
        console.error("stage1SailingQueue error:", err);
        setSailingError(err.message ?? "Unknown error");
        setSailingLoading(false);
      }
    );

    const personalityQ = query(
      collection(db, "stage1PersonalityQueue"),
      where("status", "==", "waiting"),
      orderBy("enqueuedAt", "asc")
    );

    const unsubPersonality = onSnapshot(
      personalityQ,
      (snap) => {
        const rows: QueueEntry[] = snap.docs.map((d) => ({ uid: d.id, ...(d.data() as any) }));
        setPersonalityRows(rows);
        setPersonalityLoading(false);
        setPersonalityError(null);
      },
      (err) => {
        console.error("stage1PersonalityQueue error:", err);
        setPersonalityError(err.message ?? "Unknown error");
        setPersonalityLoading(false);
      }
    );

    return () => {
      unsubSailing();
      unsubPersonality();
    };
  }, [activeStage]);

  // --- Claim handlers ---
  const [claimingUid, setClaimingUid] = useState<string | null>(null);

  async function claimFromQueue(collectionName: "stage1SailingQueue" | "stage1PersonalityQueue", queueUid: string) {
    const myUid = auth.currentUser?.uid;
    if (!myUid) return;

    setClaimingUid(queueUid);

    try {
      const ref = doc(db, collectionName, queueUid);

      await runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists()) throw new Error("This prospie is no longer in the queue.");

        const data = snap.data() as any;
        if (data.status !== "waiting") throw new Error("This prospie has already been claimed.");

        tx.update(ref, {
          status: "claimed",
          claimedBy: myUid,
          claimedAt: serverTimestamp(),
        });
      });

      // Navigate to the correct interview page
      if (collectionName === "stage1SailingQueue") {
        navigate(`/member/recruitment/stage1/sailing/${queueUid}`);
      } else {
        navigate(`/member/recruitment/stage1/personality/${queueUid}`);
      }
    } catch (e: any) {
      console.error(e);
      // show error in the relevant table so it's visible
      const msg = e?.message ?? "Failed to claim prospie.";
      if (collectionName === "stage1SailingQueue") setSailingError(msg);
      else setPersonalityError(msg);
    } finally {
      setClaimingUid(null);
    }
  }

  // --- Chair: advance stage ---
  const stages = useMemo(() => ["stage1", "stage2", "stage3"], []);
  const nextStage = useMemo(() => {
    const idx = stages.indexOf(activeStage);
    if (idx < 0) return "stage1";
    return stages[Math.min(idx + 1, stages.length - 1)];
  }, [activeStage, stages]);

  async function advanceStage() {
    if (!isChair) return;
    const ref = doc(db, "settings", "global");
    await updateDoc(ref, {
      "recruitment.activeStage": nextStage,
    });
  }

  if (settingsLoading) return <div className="p-6">Loading…</div>;

  if (settingsError) {
    return (
      <div className="min-h-screen p-6">
        <div className="mx-auto max-w-2xl rounded-2xl bg-white p-6 shadow">
          <h1 className="text-xl font-semibold text-red-600">Settings error</h1>
          <p className="mt-2 text-slate-700">{settingsError}</p>
        </div>
      </div>
    );
  }

  if (!isOpen) {
    return (
      <div className="min-h-screen p-6">
        <div className="mx-auto max-w-2xl rounded-2xl bg-white p-6 shadow">
          <h1 className="text-2xl font-bold text-slate-900">Recruitment</h1>
          <p className="mt-2 text-slate-700">Recruitment is currently closed.</p>
        </div>
      </div>
    );
  }

  

  return (
    <div className="min-h-screen p-6">
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="rounded-2xl bg-white p-6 shadow">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-2xl font-bold text-slate-900">Recruitment</h1>
              <p className="mt-1 text-slate-700">
                Active stage: <span className="font-semibold">{activeStage}</span>
              </p>
            </div>

            {isChair && (
              <div className="flex flex-wrap gap-3">
                <button
                  onClick={() => navigate("/member/recruitment/prospies")}
                  className="rounded-lg bg-black px-4 py-2 text-sm font-semibold text-white"
                >
                  See prospies
                </button>

                <button
                  onClick={advanceStage}
                  className="rounded-lg bg-black px-4 py-2 text-sm font-semibold text-white"
                >
                  Advance stage → {nextStage}
                </button>

                <button
                  className="rounded-lg bg-black px-4 py-2 text-sm font-semibold text-white"
                  onClick={() => navigate("/member/recruitment/roster")}
                >
                  Roster / Decisioning
                </button>
              </div>
            )}
            
          </div>
        </div>

        {activeStage === "stage1" && (
          <div className="grid gap-6 md:grid-cols-2">
            <QueueTable
              title="Stage 1 — Sailing Queue (Waiting)"
              rows={sailingRows}
              loading={sailingLoading}
              error={sailingError}
              claimingUid={claimingUid}
              onClaim={(uid) => claimFromQueue("stage1SailingQueue", uid)}
            />

            <QueueTable
              title="Stage 1 — Personality Queue (Waiting)"
              rows={personalityRows}
              loading={personalityLoading}
              error={personalityError}
              claimingUid={claimingUid}
              onClaim={(uid) => claimFromQueue("stage1PersonalityQueue", uid)}
            />
          </div>
        )}

        {activeStage !== "stage1" && (
          <div className="rounded-2xl bg-white p-6 shadow">
            <h2 className="text-xl font-semibold text-slate-900">Stage not implemented yet</h2>
            <p className="mt-2 text-slate-700">
              The recruitment page is stage-aware. Next you’ll build the UI/workflows for{" "}
              <span className="font-semibold">{activeStage}</span>.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
