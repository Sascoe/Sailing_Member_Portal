import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { auth, db, storage } from "../app/firebase";
import {
  collection,
  doc,
  onSnapshot,
  query,
  updateDoc,
  where,
} from "firebase/firestore";
import {
  ref,
  uploadBytes,
  getDownloadURL,
} from "firebase/storage";

type YesMaybeNo = "yes" | "maybe" | "no";

type Stage2NotesRow = {
  uid: string;
  name: string;
  email?: string;
  onTheWaterEval?: YesMaybeNo;
};

export default function Stage2NotesUploadPage() {
  const navigate = useNavigate();
  const myUid = auth.currentUser?.uid ?? null;

  const [rows, setRows] = useState<Stage2NotesRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [uploadingUid, setUploadingUid] = useState<string | null>(null);
  const [savingEvalUid, setSavingEvalUid] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    const q = query(
      collection(db, "prospies"),
      where("stage1FinalDecision", "==", "advance")
    );

    const unsub = onSnapshot(
      q,
      (snap) => {
        const nextRows: Stage2NotesRow[] = snap.docs
          .map((d) => {
            const data = d.data() as any;

            const hasStage2Slot =
              Boolean(data.stage2?.slot) || Boolean(data.stage2Slot);

            if (!hasStage2Slot) return null;

            const name =
              `${data.firstName ?? ""} ${data.lastName ?? ""}`.trim() ||
              data.name ||
              data.email ||
              d.id;

            return {
              uid: d.id,
              name,
              email: data.email,
              onTheWaterEval: data.stage2?.onTheWaterEval ?? undefined,
            };
          })
          .filter((r): r is Stage2NotesRow => r !== null);

        setRows(nextRows);
        setLoading(false);
        setError(null);
      },
      (err) => {
        console.error("Stage2NotesUploadPage snapshot error:", err);
        setError(err.message ?? "Failed to load Stage 2 prospies.");
        setLoading(false);
      }
    );

    return () => unsub();
  }, []);

  async function handleEvalChange(uid: string, value: YesMaybeNo) {
    setSavingEvalUid(uid);
    try {
      await updateDoc(doc(db, "prospies", uid), {
        "stage2.onTheWaterEval": value,
      });
    } catch (e: any) {
      setError(e?.message ?? "Failed to save evaluation.");
    } finally {
      setSavingEvalUid(null);
    }
  }

  async function handleFileSelected(uid: string, file: File | null) {
    if (!file) return;
    if (!myUid) {
      setError("You must be signed in to upload notes.");
      return;
    }

    setUploadingUid(uid);
    setError(null);
    setSuccessMessage(null);

    try {
      const safeName = file.name.replace(/\s+/g, "-");
      const timestamp = Date.now();

      const storageRef = ref(
        storage,
        `prospies/${uid}/stage2-notes/${myUid}-${timestamp}-${safeName}`
      );

      await uploadBytes(storageRef, file, {
        contentType: file.type || "audio/mpeg",
      });

      await getDownloadURL(storageRef);

      setSuccessMessage("Voice memo uploaded successfully.");
    } catch (e: any) {
      console.error(e);
      setError(e?.message ?? "Failed to upload voice memo.");
    } finally {
      setUploadingUid(null);
    }
  }

  return (
    <div className="min-h-screen p-6">
      <div className="mx-auto max-w-4xl space-y-6 rounded-2xl bg-white p-6 shadow">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-center text-purple-600">
              Upload On-the-Water Notes
            </h1>
            <p className="mt-1 text-slate-700">
              Record your evaluation and upload a voice memo for each Stage 2 prospie.
            </p>
          </div>

          <button
            onClick={() => navigate("/member/recruitment")}
            className="rounded-lg bg-purple-600 hover:bg-purple-700 px-4 py-2 text-sm font-semibold text-white"
          >
            Back to recruitment
          </button>
        </div>

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {successMessage && (
          <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-700">
            {successMessage}
          </div>
        )}

        {loading ? (
          <div className="text-slate-600">Loading Stage 2 prospies…</div>
        ) : rows.length === 0 ? (
          <div className="rounded-lg bg-slate-50 p-4 text-slate-700">
            No Stage 2 prospies found.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-sm text-slate-900">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50">
                  <th className="py-3 pr-4 pl-2 font-semibold">Name</th>
                  <th className="py-3 pr-4 font-semibold">Email</th>
                  <th className="py-3 pr-4 font-semibold">On-the-water eval</th>
                  <th className="py-3 pr-4 font-semibold">Voice memo</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.uid} className="border-b border-slate-200 hover:bg-slate-50">
                    <td className="py-3 pr-4 pl-2 font-medium">{r.name}</td>
                    <td className="py-3 pr-4 text-slate-600">{r.email ?? "—"}</td>
                    <td className="py-3 pr-4">
                      <select
                        value={r.onTheWaterEval ?? ""}
                        disabled={savingEvalUid === r.uid}
                        onChange={(e) =>
                          handleEvalChange(r.uid, e.target.value as YesMaybeNo)
                        }
                        className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900 disabled:opacity-50"
                      >
                        <option value="" disabled>Select…</option>
                        <option value="yes">Yes</option>
                        <option value="maybe">Maybe</option>
                        <option value="no">No</option>
                      </select>
                      {savingEvalUid === r.uid && (
                        <span className="ml-2 text-xs text-slate-500">Saving…</span>
                      )}
                      {r.onTheWaterEval && savingEvalUid !== r.uid && (
                        <span className="ml-2 text-xs text-green-600">✓ Saved</span>
                      )}
                    </td>
                    <td className="py-3 pr-4">
                      <label className="inline-flex cursor-pointer items-center rounded-lg bg-purple-600 hover:bg-purple-700 px-3 py-2 text-sm font-semibold text-white">
                        {uploadingUid === r.uid ? "Uploading…" : "Upload voice memo"}
                        <input
                          type="file"
                          accept="audio/*,.m4a,.mp3,.wav,.mpeg"
                          className="hidden"
                          disabled={uploadingUid === r.uid}
                          onChange={(e) => {
                            const file = e.target.files?.[0] ?? null;
                            void handleFileSelected(r.uid, file);
                            e.currentTarget.value = "";
                          }}
                        />
                      </label>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
