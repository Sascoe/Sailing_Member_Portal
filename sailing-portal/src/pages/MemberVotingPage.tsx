import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useUserRole } from "../auth/useUserRole";
import { auth, db } from "../app/firebase";
import {
  collection,
  doc,
  onSnapshot,
  query,
  setDoc,
  where,
} from "firebase/firestore";

type Prospie = {
  uid: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  gender?: string;
  stage3?: {
    packetCreated?: boolean;
  };
};

type VoteData = {
  maleVotes: string[];
  femaleVotes: string[];
};

export default function MemberVotingPage() {
  const { positions } = useUserRole();
  const isMember = positions.includes("member");
  const navigate = useNavigate();

  const [prospies, setProspies] = useState<Prospie[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [myVotes, setMyVotes] = useState<VoteData>({ maleVotes: [], femaleVotes: [] });
  const [hasVoted, setHasVoted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!isMember) {
      navigate("/member/recruitment");
      return;
    }

    const myUid = auth.currentUser?.uid;
    if (!myUid) return;

    // Load prospies with packets
    const q = query(
      collection(db, "prospies"),
      where("stage3.packetCreated", "==", true)
    );

    const unsubProspies = onSnapshot(
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

    // Load my votes
    const voteRef = doc(db, "votes", myUid);
    const unsubVotes = onSnapshot(
      voteRef,
      (snap) => {
        if (snap.exists()) {
          const data = snap.data() as VoteData;
          setMyVotes(data);
          setHasVoted(true);
        } else {
          setMyVotes({ maleVotes: [], femaleVotes: [] });
          setHasVoted(false);
        }
      },
      (err) => {
        console.error("Error loading votes:", err);
      }
    );

    return () => {
      unsubProspies();
      unsubVotes();
    };
  }, [isMember, navigate]);

  const males = prospies.filter((p) => p.gender === "male");
  const females = prospies.filter((p) => p.gender === "female");

  function toggleVote(gender: "male" | "female", uid: string) {
    if (hasVoted) return; // Can't change after submitted

    setMyVotes((prev) => {
      const key = gender === "male" ? "maleVotes" : "femaleVotes";
      const current = prev[key];
      const isSelected = current.includes(uid);
      const newVotes = isSelected
        ? current.filter((id) => id !== uid)
        : [...current, uid];

      return {
        ...prev,
        [key]: newVotes,
      };
    });
  }

  async function submitVotes() {
    const myUid = auth.currentUser?.uid;
    if (!myUid) return;

    setSubmitting(true);
    try {
      const voteRef = doc(db, "votes", myUid);
      await setDoc(voteRef, myVotes);
      setHasVoted(true);
    } catch (err: any) {
      console.error(err);
      alert("Failed to submit votes: " + err.message);
    } finally {
      setSubmitting(false);
    }
  }

  if (!isMember) return null;

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
              Stage 3 — Member Voting
            </h1>
            <button
              onClick={() => navigate("/member/recruitment")}
              className="rounded-lg bg-black px-4 py-2 text-sm font-semibold text-white"
            >
              Back to Recruitment
            </button>
          </div>
          <p className="mt-2 text-slate-700">
            Vote for prospies. You can change your selections before submitting.
          </p>
          {hasVoted && (
            <p className="mt-2 text-green-700 font-semibold">
              You have submitted your votes.
            </p>
          )}
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          {/* Male Voting */}
          <div className="rounded-2xl bg-white p-6 shadow">
            <h2 className="text-lg font-semibold text-slate-900">Vote for Male Prospies</h2>
            {males.length === 0 ? (
              <p className="mt-3 text-slate-700">No male prospies with packets.</p>
            ) : (
              <div className="mt-4 space-y-3">
                {males.map((p) => {
                  const name = `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim() || p.email || p.uid;
                  const isSelected = myVotes.maleVotes.includes(p.uid);

                  return (
                    <label
                      key={p.uid}
                      className="flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4 cursor-pointer hover:bg-slate-100"
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleVote("male", p.uid)}
                        disabled={hasVoted}
                        className="h-4 w-4 text-black focus:ring-black"
                      />
                      <div>
                        <div className="font-semibold text-slate-900">{name}</div>
                        <div className="text-sm text-slate-600">{p.email ?? "—"}</div>
                      </div>
                    </label>
                  );
                })}
              </div>
            )}
          </div>

          {/* Female Voting */}
          <div className="rounded-2xl bg-white p-6 shadow">
            <h2 className="text-lg font-semibold text-slate-900">Vote for Female Prospies</h2>
            {females.length === 0 ? (
              <p className="mt-3 text-slate-700">No female prospies with packets.</p>
            ) : (
              <div className="mt-4 space-y-3">
                {females.map((p) => {
                  const name = `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim() || p.email || p.uid;
                  const isSelected = myVotes.femaleVotes.includes(p.uid);

                  return (
                    <label
                      key={p.uid}
                      className="flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4 cursor-pointer hover:bg-slate-100"
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleVote("female", p.uid)}
                        disabled={hasVoted}
                        className="h-4 w-4 text-black focus:ring-black"
                      />
                      <div>
                        <div className="font-semibold text-slate-900">{name}</div>
                        <div className="text-sm text-slate-600">{p.email ?? "—"}</div>
                      </div>
                    </label>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {!hasVoted && (
          <div className="rounded-2xl bg-white p-6 shadow">
            <button
              onClick={submitVotes}
              disabled={submitting}
              className="w-full rounded-lg bg-black px-4 py-3 text-lg font-semibold text-white disabled:opacity-50"
            >
              {submitting ? "Submitting…" : "Submit Votes"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}