import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { auth, db } from "../app/firebase";
import { doc, onSnapshot, runTransaction, serverTimestamp} from "firebase/firestore";

type YesMaybeNo = "yes" | "maybe" | "no";

type PersonalityQueueDoc = {
  status?: "waiting" | "claimed";
  claimedBy?: string;
  name?: string;
  email?: string;
};

export default function Stage1PersonalityInterviewPage() {


  const { uid } = useParams<{ uid: string }>();
  const navigate = useNavigate();

  const myUid = auth.currentUser?.uid ?? null;

  const [loading, setLoading] = useState(true);
  const [accessDenied, setAccessDenied] = useState(false);
  const [queueDoc, setQueueDoc] = useState<PersonalityQueueDoc | null>(null);
  const [formUrl, setFormUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Summary fields
  const [eval1, setEval1] = useState<YesMaybeNo>("maybe");
  const [eval2, setEval2] = useState<YesMaybeNo>("maybe");
  const [notes1, setNotes1] = useState("");
  const [notes2, setNotes2] = useState("");

  // Load form URL from settings/global
  useEffect(() => {
    const ref = doc(db, "settings", "global");

    const unsub = onSnapshot(ref, (snap) => {
      const url =
        (snap.data() as any)?.stage1PersonalityInterviewFormUrl ?? "";
        console.log("Personality form URL from settings:", url);
      setFormUrl(url);
    });

    return () => unsub();
  }, []);

  // Verify claim ownership
  useEffect(() => {
    if (!uid || !myUid) {
      setAccessDenied(true);
      setLoading(false);
      return;
    }

    const ref = doc(db, "stage1PersonalityQueue", uid);

    const unsub = onSnapshot(
      ref,
      (snap) => {
        if (!snap.exists()) {
          setQueueDoc(null);
          setAccessDenied(true);
          setLoading(false);
          return;
        }

        const data = snap.data() as PersonalityQueueDoc;
        setQueueDoc(data);

        const ok =
          data.status === "claimed" &&
          typeof data.claimedBy === "string" &&
          data.claimedBy === myUid;

        setAccessDenied(!ok);
        setLoading(false);
      },
      (err) => {
        console.error("personality queue snapshot error:", err);
        setAccessDenied(true);
        setLoading(false);
      }
    );

    return () => unsub();
  }, [uid, myUid]);

  if (loading) return <div className="p-6">Loading…</div>;

  if (accessDenied) {
    return (
      <div className="min-h-screen p-6">
        <div className="mx-auto max-w-md rounded-2xl bg-white p-6 text-center shadow">
          <h1 className="text-xl font-semibold text-red-600">
            Access denied
          </h1>
          <p className="mt-2 text-slate-600">
            You don’t have permission to view this interview.
          </p>
          <button
            onClick={() => navigate("/member/recruitment")}
            className="mt-4 rounded-lg bg-purple-600 hover:bg-purple-700 px-4 py-2 text-sm font-semibold text-white"
          >
            Back to recruitment
          </button>
        </div>
      </div>
    );
  }

    async function onComplete() {
        setSubmitError(null);
        setSubmitting(true);

        try {
            if (!uid) throw new Error("Missing uid in URL.");
            if (!myUid) throw new Error("Not signed in.");

            const queueRef = doc(db, "stage1PersonalityQueue", uid);
            const prospieRef = doc(db, "prospies", uid);

            await runTransaction(db, async (tx) => {
            // 1) Read queue doc inside tx
            const qSnap = await tx.get(queueRef);
            if (!qSnap.exists()) throw new Error("Queue entry no longer exists.");

            const q = qSnap.data() as any;

            // 2) Validate claim ownership inside tx (race-condition safe)
            if (q.status !== "claimed" || q.claimedBy !== myUid) {
                throw new Error("Access denied: you did not claim this prospie.");
            }

            // 3) Write summary to prospie doc
            tx.update(prospieRef, {
                stage1PersonalityInterviewSummary: {
                completed: true,
                completedAt: serverTimestamp(),
                interviewerUid: myUid,
                eval1,
                eval2,
                notes1,
                notes2,
                },
                stage1Complete: true, // marks Stage 1 complete → Can be evaluated 
            });

            // 4) Remove from personality queue
            tx.delete(queueRef);
            });

        } catch (e: any) {
            console.error(e);
            setSubmitError(e?.message ?? "Failed to complete interview");
        } finally {
            setSubmitting(false);
        }
    }

  return (
    <div className="min-h-screen p-6">
      <div className="mx-auto max-w-3xl space-y-6 rounded-2xl bg-white p-6 shadow">
        <div>
          <h1 className="text-2xl font-bold text-center text-purple-600">
            Stage 1 — Personality Interview
          </h1>
          <p className="mt-1 text-slate-700">
            {queueDoc?.name ?? "—"}{" "}
            <span className="text-slate-500">
              ({queueDoc?.email ?? "—"})
            </span>
          </p>
        </div>

        {/* Google Form */}
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="text-lg font-semibold text-slate-900">
            Interview Form
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            Use Google Forms for full interview questions.
          </p>

          <div className="mt-3">
            <a
              href={formUrl || "#"}
              target="_blank"
              rel="noreferrer"
              className={`inline-block rounded-lg px-4 py-2 text-sm font-semibold text-white ${
                formUrl ? "bg-purple-600 hover:bg-purple-700" : "bg-slate-300 cursor-not-allowed"
              }`}
              onClick={(e) => {
                if (!formUrl) e.preventDefault();
              }}
            >
              Open Personality Interview Form
            </a>

            {!formUrl && (
              <div className="mt-2 text-sm text-red-600">
                Missing setting: settings/global.stage1PersonalityInterviewFormUrl
              </div>
            )}
          </div>
        </div>

        {/* Summary Fields */}
        <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-4">
          <h2 className="text-lg font-semibold text-slate-900">
            Summary
          </h2>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="block">
              <div className="text-sm font-medium text-slate-700">
                Evaluation 1
              </div>
              <select
                value={eval1}
                onChange={(e) =>
                  setEval1(e.target.value as YesMaybeNo)
                }
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 text-slate-900"
              >
                <option value="yes">Yes</option>
                <option value="maybe">Maybe</option>
                <option value="no">No</option>
              </select>
            </label>

            <label className="block">
              <div className="text-sm font-medium text-slate-700">
                Evaluation 2
              </div>
              <select
                value={eval2}
                onChange={(e) =>
                  setEval2(e.target.value as YesMaybeNo)
                }
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 text-slate-900"
              >
                <option value="yes">Yes</option>
                <option value="maybe">Maybe</option>
                <option value="no">No</option>
              </select>
            </label>
          </div>

          <label className="block">
            <div className="text-sm font-medium text-slate-700">
              Notes (1)
            </div>
            <textarea
              rows={4}
              value={notes1}
              onChange={(e) => setNotes1(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 text-slate-900"
            />
          </label>

          <label className="block">
            <div className="text-sm font-medium text-slate-700">
              Notes (2)
            </div>
            <textarea
              rows={4}
              value={notes2}
              onChange={(e) => setNotes2(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 text-slate-900"
            />
          </label>

            {submitError && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                {submitError}
            </div>
            )}

            <button
                onClick={onComplete}
                disabled={submitting}
                className="w-full rounded-lg bg-purple-600 hover:bg-purple-700 px-4 py-2 font-semibold text-white disabled:opacity-50"
                >
                {submitting ? "Completing…" : "Complete Personality Interview"}
            </button>

        </div>
      </div>
    </div>
  );
}
