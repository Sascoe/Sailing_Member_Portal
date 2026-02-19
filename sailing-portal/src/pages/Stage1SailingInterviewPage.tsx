import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { auth, db } from "../app/firebase";
import {
  doc,
  getDoc,
  onSnapshot,
  runTransaction,
  serverTimestamp,
} from "firebase/firestore";

type YesMaybeNo = "yes" | "maybe" | "no";

type SailingQueueDoc = {
  uid: string;
  name?: string;
  email?: string;
  status?: "waiting" | "claimed";
  claimedBy?: string;
};

const AVAILABILITY_OPTIONS = [
  { key: "thu_2_4", label: "Thursday 2–4" },
  { key: "thu_4_6", label: "Thursday 4–6" },
  { key: "fri_2_4", label: "Friday 2–4" },
  { key: "fri_4_6", label: "Friday 4–6" },
] as const;

type AvailabilityKey = typeof AVAILABILITY_OPTIONS[number]["key"];

export default function Stage1SailingInterviewPage() {
  const { uid } = useParams<{ uid: string }>();
  const navigate = useNavigate();

  const myUid = auth.currentUser?.uid ?? null;

  const [loading, setLoading] = useState(true);
  const [accessDenied, setAccessDenied] = useState(false);
  const [queueDoc, setQueueDoc] = useState<SailingQueueDoc | null>(null);
  const [formUrl, setFormUrl] = useState<string>("");

  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Summary fields (your spec)
  const [sailingEval1, setSailingEval1] = useState<YesMaybeNo>("maybe");
  const [sailingEval2, setSailingEval2] = useState<YesMaybeNo>("maybe");
  const [notes1, setNotes1] = useState("");
  const [notes2, setNotes2] = useState("");
  const [hasSailingExperience, setHasSailingExperience] = useState(false);
  const [availability, setAvailability] = useState<AvailabilityKey[]>([]);  // e.g. ["thu_2_4", "fri_4_6"]


  // Load settings/global for the form URL
  useEffect(() => {
    const ref = doc(db, "settings", "global");
    const unsub = onSnapshot(ref, (snap) => {
      const url = (snap.data() as any)?.stage1SailingInterviewFormUrl ?? "";
      setFormUrl(url);
    });
    return () => unsub();
  }, []);

  // Verify claim ownership + load queue doc (reactive)
  useEffect(() => {
    if (!uid || !myUid) return;

    const ref = doc(db, "stage1SailingQueue", uid);

    const unsub = onSnapshot(
      ref,
      (snap) => {
        if (!snap.exists()) {
          // Not in queue anymore (maybe already completed)
          setQueueDoc(null);
          setAccessDenied(true);
          setLoading(false);
          return;
        }

        const data = snap.data() as SailingQueueDoc;

        // Must be claimed and claimed by me
        const ok =
          data.status === "claimed" && data.claimedBy && data.claimedBy === myUid;

        setQueueDoc({ uid: snap.id, ...data });
        setAccessDenied(!ok);
        setLoading(false);
      },
      (err) => {
        console.error("stage1SailingQueue onSnapshot error:", err);
        setSubmitError(err.message ?? "Failed to load claim info.");
        setLoading(false);
      }
    );

    return () => unsub();
  }, [uid, myUid]);

  const displayName = useMemo(() => queueDoc?.name ?? "—", [queueDoc]);
  const displayEmail = useMemo(() => queueDoc?.email ?? "—", [queueDoc]);

    function toggleAvailability(key: AvailabilityKey) {
        setAvailability((prev) =>
            prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
        );
    }

  async function completeSailingInterview() {
    if (!uid || !myUid) return;
    setSubmitError(null);
    setSubmitting(true);

    if (availability.length === 0) { //must select a time
        setSubmitError("Please select at least one availability time block.");
        return;
    }

    try {
      const sailingQueueRef = doc(db, "stage1SailingQueue", uid);
      const prospieRef = doc(db, "prospies", uid);
      const personalityQueueRef = doc(db, "stage1PersonalityQueue", uid);

      await runTransaction(db, async (tx) => {
        const sailingSnap = await tx.get(sailingQueueRef);
        if (!sailingSnap.exists()) throw new Error("Queue entry no longer exists.");

        const q = sailingSnap.data() as SailingQueueDoc;

        if (q.status !== "claimed" || q.claimedBy !== myUid) {
          throw new Error("Access denied: you did not claim this prospie.");
        }

        // Ensure prospie exists (optional but helpful)
        const prospieSnap = await tx.get(prospieRef);
        if (!prospieSnap.exists()) {
          throw new Error("Prospie record not found.");
        }

        // Prefer name/email from queue doc (already denormalized)
        const name = q.name ?? prospieSnap.data()?.name ?? "";
        const email = q.email ?? prospieSnap.data()?.email ?? "";

        // 1) Write summary to prospies/{uid}
        tx.update(prospieRef, {
          stage1SailingInterviewSummary: {
            completed: true,
            completedAt: serverTimestamp(),
            interviewerUid: myUid,

            //summary fields
            sailingEval1,
            sailingEval2,
            notes1,
            notes2,
            hasSailingExperience,
            availability,
            
          },
        });

        // 2) Remove from sailing queue
        tx.delete(sailingQueueRef);

        // 3) Enqueue into personality queue
        tx.set(personalityQueueRef, {
          uid,
          name,
          email,
          status: "waiting",
          enqueuedAt: serverTimestamp(),
        });
      });

      // After completion: back to recruitment dashboard
      navigate("/member/recruitment");
    } catch (e: any) {
      console.error(e);
      setSubmitError(e?.message ?? "Failed to complete sailing interview.");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <div className="p-6">Loading…</div>;

  if (accessDenied) {
    return (
      <div className="min-h-screen p-6">
        <div className="mx-auto max-w-md rounded-2xl bg-white p-6 text-center shadow">
          <h1 className="text-xl font-semibold text-red-600">Access denied</h1>
          <p className="mt-2 text-slate-600">
            You don’t have permission to view this interview.
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

  // At this point we know it's claimed by this member
  return (
    <div className="min-h-screen p-6">
      <div className="mx-auto max-w-3xl space-y-6 rounded-2xl bg-white p-6 shadow">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold text-slate-900">
            Stage 1 — Sailing Interview
          </h1>
          <p className="text-slate-700">
            Prospie: <span className="font-semibold">{displayName}</span>{" "}
            <span className="text-slate-500">({displayEmail})</span>
          </p>
        </div>

        {/* Google Form */}
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="text-lg font-semibold text-slate-900">Interview form</h2>
          <p className="mt-1 text-sm text-slate-600">
            Use Google Forms for the full question set. Then record the summary below.
          </p>

          <div className="mt-3">
            <a
              href={formUrl || "#"}
              target="_blank"
              rel="noreferrer"
              className={`inline-block rounded-lg px-4 py-2 text-sm font-semibold text-white ${
                formUrl ? "bg-black" : "bg-slate्झ300 cursor-not-allowed"
              }`}
              onClick={(e) => {
                if (!formUrl) e.preventDefault();
              }}
            >
              Open Sailing Interview Form
            </a>

            {!formUrl && (
              <div className="mt-2 text-sm text-red-600">
                Missing setting: <code>settings/global.stage1SailingInterviewFormUrl</code>
              </div>
            )}
          </div>
        </div>

        {/* Summary fields */}
        <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-4">
          <h2 className="text-lg font-semibold text-slate-900">Summary</h2>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="block">
              <div className="text-sm font-medium text-slate-700">
                Evaluation 1
              </div>
              <select
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 text-slate-900"
                value={sailingEval1}
                onChange={(e) => setSailingEval1(e.target.value as YesMaybeNo)}
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
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 text-slate-900"
                value={sailingEval2}
                onChange={(e) => setSailingEval2(e.target.value as YesMaybeNo)}
              >
                <option value="yes">Yes</option>
                <option value="maybe">Maybe</option>
                <option value="no">No</option>
              </select>
            </label>
          </div>

          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={hasSailingExperience}
              onChange={(e) => setHasSailingExperience(e.target.checked)}
            />
            <span className="text-sm text-slate-700">Has sailing experience</span>
          </label>

          <label className="block">
            <div className="text-sm font-medium text-slate-700">Notes (1)</div>
            <textarea
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 text-slate-900"
              rows={4}
              value={notes1}
              onChange={(e) => setNotes1(e.target.value)}
              placeholder="Short summary notes…"
            />
          </label>

          <label className="block">
            <div className="text-sm font-medium text-slate-700">Notes (2)</div>
            <textarea
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 text-slate-900"
              rows={4}
              value={notes2}
              onChange={(e) => setNotes2(e.target.value)}
              placeholder="More notes (optional)…"
            />
          </label>

            <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-2">
                <h2 className="text-lg font-semibold text-slate-900">Availability</h2>
                <p className="text-sm text-slate-600">
                    Select all time blocks the prospie can attend Stage 2.
                </p>

                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    {AVAILABILITY_OPTIONS.map((opt) => (
                    <label
                        key={opt.key}
                        className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2"
                    >
                        <input
                        type="checkbox"
                        checked={availability.includes(opt.key)}
                        onChange={() => toggleAvailability(opt.key)}
                        className="h-4 w-4"
                        />
                        <span className="text-slate-900">{opt.label}</span>
                    </label>
                    ))}
                </div>
            </div>

          {submitError && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {submitError}
            </div>
          )}

          <button
            onClick={completeSailingInterview}
            disabled={submitting}
            className="w-full rounded-lg bg-black px-4 py-2 font-semibold text-white disabled:opacity-50"
          >
            {submitting ? "Completing…" : "Complete Sailing Interview → Send to Personality Queue"}
          </button>
        </div>
      </div>
    </div>
  );
}
