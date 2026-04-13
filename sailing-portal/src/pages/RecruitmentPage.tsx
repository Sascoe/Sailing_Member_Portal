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

type Stage2Slot = "thu_2_4" | "thu_4_6" | "fri_2_4" | "fri_4_6";

type Stage2Row = {
  uid: string;
  name: string;
  email?: string;
  slot: Stage2Slot;
  checkedIn: boolean;
  onTheWaterComplete: boolean;
  interviewComplete: boolean;
};

const STAGE2_SLOT_LABELS: Record<Stage2Slot, string> = {
  thu_2_4: "Thursday 2–4",
  thu_4_6: "Thursday 4–6",
  fri_2_4: "Friday 2–4",
  fri_4_6: "Friday 4–6",
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

function Stage2SlotColumn({
  title,
  rows,
  onToggleCheckedIn,
  onToggleOnTheWater,
  onInterview,
}: {
  title: string;
  rows: Stage2Row[];
  onToggleCheckedIn: (uid: string, nextValue: boolean) => void;
  onToggleOnTheWater: (uid: string, nextValue: boolean) => void;
  onInterview: (uid: string) => void;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="text-lg font-semibold text-slate-900">{title}</h2>

      {rows.length === 0 ? (
        <div className="mt-3 rounded-lg bg-slate-50 p-3 text-sm text-slate-700">
          No assigned prospies.
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          {rows.map((r) => {
            const canInterview = r.checkedIn && r.onTheWaterComplete;

            return (
              <div
                key={r.uid}
                className="rounded-lg border border-slate-200 bg-slate-50 p-3"
              >
                <div className="font-semibold text-slate-900">{r.name}</div>
                <div className="text-sm text-slate-600">{r.email ?? "—"}</div>

                <div className="mt-3 space-y-2">
                  <label className="flex items-center gap-2 text-sm text-slate-800">
                    <input
                      type="checkbox"
                      checked={r.checkedIn}
                      onChange={(e) =>
                        onToggleCheckedIn(r.uid, e.target.checked)
                      }
                    />
                    <span>Checked in</span>
                  </label>

                  <label className="flex items-center gap-2 text-sm text-slate-800">
                    <input
                      type="checkbox"
                      checked={r.onTheWaterComplete}
                      onChange={(e) =>
                        onToggleOnTheWater(r.uid, e.target.checked)
                      }
                    />
                    <span>On-the-water complete</span>
                  </label>
                </div>

                <button
                  onClick={() => onInterview(r.uid)}
                  disabled={!canInterview}
                  className="mt-3 w-full rounded-lg bg-black px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
                >
                  Interview
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function RecruitmentPage() {
  const { positions } = useUserRole();
  const isChair = positions.includes("recruitment_chair");
  const navigate = useNavigate();

  // --- Settings/global subscription ---
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [isOpen, setIsOpen] = useState(true);
  const [activeStage, setActiveStage] = useState("stage1");
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

  // --- Stage 1 queues ---
  const [sailingRows, setSailingRows] = useState<QueueEntry[]>([]);
  const [sailingLoading, setSailingLoading] = useState(true);
  const [sailingError, setSailingError] = useState<string | null>(null);

  const [personalityRows, setPersonalityRows] = useState<QueueEntry[]>([]);
  const [personalityLoading, setPersonalityLoading] = useState(true);
  const [personalityError, setPersonalityError] = useState<string | null>(null);

  useEffect(() => {
    if (activeStage !== "stage1") return;

    setSailingLoading(true);
    setPersonalityLoading(true);

    const sailingQ = query(
      collection(db, "stage1SailingQueue"),
      where("status", "==", "waiting"),
      orderBy("enqueuedAt", "asc")
    );

    const unsubSailing = onSnapshot(
      sailingQ,
      (snap) => {
        const rows: QueueEntry[] = snap.docs.map((d) => ({
          uid: d.id,
          ...(d.data() as any),
        }));
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
        const rows: QueueEntry[] = snap.docs.map((d) => ({
          uid: d.id,
          ...(d.data() as any),
        }));
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

  // --- Stage 2 rows ---
  const [stage2Rows, setStage2Rows] = useState<Stage2Row[]>([]);
  const [stage2Loading, setStage2Loading] = useState(true);
  const [stage2Error, setStage2Error] = useState<string | null>(null);

  useEffect(() => {
    if (activeStage !== "stage2") return;

    setStage2Loading(true);

    const q = query(
      collection(db, "prospies"),
      where("stage1FinalDecision", "==", "advance")
    );

    const unsub = onSnapshot(
      q,
      (snap) => {
        const rows: Stage2Row[] = snap.docs
          .map((d) => {
            const data = d.data() as any;

            const slot =
              (data.stage2?.slot as Stage2Slot | undefined) ??
              (data.stage2Slot as Stage2Slot | undefined);

            if (!slot) return null;

            const name =
              `${data.firstName ?? ""} ${data.lastName ?? ""}`.trim() ||
              data.email ||
              d.id;

            return {
              uid: d.id,
              name,
              email: data.email,
              slot,
              checkedIn: Boolean(data.stage2?.checkedIn),
              onTheWaterComplete: Boolean(data.stage2?.onTheWaterComplete),
              interviewComplete: Boolean(data.stage2?.interviewComplete),
            };
          })
          .filter((r): r is Stage2Row => r !== null)
          .filter((r) => !r.interviewComplete);

        setStage2Rows(rows);
        setStage2Loading(false);
        setStage2Error(null);
      },
      (err) => {
        console.error("stage2 prospies error:", err);
        setStage2Error(err.message ?? "Unknown error");
        setStage2Loading(false);
      }
    );

    return () => unsub();
  }, [activeStage]);

  const stage2Grouped = useMemo(() => {
    return {
      thu_2_4: stage2Rows.filter((r) => r.slot === "thu_2_4"),
      thu_4_6: stage2Rows.filter((r) => r.slot === "thu_4_6"),
      fri_2_4: stage2Rows.filter((r) => r.slot === "fri_2_4"),
      fri_4_6: stage2Rows.filter((r) => r.slot === "fri_4_6"),
    };
  }, [stage2Rows]);

  async function updateStage2Progress(
    uid: string,
    updates: Record<string, any>
  ) {
    const ref = doc(db, "prospies", uid);
    await updateDoc(ref, updates);
  }

  // --- Claim handlers ---
  const [claimingUid, setClaimingUid] = useState<string | null>(null);

  async function claimFromQueue(
    collectionName: "stage1SailingQueue" | "stage1PersonalityQueue",
    queueUid: string
  ) {
    const myUid = auth.currentUser?.uid;
    if (!myUid) return;

    setClaimingUid(queueUid);

    try {
      const ref = doc(db, collectionName, queueUid);

      await runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists()) {
          throw new Error("This prospie is no longer in the queue.");
        }

        const data = snap.data() as any;
        if (data.status !== "waiting") {
          throw new Error("This prospie has already been claimed.");
        }

        tx.update(ref, {
          status: "claimed",
          claimedBy: myUid,
          claimedAt: serverTimestamp(),
        });
      });

      if (collectionName === "stage1SailingQueue") {
        navigate(`/member/recruitment/stage1/sailing/${queueUid}`);
      } else {
        navigate(`/member/recruitment/stage1/personality/${queueUid}`);
      }
    } catch (e: any) {
      console.error(e);
      const msg = e?.message ?? "Failed to claim prospie.";
      if (collectionName === "stage1SailingQueue") setSailingError(msg);
      else setPersonalityError(msg);
    } finally {
      setClaimingUid(null);
    }
  }

  async function claimStage2Interview(uid: string) {
    const myUid = auth.currentUser?.uid;
    if (!myUid) return;

    const ref = doc(db, "prospies", uid);

    try {
      await runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists()) throw new Error("Prospie not found");

        const data = snap.data() as any;

        if (data.stage2?.interviewComplete) {
          throw new Error("Interview already completed");
        }

        if (
          data.stage2?.interviewClaimedBy &&
          data.stage2.interviewClaimedBy !== myUid
        ) {
          throw new Error("Another member already claimed this interview");
        }

        tx.update(ref, {
          "stage2.interviewClaimedBy": myUid,
          "stage2.interviewClaimedAt": serverTimestamp(),
        });
      });

      navigate(`/member/recruitment/stage2/interview/${uid}`);
    } catch (e: any) {
      console.error(e);
      alert(e.message);
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
          <p className="mt-2 text-slate-700">
            Recruitment is currently closed.
          </p>
        </div>
      </div>
    );
  }

  return (
  <div className="min-h-screen p-6">
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="rounded-2xl bg-white p-6 shadow">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Recruitment</h1>
            <p className="mt-1 text-slate-700">
              Active stage: <span className="font-semibold">{activeStage}</span>
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            {isChair && (
              <>
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

                {activeStage === "stage3" && (

                <button
                  onClick={() => navigate("/member/recruitment/stage3/packets")}
                  className="rounded-lg bg-black px-4 py-2 text-sm font-semibold text-white"
                >
                  Open Stage 3 Packets
                </button>
              )}
              </>
            )}

            <button
              onClick={() => navigate("/member/recruitment/stage2/notes")}
              className="rounded-lg bg-black px-4 py-2 text-sm font-semibold text-white"
            >
              Upload on-the-water notes
            </button>
          </div>

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

      {activeStage === "stage2" && (
        <div className="space-y-4">
          {stage2Error && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
              {stage2Error}
            </div>
          )}

          {stage2Loading ? (
            <div className="rounded-2xl bg-white p-6 shadow text-slate-700">
              Loading Stage 2…
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <Stage2SlotColumn
                title={STAGE2_SLOT_LABELS.thu_2_4}
                rows={stage2Grouped.thu_2_4}
                onToggleCheckedIn={(uid, val) =>
                  updateStage2Progress(uid, {
                    "stage2.checkedIn": val,
                    "stage2.checkedInAt": val ? serverTimestamp() : null,
                  })
                }
                onToggleOnTheWater={(uid, val) =>
                  updateStage2Progress(uid, {
                    "stage2.onTheWaterComplete": val,
                    "stage2.onTheWaterCompleteAt": val ? serverTimestamp() : null,
                  })
                }
                onInterview={claimStage2Interview}
              />

              <Stage2SlotColumn
                title={STAGE2_SLOT_LABELS.thu_4_6}
                rows={stage2Grouped.thu_4_6}
                onToggleCheckedIn={(uid, val) =>
                  updateStage2Progress(uid, {
                    "stage2.checkedIn": val,
                    "stage2.checkedInAt": val ? serverTimestamp() : null,
                  })
                }
                onToggleOnTheWater={(uid, val) =>
                  updateStage2Progress(uid, {
                    "stage2.onTheWaterComplete": val,
                    "stage2.onTheWaterCompleteAt": val ? serverTimestamp() : null,
                  })
                }
                onInterview={claimStage2Interview}
              />

              <Stage2SlotColumn
                title={STAGE2_SLOT_LABELS.fri_2_4}
                rows={stage2Grouped.fri_2_4}
                onToggleCheckedIn={(uid, val) =>
                  updateStage2Progress(uid, {
                    "stage2.checkedIn": val,
                    "stage2.checkedInAt": val ? serverTimestamp() : null,
                  })
                }
                onToggleOnTheWater={(uid, val) =>
                  updateStage2Progress(uid, {
                    "stage2.onTheWaterComplete": val,
                    "stage2.onTheWaterCompleteAt": val ? serverTimestamp() : null,
                  })
                }
                onInterview={claimStage2Interview}
              />

              <Stage2SlotColumn
                title={STAGE2_SLOT_LABELS.fri_4_6}
                rows={stage2Grouped.fri_4_6}
                onToggleCheckedIn={(uid, val) =>
                  updateStage2Progress(uid, {
                    "stage2.checkedIn": val,
                    "stage2.checkedInAt": val ? serverTimestamp() : null,
                  })
                }
                onToggleOnTheWater={(uid, val) =>
                  updateStage2Progress(uid, {
                    "stage2.onTheWaterComplete": val,
                    "stage2.onTheWaterCompleteAt": val ? serverTimestamp() : null,
                  })
                }
                onInterview={claimStage2Interview}
              />
            </div>
          )}
        </div>
      )}
    </div>
  </div>
);
}