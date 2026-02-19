import { useEffect, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../app/firebase";
import { useUserRole } from "../auth/useUserRole";

type YesMaybeNo = "yes" | "maybe" | "no";

type ProspieDoc = {
  firstName?: string;
  lastName?: string;
  email?: string;
  gradYear?: number;
  gender?: string;
  photoUrl?: string;

  stage1SailingInterviewSummary?: {
    sailingEval1?: YesMaybeNo;
    sailingEval2?: YesMaybeNo;
    hasSailingExperience?: boolean;
    availability?: string[];
  };

  stage1PersonalityInterviewSummary?: {
    eval1?: YesMaybeNo;
    eval2?: YesMaybeNo;
  };

  stage1Complete?: boolean;
};

function scoreYNM(v?: YesMaybeNo) {
  if (v === "yes") return 1;
  if (v === "maybe") return 0.5;
  if (v === "no") return 0;
  return 0;
}

function totalScore(p: ProspieDoc) {
  const s = p.stage1SailingInterviewSummary;
  const per = p.stage1PersonalityInterviewSummary;

  return (
    scoreYNM(s?.sailingEval1) +
    scoreYNM(s?.sailingEval2) +
    scoreYNM(per?.eval1) +
    scoreYNM(per?.eval2)
  );
}

export default function RecruitmentRosterPage() {
  const { positions, loading: roleLoading } = useUserRole();
  const isRecruitmentChair = positions?.includes("recruitment_chair") ?? false;


  const [prospies, setProspies] = useState<{ id: string; data: ProspieDoc }[]>([]);
  const [loading, setLoading] = useState(true);


  useEffect(() => {
    if (!isRecruitmentChair) return;

    const q = query(
      collection(db, "prospies"),
      where("stage1Complete", "==", true)
    );

    const unsub = onSnapshot(q, (snap) => {
      const rows = snap.docs.map((d) => ({
        id: d.id,
        data: d.data() as ProspieDoc,
        
      }));

      setProspies(rows);
      setLoading(false);
    },
    (err) => {
        console.error("Roster onSnapshot error:", err);
        setLoading(false);
  });

    return () => unsub();
  }, [isRecruitmentChair]);

  if (roleLoading) return <div className="p-6">Loading…</div>;

  if (!isRecruitmentChair) {
    return <div className="p-6">Access denied</div>;
  }

  if (loading) {
    return <div className="p-6">Loading roster…</div>;
  }

  
  return (
    <div className="min-h-screen p-6">
      <div className="mx-auto max-w-6xl rounded-2xl bg-white p-6 shadow">
          <div className="space-y-2">
            <div className="text-3xl font-bold text-red-600">
              ROSTER PAGE LOADED
            </div>

      <h1 className="text-2xl font-bold text-slate-900">
        Stage 1 Completed Prospies
      </h1>
    </div>

        <div className="mt-6 overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b">
                <th className="py-2 pr-4">Photo</th>
                <th className="py-2 pr-4">Name</th>
                <th className="py-2 pr-4">Year</th>
                <th className="py-2 pr-4">Email</th>
                <th className="py-2 pr-4">Gender</th>
                <th className="py-2 pr-4">Sailing exp</th>
                <th className="py-2 pr-4">Availability</th>
                <th className="py-2 pr-4">Score</th>
              </tr>
            </thead>
            <tbody>
              {prospies.map(({ id, data }) => {
                const avail = data.stage1SailingInterviewSummary?.availability ?? [];
                const exp = data.stage1SailingInterviewSummary?.hasSailingExperience;

                return (
                  <tr key={id} className="border-b align-top">
                    <td className="py-2 pr-4">
                      {data.photoUrl ? (
                        <img
                          src={data.photoUrl}
                          alt={`${data.firstName ?? ""} ${data.lastName ?? ""}`}
                          className="h-10 w-10 rounded-full object-cover"
                        />
                      ) : (
                        <div className="h-10 w-10 rounded-full bg-slate-200" />
                      )}
                    </td>

                    <td className="py-2 pr-4 font-semibold text-slate-900">
                      {(data.firstName ?? "—") + " " + (data.lastName ?? "")}
                    </td>

                    <td className="py-2 pr-4 text-slate-700">
                      {data.gradYear ?? "—"}
                    </td>

                    <td className="py-2 pr-4 text-slate-700">
                      {data.email ?? "—"}
                    </td>

                    <td className="py-2 pr-4 text-slate-700">
                      {data.gender ?? "—"}
                    </td>

                    <td className="py-2 pr-4 text-slate-700">
                      {exp === true ? "Yes" : exp === false ? "No" : "—"}
                    </td>

                    <td className="py-2 pr-4">
                      {avail.length === 0 ? (
                        <span className="text-slate-500">—</span>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          {avail.map((a) => (
                            <span
                              key={a}
                              className="rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-700"
                            >
                              {a}
                            </span>
                          ))}
                        </div>
                      )}
                    </td>

                    <td className="py-2 pr-4 font-semibold text-slate-900">
                      {totalScore(data)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

      </div>
    </div>
  );
}
