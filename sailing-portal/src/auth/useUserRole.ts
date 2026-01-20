import { onAuthStateChanged } from "firebase/auth";
import { doc, onSnapshot } from "firebase/firestore";
import { useEffect, useState } from "react";
import { auth, db } from "../app/firebase";

type Role = "prospie" | "member" | "chair";

export function useUserRole() {
  const [role, setRole] = useState<Role | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubAuth = onAuthStateChanged(auth, (user) => {
      if (!user) {
        setRole(null);
        setLoading(false);
        return;
      }

      const unsubUser = onSnapshot(doc(db, "users", user.uid), (snap) => {
        setRole((snap.data()?.role as Role) ?? null);
        setLoading(false);
      });

      // when auth user changes, clean up user doc listener
      return () => unsubUser();
    });

    return () => unsubAuth();
  }, []);

  return { role, loading };
}
