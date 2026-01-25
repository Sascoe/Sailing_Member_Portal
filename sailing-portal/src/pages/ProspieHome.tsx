import { doc, onSnapshot, serverTimestamp, setDoc } from "firebase/firestore";
import { useEffect, useState } from "react";
import { auth, db } from "../app/firebase";

type QueueState = "waiting" | "claimed";

export default function ProspieHome() {
  const [loading, setLoading] = useState(true);
  const [queueState, setQueueState] = useState<QueueState | null>(null);

  const uid = auth.currentUser?.uid;

  useEffect(() => {
    if (!uid) return;

    const ref = doc(db, "stage1Queue", uid);

    const unsub = onSnapshot(ref, (snap) => {
      if (snap.exists()) {
        setQueueState(snap.data().state as QueueState);
      } else {
        setQueueState(null);
      }
      setLoading(false);
    });

    return () => unsub();
  }, [uid]);

  async function checkIn() {
    if (!uid) return;

    await setDoc(doc(db, "stage1Queue", uid), {
      prospieUid: uid,
      createdAt: serverTimestamp(),
      state: "waiting",
    });
  }

  if (loading) {
    return <div className="p-6">Loading…</div>;
  }

  return (
    <div className="min-h-screen p-6">
      <div className="mx-auto max-w-xl space-y-4 rounded-2xl bg-white p-6 shadow">
        <h1 className="text-2xl font-bold">Prospie Home</h1>

        {queueState === null && (
          <button
            onClick={checkIn}
            className="w-full rounded-lg bg-black px-4 py-2 font-semibold text-white"
          >
            Check in for Stage 1
          </button>
        )}

        {queueState === "waiting" && (
          <div className="rounded-lg bg-slate-100 p-4 text-slate-700">
            You are checked in and waiting for a member.
          </div>
        )}

        {queueState === "claimed" && (
          <div className="rounded-lg bg-green-100 p-4 text-green-800">
            A member has claimed you. Please stand by.
          </div>
        )}
      </div>
    </div>
  );
}

