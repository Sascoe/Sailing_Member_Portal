import {
  deleteDoc,
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  getDoc,
} from "firebase/firestore";
import { useEffect, useState } from "react";
import { auth, db } from "../app/firebase";

type QueueStatus = "waiting" | "claimed";

export default function ProspieHome() {
  const [loading, setLoading] = useState(true);
  const [queueStatus, setQueueStatus] = useState<QueueStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const uid = auth.currentUser?.uid;

  const prospieRef = doc(db, "prospies", uid);
  
  useEffect(() => {
    if (!uid) return;

    // ✅ Stage 1 Sailing Queue
    const ref = doc(db, "stage1SailingQueue", uid);

    const unsub = onSnapshot(ref, (snap) => {
      if (snap.exists()) {
        setQueueStatus(snap.data().status as QueueStatus);
      } else {
        setQueueStatus(null);
      }
      setLoading(false);
    });

    return () => unsub();
  }, [uid]);

  async function checkIn() {
    if (!uid) return;
    setError(null);

    try {
      const prospieRef = doc(db, "prospies", uid);
      const prospieSnap = await getDoc(prospieRef);
      const name = prospieSnap.exists() ? prospieSnap.data().name ?? "" : "";

      // ✅ Create queue entry in Stage 1 Sailing Queue
      await setDoc(doc(db, "stage1SailingQueue", uid), {
        uid,
        name,
        email: auth.currentUser?.email ?? "",
        status: "waiting",
        enqueuedAt: serverTimestamp(),
      });
    } catch (e: any) {
      console.error(e);
      setError(e?.message ?? "Failed to check in");
    }
  }

  async function leaveQueue() {
    if (!uid) return;
    setError(null);

    try {
      // ✅ Remove from Stage 1 Sailing Queue
      await deleteDoc(doc(db, "stage1SailingQueue", uid));
    } catch (e: any) {
      console.error(e);
      setError(e?.message ?? "Failed to leave queue");
    }
  }

  if (loading) return <div className="p-6">Loading…</div>;

  return (
    <div className="min-h-screen p-6">
      <div className="mx-auto max-w-xl space-y-4 rounded-2xl bg-white p-6 shadow">
        <h1 className="text-2xl font-bold text-center text-purple-600">Prospie Home</h1>

        {error && (
          <div className="rounded-lg bg-red-50 p-2 text-sm text-red-700">
            {error}
          </div>
        )}

        {queueStatus === null && (
          <button
            onClick={checkIn}
            className="w-full rounded-lg bg-purple-600 hover:bg-purple-700 px-4 py-2 font-semibold text-white"
          >
            Check in for Stage 1 (Sailing)
          </button>
        )}

        {queueStatus === "waiting" && (
          <div className="space-y-3">
            <div className="rounded-lg bg-slate-100 p-4 text-slate-700">
              You are checked in and waiting for a member.
            </div>
            <button
              onClick={leaveQueue}
              className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2 font-semibold text-slate-900"
            >
              Leave queue
            </button>
          </div>
        )}

        {queueStatus === "claimed" && (
          <div className="rounded-lg bg-green-100 p-4 text-green-800">
            A member has claimed you. Please stand by.
          </div>
        )}
      </div>
    </div>
  );
}
