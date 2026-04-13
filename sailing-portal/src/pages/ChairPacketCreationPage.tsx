import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useUserRole } from "../auth/useUserRole";
import { db } from "../app/firebase";
import {
  collection,
  doc,
  onSnapshot,
  query,
  updateDoc,
  where,
} from "firebase/firestore";

type Prospie = {
  uid: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  gender?: string;
  stage2?: {
    interviewComplete?: boolean;
  };
  stage3?: {
    packetCreated?: boolean;
  };
};

export default function ChairPacketCreationPage() {
  const { positions } = useUserRole();
  const isChair = positions.includes("recruitment_chair");
  const navigate = useNavigate();

  const [prospies, setProspies] = useState<Prospie[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [publishingGender, setPublishingGender] = useState<"male" | "female" | null>(null);
  const [publishError, setPublishError] = useState<string | null>(null);

  const maleProspies = useMemo(
    () => prospies.filter((p) => p.gender === "male"),
    [prospies]
  );

  const femaleProspies = useMemo(
    () => prospies.filter((p) => p.gender === "female"),
    [prospies]
  );

  useEffect(() => {
    if (!isChair) {
      navigate("/member/recruitment");
      return;
    }

    const q = query(
      collection(db, "prospies"),
      where("stage2.interviewComplete", "==", true)
    );

    const unsub = onSnapshot(
      q,
      (snap) => {
        const data: Prospie[] = snap.docs.map((d) => ({
          uid: d.id,
          ...(d.data() as any),
        }));
        setProspies(data);
        setLoading(false);
        setError(null);
      },
      (err) => {
        console.error(err);
        setError(err.message ?? "Unknown error");
        setLoading(false);
      }
    );

    return () => unsub();
  }, [isChair, navigate]);

  async function publishPacketsForGender(gender: "male" | "female") {
    const batch = (gender === "male" ? maleProspies : femaleProspies).filter(
      (p) => !p.stage3?.packetCreated
    );
    if (batch.length === 0) return;

    setPublishError(null);
    setPublishingGender(gender);

    try {
      await Promise.all(
        batch.map((p) =>
          updateDoc(doc(db, "prospies", p.uid), {
            "stage3.packetCreated": true,
            "stage3.packetCreatedAt": new Date(),
          })
        )
      );
    } catch (err: any) {
      console.error(err);
      setPublishError(err?.message ?? "Failed to publish packets.");
    } finally {
      setPublishingGender(null);
    }
  }

  if (!isChair) return null;

  if (loading) return <div className="p-6">Loading prospies…</div>;

  if (error) {
    return (
      <div className="min-h-screen p-6">
        <div className="mx-auto max-w-2xl rounded-2xl bg-white p-6 shadow">
          <h1 className="text-xl font-semibold text-red-600">Error</h1>
          <p className="mt-2 text-slate-700">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen p-6">
      <div className="mx-auto max-w-4xl space-y-6">
        <div className="rounded-2xl bg-white p-6 shadow">
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-bold text-slate-900">
              Stage 3 — Create Candidate Packets
            </h1>
            <button
              onClick={() => navigate("/member/recruitment")}
              className="rounded-lg bg-black px-4 py-2 text-sm font-semibold text-white"
            >
              Back to Recruitment
            </button>
          </div>
          <p className="mt-2 text-slate-700">
            Create packets for prospies who have completed Stage 2 interviews.
          </p>
        </div>

        <div className="rounded-2xl bg-white p-6 shadow">
          <h2 className="text-lg font-semibold text-slate-900">Eligible Prospies</h2>
          <p className="mt-2 text-slate-700">
            Publish candidate packets in bulk by gender for prospies who have completed Stage 2.
          </p>

          {publishError && (
            <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {publishError}
            </div>
          )}

          {prospies.length === 0 ? (
            <p className="mt-3 text-slate-700">No prospies have completed Stage 2 yet.</p>
          ) : (
            <div className="mt-6 grid gap-4 md:grid-cols-2">
              {[
                { gender: "male", title: "Male Prospies", rows: maleProspies },
                { gender: "female", title: "Female Prospies", rows: femaleProspies },
              ].map(({ gender, title, rows }) => {
                const remaining = rows.filter((p) => !p.stage3?.packetCreated);
                const publishing = publishingGender === gender;
                return (
                  <div key={gender} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <h3 className="text-md font-semibold text-slate-900">{title}</h3>
                        <p className="text-sm text-slate-600">{rows.length} total, {remaining.length} unpublished</p>
                      </div>
                      <button
                        onClick={() => publishPacketsForGender(gender as "male" | "female")}
                        disabled={remaining.length === 0 || publishing}
                        className="rounded-lg bg-black px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                      >
                        {publishing ? "Publishing…" : `Publish ${gender} packets`}
                      </button>
                    </div>
                    <div className="mt-4 space-y-2">
                      {rows.length === 0 ? (
                        <p className="text-sm text-slate-700">No {gender} prospies with Stage 2 complete yet.</p>
                      ) : (
                        rows.map((p) => {
                          const name = `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim() || p.email || p.uid;
                          return (
                            <div key={p.uid} className="rounded-lg border border-slate-200 bg-white p-3">
                              <div className="flex items-center justify-between gap-4">
                                <div>
                                  <div className="font-semibold text-slate-900">{name}</div>
                                  <div className="text-sm text-slate-600">{p.email ?? "—"}</div>
                                </div>
                                <span className={`rounded-full px-3 py-1 text-sm font-semibold ${p.stage3?.packetCreated ? "bg-green-100 text-green-800" : "bg-slate-100 text-slate-700"}`}>
                                  {p.stage3?.packetCreated ? "Published" : "Pending"}
                                </span>
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}