import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { auth, db } from "../app/firebase";
import { doc, onSnapshot, runTransaction, serverTimestamp } from "firebase/firestore";

type YesMaybeNo = "yes" | "maybe" | "no";

type Stage2Doc = {
  firstName?: string;
  lastName?: string;
  email?: string;
  stage?: number;
  stage2?: {
    checkedIn?: boolean;
    onTheWaterComplete?: boolean;
    interviewComplete?: boolean;
    slot?: string;
  };
};

export default function Stage2InterviewPage() {
  const { uid } = useParams<{ uid: string }>();
  const navigate = useNavigate();

  const myUid = auth.currentUser?.uid ?? null;

  const [loading, setLoading] = useState(true);
  const [accessDenied, setAccessDenied] = useState(false);
  const [prospieDoc, setProspieDoc] = useState<Stage2Doc | null>(null);
  const [formUrl, setFormUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Summary fields
  const [eval1, setEval1] = useState<YesMaybeNo>("maybe");
  const [eval2, setEval2] = useState<YesMaybeNo>("maybe");
  const [notes1, setNotes1] = useState("");
  const [notes2, setNotes2] = useState("");

  // Load Stage 2 form URL from settings/global
  useEffect(() => {
    const ref = doc(db, "settings", "global");

    const unsub = onSnapshot(ref, (snap) => {
      const url = (snap.data() as any)?.stage2InterviewFormUrl ?? "";
      setFormUrl(url);
    });

    return () => unsub();
  }, []);

  // Verify that the prospie is eligible for Stage 2 interview
  useEffect(() => {
    if (!uid || !myUid) {
      setAccessDenied(true);
      setLoading(false);
      return;
    }

    const ref = doc(db, "prospies", uid);

    const unsub = onSnapshot(
      ref,
      (snap) => {
        if (!snap.exists()) {
          setProspieDoc(null);
          setAccessDenied(true);
          setLoading(false);
          return;
        }

        const data = snap.data() as Stage2Doc;
        setProspieDoc(data);

        const canInterview =
          (data.stage ?? 0) >= 2 &&
          data.stage2?.checkedIn === true &&
          data.stage2?.onTheWaterComplete === true;

        setAccessDenied(!canInterview);
        setLoading(false);
      },
      (err) => {
        console.error("stage2 prospie snapshot error:", err);
        setAccessDenied(true);
        setLoading(false);
      }
    );

    return () => unsub();
  }, [uid, myUid]);

  async function onComplete() {
    setSubmitError(null);
    setSubmitting(true);

    try {
      if (!uid) throw new Error("Missing uid in URL.");
      if (!myUid) throw new Error("Not signed in.");

      const prospieRef = doc(db, "prospies", uid);

      await runTransaction(db, async (tx) => {
        const snap = await tx.get(prospieRef);
        if (!snap.exists()) throw new Error("Prospie record not found.");

        const data = snap.data() as any;

        const canInterview =
          (data.stage ?? 0) >= 2 &&
          data.stage2?.checkedIn === true &&
          data.stage2?.onTheWaterComplete === true;

        if (!canInterview) {
          throw new Error("This prospie is not yet eligible for the Stage 2 interview.");
        }

        tx.update(prospieRef, {
          stage2InterviewSummary: {
            completed: true,
            completedAt: serverTimestamp(),
            interviewerUid: myUid,
            eval1,
            eval2,
            notes1,
            notes2,
          },
          "stage2.interviewComplete": true,
          "stage2.interviewCompletedAt": serverTimestamp(),
        });
      });

      navigate("/member/recruitment");
    } catch (e: any) {
      console.error(e);
      setSubmitError(e?.message ?? "Failed to complete interview");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <div className="p-6">Loading…</div>;

  if (accessDenied) {
    return (
      <div className="min-h-screen p-6">
        <div className="mx-auto max-w-md rounded-2xl bg-white p-6 text-center shadow">
          <h1 className="text-xl font-semibold text-red-600">
            Access denied
          </h1>
          <p className="mt-2 text-slate-600">
            This prospie is not yet eligible for the Stage 2 interview.
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

  const displayName =
    `${prospieDoc?.firstName ?? ""} ${prospieDoc?.lastName ?? ""}`.trim() || "—";

  return (
    <div className="min-h-screen p-6">
      <div className="mx-auto max-w-3xl space-y-6 rounded-2xl bg-white p-6 shadow">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">
            Stage 2 — Interview
          </h1>
          <p className="mt-1 text-slate-700">
            {displayName}{" "}
            <span className="text-slate-500">
              ({prospieDoc?.email ?? "—"})
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
                formUrl ? "bg-black" : "bg-slate-300 cursor-not-allowed"
              }`}
              onClick={(e) => {
                if (!formUrl) e.preventDefault();
              }}
            >
              Open Stage 2 Interview Form
            </a>

            {!formUrl && (
              <div className="mt-2 text-sm text-red-600">
                Missing setting: settings/global.stage2InterviewFormUrl
              </div>
            )}
          </div>
        </div>

        {/* Summary Fields */}
        <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-4">
          <h2 className="text-lg font-semibold text-slate-900">Summary</h2>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="block">
              <div className="text-sm font-medium text-slate-700">
                Evaluation 1
              </div>
              <select
                value={eval1}
                onChange={(e) => setEval1(e.target.value as YesMaybeNo)}
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
                onChange={(e) => setEval2(e.target.value as YesMaybeNo)}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 text-slate-900"
              >
                <option value="yes">Yes</option>
                <option value="maybe">Maybe</option>
                <option value="no">No</option>
              </select>
            </label>
          </div>

          <label className="block">
            <div className="text-sm font-medium text-slate-700">Notes (1)</div>
            <textarea
              rows={4}
              value={notes1}
              onChange={(e) => setNotes1(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 text-slate-900"
            />
          </label>

          <label className="block">
            <div className="text-sm font-medium text-slate-700">Notes (2)</div>
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
            className="w-full rounded-lg bg-black px-4 py-2 font-semibold text-white disabled:opacity-50"
          >
            {submitting ? "Completing…" : "Complete Stage 2 Interview"}
          </button>
        </div>
      </div>
    </div>
  );
}